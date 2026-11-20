/* 音檔工作清單：讀 data/raw 的題庫資料，算出每個音檔要唸的段落、聲音、語速、字元數。
   不連網、不讀金鑰。gen_audio_azure.js 與 check_audio.js 共用。
   聲音與規則在 tools/audio_voices.json；每個音檔的口音與性別由「同類別依 id 排序後的名次」算出，
   和 JSON 檔的載入順序無關；同口音同性別有多個聲音時用 id 的雜湊挑，所以結果固定。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const CATEGORIES = {
  p1: '聽力P1', p2: '聽力P2', p3: '聽力P3', p4: '聽力P4',
  dictation: '英語耳聽寫', pairs: '英語耳易混音', numbers: '英語耳數字', shadow: '英語耳跟讀',
  zh: '中文翻譯', dialogue: '對話練習', 'phonics-word': '發音單字', 'phonics-sentence': '發音句子',
};
const GROUPS = {
  listening: ['p1', 'p2', 'p3', 'p4'], ear: ['dictation', 'pairs', 'numbers', 'shadow'], phonics: ['phonics-word', 'phonics-sentence'],
};
const PAGES_LISTENING = ['practice.html', 'mock.html', 'daily.html', 'review.html', 'history.html'];

function loadVoices(file) {
  return JSON.parse(fs.readFileSync(file || path.join(__dirname, 'audio_voices.json'), 'utf8'));
}

/* ---------- 小工具 ---------- */
const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
function hash32(s) { return crypto.createHash('sha1').update(String(s)).digest().readUInt32BE(0); }
function pick(pool, key) { return pool[hash32(key) % pool.length]; }
const isWide = (ch) => /[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch);
const azureChars = (s) => { let n = 0; for (const ch of s) n += isWide(ch) ? 2 : 1; return n; };
const wordCount = (s) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
function fmtRate(pct) { const n = Math.round(pct); return (n >= 0 ? '+' : '') + n + '%'; }
function rateNum(r) { return parseFloat(String(r).replace('%', '')) || 0; }
function localeOf(voice) { const m = /^([a-z]{2,3}-[A-Za-z]{2,4})-/.exec(voice); return m ? m[1] : 'en-US'; }

/* SSML 文字跳脫：& < > " ' 都換成實體；控制字元（XML 不允許）直接拿掉 */
function escXml(s) {
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function ssmlFor(seg) {
  return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="' + localeOf(seg.voice) + '">'
    + '<voice name="' + seg.voice + '"><prosody rate="' + seg.rate + '">' + escXml(seg.text) + '</prosody></voice></speak>';
}
const prosodyLen = (rate) => ('<prosody rate="' + rate + '">').length + '</prosody>'.length;

/* ---------- 資料讀取 ---------- */
function makeLoader(repo) {
  const RAW = path.join(repo, 'data', 'raw');
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8').replace(/^﻿/, ''));
  const glob = (re) => fs.readdirSync(RAW).filter((f) => re.test(f)).sort();
  return { rd, glob, loadAll: (re) => glob(re).flatMap((f) => rd(f)) };
}

/* ---------- 聽力的口音、性別、聲音 ---------- */
function listeningVoice(cfg, accent, gender, key) { return pick(cfg.listeningPools[accent][gender], key); }
function offsetFor(r) { return 1 + (r % 3); }

/* 依 id 排序後的名次 */
function ranked(list) {
  return list.slice().sort((a, b) => natural(a.id, b.id)).map((q, i) => ({ q, i }));
}

function letterSegs(options, voice, letters, rate, gap) {
  const s = [];
  options.forEach((opt, li) => {
    let o = String(opt).trim();
    if (!/[.?!]$/.test(o)) o += '.';
    if (li) s.push({ gapMs: gap });
    s.push({ text: letters[li] + '. ' + o, voice, rate });
  });
  return s;
}

function buildItems(repo, cfg) {
  const L = makeLoader(repo);
  const items = [];
  const R = cfg.rates.default;
  const ACC = cfg.accents;
  const add = (category, id, file, pages, segments, extra) => items.push(Object.assign({ category, id, file, pages, segments }, extra || {}));
  const slot = (accent, gender) => ({ accent, gender });

  // 聽力 P1：口音每 4 檔一輪，性別每 4 檔換一次（口音和性別拆開）
  ranked(L.loadAll(/^listening_p1.*\.json$/)).forEach(({ q, i }) => {
    const accent = ACC[i % 4], gender = Math.floor(i / 4) % 2 === 0 ? 'M' : 'F';
    const v = listeningVoice(cfg, accent, gender, q.id);
    add('聽力P1', q.id, q.id + '.mp3', PAGES_LISTENING, letterSegs(q.options, v, 'ABCD', R, cfg.gapsMs.p1Option),
      { scriptWords: q.options.join(' '), slots: [slot(accent, gender)] });
  });
  // 聽力 P2：問句與選項不同性別、不同口音
  ranked(L.loadAll(/^listening_p2_b.*\.json$/)).forEach(({ q, i }) => {
    const r = Math.floor(i / 4);
    const qa = ACC[i % 4], oa = ACC[(i % 4 + offsetFor(r)) % 4];
    const qg = r % 2 === 0 ? 'M' : 'F', og = qg === 'M' ? 'F' : 'M';
    const qv = listeningVoice(cfg, qa, qg, q.id + '|q'), ov = listeningVoice(cfg, oa, og, q.id + '|o');
    add('聽力P2', q.id, q.id + '.mp3', PAGES_LISTENING,
      [{ text: q.question, voice: qv, rate: R }, { gapMs: cfg.gapsMs.p2AfterQuestion }].concat(letterSegs(q.options, ov, 'ABC', R, cfg.gapsMs.p2Option)),
      { scriptWords: q.question + ' ' + q.options.join(' '), slots: [slot(qa, qg), slot(oa, og)] });
  });
  // 聽力 P3：兩人兩個口音、一男一女；同一說話者整組同一個聲音
  ranked(L.loadAll(/^listening_p3_b.*\.json$/)).forEach(({ q: s, i }) => {
    const r = Math.floor(i / 4);
    const a1 = ACC[i % 4], a2 = ACC[(i % 4 + offsetFor(r)) % 4];
    const firstG = s.dialogue[0].s === 'M' ? 'M' : 'F';
    const accOf = { [firstG]: a1, [firstG === 'M' ? 'F' : 'M']: a2 };
    const voiceOf = {};
    for (const g of ['M', 'F']) voiceOf[g] = listeningVoice(cfg, accOf[g], g, s.id + '|' + g);
    const segs = [];
    s.dialogue.forEach((t, ti) => {
      if (ti) segs.push({ gapMs: cfg.gapsMs.p3Turn });
      segs.push({ text: t.text, voice: voiceOf[t.s === 'M' ? 'M' : 'F'], rate: R });
    });
    add('聽力P3', s.id, s.id + '.mp3', PAGES_LISTENING, segs,
      { scriptWords: s.dialogue.map((t) => t.text).join(' '), slots: [slot(accOf.M, 'M'), slot(accOf.F, 'F')] });
  });
  // 聽力 P4：口音輪替、性別照資料 speaker
  ranked(L.loadAll(/^listening_p4_b.*\.json$/)).forEach(({ q: s, i }) => {
    const accent = ACC[i % 4], gender = (s.speaker || 'M') === 'M' ? 'M' : 'F';
    const t = s.talk.replace(/\n/g, ' ');
    add('聽力P4', s.id, s.id + '.mp3', PAGES_LISTENING, [{ text: t, voice: listeningVoice(cfg, accent, gender, s.id), rate: R }],
      { scriptWords: t, slots: [slot(accent, gender)] });
  });

  // 英語耳與其他：沿用現在的聲音對照
  const G = cfg.legacy;
  const num = (id, from) => parseInt(String(id).slice(from), 10);
  L.loadAll(/^ear_dictation.*\.json$/).forEach((q) => {
    add('英語耳聽寫', q.id, q.id + '.mp3', ['listening.html'], [{ text: q.text, voice: G.US[num(q.id, 2) % 2 ? 'F' : 'M'], rate: R }]);
  });
  L.loadAll(/^ear_pairs.*\.json$/).forEach((q) => {
    add('英語耳易混音', q.id, q.id + '.mp3', ['listening.html'], [{ text: q.audioText, voice: G.US[num(q.id, 3) % 2 ? 'M' : 'F'], rate: R }]);
  });
  L.loadAll(/^ear_numbers.*\.json$/).forEach((q) => {
    add('英語耳數字', q.id, q.id + '.mp3', ['listening.html'], [{ text: q.audioText, voice: G.US2[num(q.id, 2) % 2 ? 'F' : 'M'], rate: R }]);
  });
  L.rd('ear_dictation.json').forEach((q) => {
    add('中文翻譯', 'dz-' + q.id.slice(2), 'dz-' + q.id.slice(2) + '.mp3', ['listening.html'], [{ text: q.zh, voice: G.zh, rate: R }]);
  });
  ranked(L.loadAll(/^ear_shadow.*\.json$/)).forEach(({ q, i }) => {
    const acc = G.shadowAccents[i % 4];
    add('英語耳跟讀', q.id, q.id + '.mp3', ['listening.html'], [{ text: q.text, voice: G[acc][i % 2 ? 'F' : 'M'], rate: R }]);
    add('中文翻譯', 'dz-' + q.id, 'dz-' + q.id + '.mp3', ['listening.html'], [{ text: q.zh, voice: G.zh, rate: R }]);
  });
  // 對話練習：A、B 異性＝美國主組；同性別時 B 改第二組
  L.rd('dialogues.json').forEach((d) => {
    const gA = d.speakers.A.gender, gB = d.speakers.B.gender;
    const voice = { A: G.US[gA], B: gA === gB ? G.US2[gB] : G.US[gB] };
    d.lines.forEach((l, i) => {
      const id = d.id + '-' + String(i + 1).padStart(2, '0');
      add('對話練習', id, 'dlg/' + id + '.mp3', ['dialogue.html'], [{ text: l.en, voice: voice[l.s], rate: R }]);
    });
  });
  addPhonics(L, cfg, add);
  applyOverrides(items, cfg);
  items.forEach((it) => finish(it, cfg));
  return items;
}

function addPhonics(L, cfg, add) {
  const G = cfg.legacy;
  const WORD_RE = /^[A-Za-z][A-Za-z'-]*$/;
  const slug = (w) => w.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const words = new Map(), sents = new Map();
  L.glob(/^phonics_ch.*\.json$/).forEach((f) => L.rd(f).forEach((u) => {
    const addw = (w) => { if (w && WORD_RE.test(w) && !words.has(slug(w))) words.set(slug(w), w); };
    addw((u.key || {}).word);
    let n = 0;
    (u.lesson || []).forEach((b) => {
      if (b.t === 'words') (b.items || []).forEach((it) => addw(it.w));
      else if (b.t === 'pairs') (b.items || []).forEach((it) => { addw(it.a); addw(it.b); });
      else if (b.t === 'sent') { n++; sents.set('s-' + u.id + '-' + n, b.en); }
    });
    (u.quiz || []).forEach((q) => {
      addw(q.word);
      const opts = q.options || [];
      if (opts.every((o) => WORD_RE.test(String(o)))) opts.forEach(addw);
    });
  }));
  const alt = new Set(G.phonicsAltWords);
  [...words.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([k, w]) => {
    const isAlt = alt.has(w.toLowerCase());
    const text = isAlt ? (G.phonicsAltText[w.toLowerCase()] || w) : w;
    add('發音單字', 'ph-' + k, 'ph-' + k + '.mp3', ['phonics.html'],
      [{ text, voice: isAlt ? G.phonicsAlt : G.phonics, rate: cfg.rates.phonicsWord }]);
  });
  [...sents.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([k, s]) => {
    add('發音句子', 'ph-' + k, 'ph-' + k + '.mp3', ['phonics.html'], [{ text: s, voice: G.phonics, rate: cfg.rates.phonicsSentence }]);
  });
}

/* overrides：{ "l3-11.mp3": { "voices": [說話順序的聲音...], "rate": "+8%" } }
   voices 依「這個檔裡第一次出現的聲音」依序替換；rate 套用到全部段落 */
function applyOverrides(items, cfg) {
  const ov = cfg.overrides || {};
  for (const it of items) {
    const o = ov[it.file] || ov[it.id];
    if (!o) continue;
    const order = [];
    it.segments.forEach((s) => { if (s.text !== undefined && !order.includes(s.voice)) order.push(s.voice); });
    it.segments.forEach((s) => {
      if (s.text === undefined) return;
      if (o.voices && o.voices[order.indexOf(s.voice)]) s.voice = o.voices[order.indexOf(s.voice)];
      if (o.rate) s.rate = o.rate;
    });
    it.overridden = true;
  }
}

/* 校準用起始語速與目標：只有 cfg.speed.targets 有列的類別 */
function speedTarget(it, cfg) {
  const t = cfg.speed.targets[it.category];
  if (!t) return null;
  const spread = (((hash32(it.id + '|speed') % 17) - 8) / 8) * (cfg.speed.spreadPct / 100);
  const aim = Math.min(t.max, Math.max(t.min, t.mean * (1 + spread)));
  return { min: t.min, max: t.max, aim: Math.round(aim * 10) / 10 };
}
function clampRate(pct, cfg) { return Math.min(cfg.speed.rateMaxPct, Math.max(cfg.speed.rateMinPct, pct)); }
/* 把 wpm 量測換成新語速：語速是倍數，新倍數＝舊倍數×(目標÷實測) */
function nextRate(curRate, wpm, aim, cfg) {
  const f = (1 + rateNum(curRate) / 100) * (aim / wpm);
  return fmtRate(clampRate((f - 1) * 100, cfg));
}
function withRate(it, rate) {
  return Object.assign({}, it, { segments: it.segments.map((s) => (s.text === undefined ? s : Object.assign({}, s, { rate }))) });
}

/* 算每個檔的字數、請求數、計費字元，並設定校準的起始語速 */
function finish(it, cfg) {
  const target = speedTarget(it, cfg);
  if (target && !it.overridden) {
    const nat = cfg.speed.naturalWpm || {};
    const voices = [...new Set(it.segments.filter((s) => s.text !== undefined).map((s) => s.voice))];
    if (voices.every((v) => nat[v])) {
      const avg = voices.reduce((a, v) => a + nat[v], 0) / voices.length;
      const rate = fmtRate(clampRate((target.aim / avg - 1) * 100, cfg));
      it.segments.forEach((s) => { if (s.text !== undefined) s.rate = rate; });
    }
  }
  it.speed = target;
  recount(it);
  if (it.scriptWords !== undefined) { it.words = wordCount(it.scriptWords); }
  else if (it.category !== '中文翻譯') it.words = wordCount(it.segments.filter((s) => s.text !== undefined).map((s) => s.text).join(' '));
}
function recount(it) {
  const texts = it.segments.filter((s) => s.text !== undefined);
  it.requests = texts.length;
  it.chars = texts.reduce((a, s) => a + [...s.text].length, 0);
  it.billChars = texts.reduce((a, s) => a + azureChars(s.text), 0);
  it.ssmlChars = texts.reduce((a, s) => a + prosodyLen(s.rate), 0);
  it.escExtraChars = texts.reduce((a, s) => a + azureChars(escXml(s.text)) - azureChars(s.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')), 0);
  it.voices = [...new Set(texts.map((s) => s.voice))];
  return it;
}

/* ---------- 篩選 ---------- */
function categoryNames(spec) {
  if (!spec) return null;
  const out = new Set();
  for (const raw of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    const key = raw.toLowerCase();
    const codes = GROUPS[key] || (CATEGORIES[key] ? [key] : null);
    if (codes) codes.forEach((c) => out.add(CATEGORIES[c]));
    else if (Object.values(CATEGORIES).includes(raw)) out.add(raw);
    else throw new Error('不認得的類別：' + raw + '（可用：' + Object.keys(CATEGORIES).concat(Object.keys(GROUPS)).join('、') + '）');
  }
  return out;
}
function filterItems(items, opts) {
  const cats = categoryNames(opts.category);
  const only = opts.only ? String(opts.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
  return items.filter((it) => {
    if (cats && !cats.has(it.category)) return false;
    if (only && !only.some((o) => (o.endsWith('*') ? it.id.startsWith(o.slice(0, -1)) : (o === it.id || o === it.file || o === path.basename(it.file))))) return false;
    return true;
  });
}

/* ---------- 統計 ---------- */
function summarize(list) {
  const cats = {};
  for (const it of list) {
    const c = (cats[it.category] = cats[it.category] || { files: 0, requests: 0, billChars: 0, ssmlChars: 0, escExtraChars: 0 });
    c.files++; c.requests += it.requests; c.billChars += it.billChars; c.ssmlChars += it.ssmlChars; c.escExtraChars += it.escExtraChars;
  }
  const total = { files: 0, requests: 0, billChars: 0, ssmlChars: 0, escExtraChars: 0 };
  for (const c of Object.values(cats)) for (const k in total) total[k] += c[k];
  return { cats, total };
}
const usd = (chars, cfg) => Math.round((chars / 1e6) * cfg.pricePerMillionChars * 100) / 100;

/* 口音、性別配額（聽力 Part 1-4）：每個 Part 內以聲線位置計 */
function quotaReport(items, cfg) {
  const q = cfg.quota, out = {};
  for (const cat of ['聽力P1', '聽力P2', '聽力P3', '聽力P4']) {
    const slots = items.filter((it) => it.category === cat).flatMap((it) => it.slots || []);
    if (!slots.length) continue;
    const pct = (n) => Math.round((n / slots.length) * 1000) / 10;
    const accents = {}, genders = { M: 0, F: 0 };
    cfg.accents.forEach((a) => { accents[a] = 0; });
    slots.forEach((s) => { accents[s.accent]++; genders[s.gender]++; });
    const problems = [];
    for (const a of cfg.accents) if (Math.abs(pct(accents[a]) - q.accentTargetPct) > q.accentTolerancePct) problems.push('口音 ' + a + ' ' + pct(accents[a]) + '%');
    for (const g of ['M', 'F']) if (Math.abs(pct(genders[g]) - q.genderTargetPct) > q.genderTolerancePct) problems.push('性別 ' + g + ' ' + pct(genders[g]) + '%');
    out[cat] = { slots: slots.length, accents, genders, accentPct: Object.fromEntries(cfg.accents.map((a) => [a, pct(accents[a])])), genderPct: { M: pct(genders.M), F: pct(genders.F) }, problems };
  }
  return out;
}

function build(repo, cfg) {
  const items = buildItems(repo || REPO, cfg || loadVoices());
  const ids = new Set(), files = new Set();
  for (const it of items) {
    if (files.has(it.file)) throw new Error('檔名重複：' + it.file);
    files.add(it.file); ids.add(it.id);
  }
  return items;
}

module.exports = {
  REPO, CATEGORIES, GROUPS, loadVoices, build, filterItems, categoryNames, summarize, usd, quotaReport,
  ssmlFor, escXml, azureChars, rateTagLen: prosodyLen, wordCount, fmtRate, rateNum, nextRate, withRate, recount, speedTarget, hash32, pick, localeOf,
};
