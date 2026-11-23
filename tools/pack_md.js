/* 課表文件(Markdown)的讀法,給 tools/md_to_pack.js 用(這裡只有純函式,不讀寫檔案)。
   - 逐堂表認得兩種寫法:入門的「段 | 分鐘 | 類型 | 素材來源與選題條件 | 單位數 | 每單位秒數 | 秒數 | 計時」、
     門檻的「段 | 分 | 序 | 素材來源（模組） | 選題條件 | 難度配比 | 單位數 | 秒／單位 | 計時 | 秒數」;只讀聽力段、閱讀段的區塊
   - 單字段、小檢核段(第 0.1 節的表 C′)由規則產生,不讀逐堂表
   轉不出來的一律回 { issue },由呼叫的一方列成清單,不猜。 */
'use strict';
require('../js/lesson-rules.js');
const R = globalThis.LESSON_RULES;

const SLOT_ZH = { 單字: 'vocab', 聽力: 'listening', 閱讀: 'reading', 小檢核: 'checkpoint', 回顧: 'review', 弱點補練: 'weak', 本堂結果: 'wrapup', 聽力測驗: 'test_listening', 閱讀測驗: 'test_reading', 測驗檢討: 'test_review' };
const TITLE = { vocab: '單字', listening: '聽力', reading: '閱讀', checkpoint: '小檢核', review: '回顧', weak: '弱點補練', wrapup: '本堂結果', test_listening: '聽力測驗', test_reading: '閱讀測驗', test_review: '測驗檢討' };
const TIMING = { 引導: 'guided', 限時: 'timed', 不計時: 'untimed', 測驗: 'test' };
const ANSWER_SECONDS = { '1': 20, '2': 16, '5': 20, '3': 70, '4': 66, '6': 150 };
const LEVEL_ZH = { entry: '入門', threshold: '門檻' };
/* 分數範圍(多益成績對級表) */
const SCORE = { entry: { listening: [5, 220], reading: [5, 170], total: [10, 395] }, threshold: { listening: [225, 320], reading: [175, 270], total: [400, 595] } };
/* 英語耳的程度:入門只用初級句,門檻用初級、中級 */
const EAR_LEVEL = { entry: ['初級'], threshold: ['初級', '中級'] };
/* 沒有新字的週(入門第 12 週只回顧;門檻第 7 週期中、第 12 週不給新字),轉檔時再核對課表文件寫的句子 */
const NO_WORD_WEEKS = { entry: { weeks: [12], text: /第 12 週只回顧/ }, threshold: { weeks: [7, 12], text: /第 7 週（期中）不給新字/ } };
const STATUS_RANK = ['available', 'available_legacy', 'needs_tags', 'partial', 'new_content', 'needs_items'];
const REPLAY = { p1: 11, p2: 11, p3: 36, p4: 33 };

/* ---------- 每堂的段落骨架 ---------- */
function kindOf(no) {
  if ([1, 13, 23].indexOf(no) > -1) return 'test';
  if ([2, 14].indexOf(no) > -1) return 'test_review';
  if (no % 4 === 0) return 'checkpoint';
  if (no === 21 || no === 22) return 'timed_review';
  return 'regular';
}
/* [段, 分鐘, 固定段?, 回顧上限] */
function skeleton(no) {
  const k = kindOf(no), main = no % 2 === 1;
  if (k === 'test') return [['test_listening', 23], ['test_reading', 37]];
  if (no === 24) return [['test_review', 15], ['vocab', 4], ['checkpoint', 18], ['review', 6, 9], ['weak', 15], ['wrapup', 2]];
  if (k === 'checkpoint') return [['vocab', 4], ['checkpoint', 18], ['listening', 8], ['reading', 8], ['review', 6, 9], ['weak', 14], ['wrapup', 2]];
  if (k === 'test_review') return [['test_review', 15], ['vocab', 5], ['listening', 8], ['reading', 8], ['review', 8, 12], ['weak', 14], ['wrapup', 2]];
  return main ? [['vocab', 5], ['listening', 17], ['reading', 17], ['review', 8, 12], ['weak', 11], ['wrapup', 2]]
    : [['vocab', 5], ['listening', 15], ['reading', 15], ['review', 8, 12], ['weak', 15], ['wrapup', 2]];
}

/* ---------- Markdown 小工具 ---------- */
function cells(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t.slice(1, t.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
}
const ticks = (s) => (String(s).match(/`([^`]+)`/g) || []).map((x) => x.slice(1, -1));
/* 頂層的「、」切開(括號裡的不切) */
function splitTop(s, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(s)) {
    if (ch === '（' || ch === '(') depth++;
    if (ch === '）' || ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/* 每一堂的文字:{ no, title, lines } */
function lessonsOf(md) {
  const lines = md.split(/\r?\n/), out = [];
  let cur = null;
  lines.forEach((line) => {
    const m = /^#{3,4} 第 (\d+) 堂[\s　]+(.+?)\s*$/.exec(line);
    if (m) { cur = { no: Number(m[1]), title: m[2], lines: [] }; out.push(cur); return; }
    if (/^#{1,3} /.test(line)) cur = null;
    if (cur) cur.lines.push(line);
  });
  return out;
}

/* 0.1 節(到下一個 ## 為止) */
function alignSection(md) {
  const m = /^## 0\.1 [^\n]*\n([\s\S]*?)(?=^## )/m.exec(md);
  return m ? m[1] : '';
}

/* ---------- 堂層 ---------- */
function splitFocus(keys) {
  return { listening: keys.filter((k) => /^P[1-4]\./.test(k)), reading: keys.filter((k) => /^P[5-7]\./.test(k)) };
}
function header(lesson) {
  const h = { goals: '', keys: null, lessonId: null, week: null, kind: null };
  lesson.lines.forEach((line) => {
    const c = cells(line);
    const kv = c && c.length >= 2 ? [c[0], c[1]] : (/^- ([^：]+)：(.*)$/.exec(line) || []).slice(1);
    if (kv.length < 2) return;
    const [k, v] = kv;
    if (k === '堂號、週、堂型' || k === '堂層') {
      h.lessonId = ticks(v)[0] || null;
      const w = /第 (\d+) 週/.exec(v), kd = /種類 `([a-z_]+)`/.exec(v);
      h.week = w ? Number(w[1]) : null;
      h.kind = kd ? kd[1] : null;
    } else if (k === '本堂目標') h.goals = v;
    else if (k === '主考點') h.keys = ticks(v).filter((x) => /^P[1-7]\./.test(x));
  });
  return h;
}
function objectives(text) {
  return String(text).split(/[；。]/).map((s) => s.trim()).filter(Boolean);
}

/* ---------- 區塊:選題條件 ---------- */
const WHERE_KEYS = ['part', 'qType', 'point', 'level', 'format', 'setSize', 'maxWordCount', 'speakerCount', 'earLevel', 'unitIds', 'ids'];
const LEGACY_KEYS = ['difficulty', 'category', 'type', 'format', 'stemKeyword', 'maxWordCount'];
const VALUE = {
  part: /^P[1-7]$/, qType: /^[a-z_]+$/, point: /^[a-z_]+$/, level: /^D[1-4](–D[1-4])?$/, format: /^(single|double|triple)$/,
  setSize: /^[2-5]$/, passages: /^[1-3]$/, maxWordCount: /^\d+$/, speakerCount: /^[1-3]$/, earLevel: /^(初級|中級|進階)$/, unitIds: /^[a-z]{2}-\d{2,3}$/, ids: /^tip-P[1-7]-[a-z_]+$/,
  difficulty: /^(基礎|中級|進階)$/, category: /^\S+$/, type: /^\S+$/, stemKeyword: /^.+$/,
};
/* 「key 值、值；key 值」或「`key:值、值`」→ { key: [值] };值不符合該鍵格式的略過(例:「difficulty 不限」),
   反引號裡認不得的鍵列在 unknown */
function readPairs(text, keys) {
  const out = {}, unknown = [];
  const put = (k, v) => {
    const val = k === 'stemKeyword' ? v.trim() : v.trim().split(/[\s（]/)[0];
    if (VALUE[k].test(val)) out[k] = (out[k] || []).concat([val]);
  };
  ticks(text).forEach((t) => {
    const m = /^([A-Za-z]+):(.+)$/.exec(t);
    if (!m) return;
    if (keys.indexOf(m[1]) < 0) { unknown.push(m[1]); return; }
    m[2].split('、').forEach((v) => put(m[1], v));
  });
  const head = new RegExp('^(' + keys.join('|') + ')\\s+(.+)$');
  String(text).replace(/`[^`]*`/g, ' ').split('；').forEach((group) => {
    let cur = null;
    group.split('、').forEach((tok) => {
      const m = head.exec(tok.trim());
      if (m) { cur = m[1]; put(cur, m[2]); } else if (cur) put(cur, tok);
    });
  });
  return { pairs: out, unknown };
}
function levels(list) {
  const out = [];
  (list || []).forEach((v) => {
    const m = /^D([1-4])(?:–D([1-4]))?$/.exec(v);
    for (let i = Number(m[1]); i <= Number(m[2] || m[1]); i++) out.push('D' + i);
  });
  return out;
}
function mixOf(text) {
  const t = String(text).trim();
  if (/^(照 )?pack/.test(t)) return 'pack';
  if (/^(無|不適用)$/.test(t) || !t) return 'none';
  const mix = { D1: 0, D2: 0, D3: 0, D4: 0 };
  const parts = t.match(/D[1-4] \d+%/g);
  if (parts) { parts.forEach((p) => { mix[p.slice(0, 2)] = Number(p.slice(3, -1)) / 100; }); return mix; }
  const one = /^D([1-4])（/.exec(t);
  if (one) { mix['D' + one[1]] = 1; return mix; }
  return null;
}

/* where(新欄位)＋ 舊欄位 → 選題條件;舊欄位沒寫分類時照考點對照表補 */
function selectOf(part, w, legacy, legacyText, mix) {
  const where = { part: ['P' + part] };
  ['qType', 'point'].forEach((k) => { if (w[k]) where[k] = w[k]; });
  if (w.level) where.level = levels(w.level);
  if (w.setSize) where.setSize = w.setSize.map(Number);
  if (w.speakerCount) where.speakerCount = w.speakerCount.map(Number);
  if (w.maxWordCount) where.maxWordCount = Number(w.maxWordCount[0]);
  if (w.format) where.passages = w.format.map((f) => ({ single: 1, double: 2, triple: 3 }[f]));
  if (w.passages) where.passages = w.passages.map(Number);
  const lw = {};
  LEGACY_KEYS.forEach((k) => { if (legacy[k]) lw[k] = k === 'maxWordCount' ? Number(legacy[k][0]) : legacy[k].slice(); });
  const words = /≤(\d+) 字/.exec(legacyText);
  if (words && !lw.maxWordCount) lw.maxWordCount = Number(words[1]);
  if (!lw.category && !lw.type) {
    const keys = (where.qType || []).concat(where.point || []).map((c) => 'P' + part + '.' + c);
    if (part === '5' && where.qType && !where.point) {
      const cats = [].concat(...where.qType.map((q) => R.P5_QTYPE[q] || []));
      if (cats.length) lw.category = cats;
    } else {
      const ws = keys.map(R.bankWhere).filter(Boolean);
      const cats = [...new Set([].concat(...ws.map((x) => x.where.category || [])))], types = [...new Set([].concat(...ws.map((x) => x.where.type || [])))];
      if (cats.length && /^[25]$/.test(part)) lw.category = cats;
      if (types.length && part === '6') lw.type = types;
      const cy = ws.map((x) => x.where.canYou).filter((x) => typeof x === 'boolean');
      if (cy.length && cy.every((x) => x === cy[0])) lw.canYou = cy[0];
    }
  }
  if (part === '2' && /排除 Can you／Could you 開頭/.test(legacyText)) lw.canYou = false;
  if (part === '2' && lw.category && lw.category.length === 1 && lw.category[0] === 'Yes/No問句' && lw.canYou === undefined) lw.canYou = (where.qType || []).indexOf('request') > -1;
  const sel = { where, levelMix: mix, exclude: { seenWithinDays: 14, usedInLesson: true, sameScenarioInLesson: true } };
  if (Object.keys(lw).length) sel.legacyWhere = lw;
  return sel;
}

/* 一列 → 區塊(不含 blockId);轉不出回 { issue } */
function earModule(label) {
  if (/聽寫/.test(label)) return 'ear_dictation';
  if (/最小對立|相似音/.test(label)) return 'ear_pairs';
  if (/跟讀/.test(label)) return 'ear_shadow';
  if (/數字/.test(label)) return 'ear_numbers';
  return null;
}
function unitOf(module) {
  if (/^p[3467]$/.test(module)) return 'set';
  if (/^p[125]$/.test(module) || module === 'ear_pairs' || module === 'ear_numbers') return 'item';
  return { grammar: 'unit', tip_cards: 'card', ear_dictation: 'sentence', ear_shadow: 'sentence' }[module] || null;
}
function makeBlock(o) {
  const { module, label, count, sec, timing, where, legacy, legacyText, mix, level } = o;
  const b = { labelZh: Array.from(label).slice(0, 30).join(''), module, unit: unitOf(module), count, secondsPerUnit: sec, timing };
  if (!b.unit || !Number.isInteger(count) || count < 1 || !Number.isInteger(sec) || !timing) return { issue: '單位、單位數、秒數或計時讀不出來' };
  if (/^p[1-4]$/.test(module)) b.playsAllowed = timing === 'guided' ? 2 : 1;
  if (module === 'tip_cards') {
    if (!where.ids || !where.ids.length) return { issue: '技巧卡沒有 id' };
    b.ids = where.ids.map((id) => ({ module: 'tip_cards', id }));
    b.bankStatus = 'new_content';
  } else if (module === 'grammar') {
    if (!where.unitIds) return { issue: '文法單元沒有 unitIds' };
    b.select = { where: { unitIds: where.unitIds }, levelMix: 'none' };
    b.bankStatus = 'available';
  } else if (/^ear_/.test(module)) {
    b.select = { where: { earLevel: where.earLevel || EAR_LEVEL[level] }, levelMix: 'none' };
    b.bankStatus = 'available';
  } else {
    const part = module.slice(1);
    if (mix === null) return { issue: '難度配比讀不出來' };
    b.select = selectOf(part, where, legacy, legacyText, mix);
    const typed = /^[347]$/.test(part) && (b.select.where.qType || []).length;
    b.bankStatus = typed ? 'needs_tags' : 'available_legacy';
  }
  return { block: b };
}

/* 入門的表格:段 | 分鐘 | 類型 | 素材來源與選題條件 | 單位數 | 每單位秒數 | 秒數 | 計時 */
function rowEntryFormat(c, level) {
  const src = c[3], label = src.split('；')[0].trim();
  const [wherePart, rest] = src.split('｜舊：');
  const legacyText = rest ? rest.split('；難度')[0] : '';
  const diff = /難度\s*([^|]*)$/.exec(src);
  const w = readPairs(wherePart, ['part', 'qType', 'point', 'level', 'setSize', 'passages', 'maxWordCount', 'unitIds', 'earLevel', 'ids', 'weekWords']);
  if (w.unknown.length) return { issue: '認不得的條件：' + w.unknown.join('、') };
  const lg = readPairs(legacyText, ['difficulty', 'category', 'type', 'format', 'maxWordCount']);
  const p = w.pairs;
  const module = p.part ? 'p' + p.part[0].slice(1) : p.unitIds ? 'grammar' : p.ids ? 'tip_cards' : p.earLevel ? earModule(label) : null;
  if (!module) return { issue: '看不出是哪個模組' };
  return makeBlock({ module, label, count: Number(c[4]), sec: Number(c[5]), timing: TIMING[c[7]], where: p, legacy: lg.pairs, legacyText, mix: mixOf(diff ? diff[1] : ''), level });
}

/* 門檻的表格:段 | 分 | 序 | 素材來源（模組） | 選題條件 | 難度配比 | 單位數 | 秒／單位 | 計時 | 秒數 */
function rowThresholdFormat(c, level) {
  const mm = /^(.*?)（([a-z0-9_]+)）$/.exec(c[3]);
  if (!mm) return { issue: '素材來源沒寫模組' };
  const module = mm[2];
  const [wherePart, rest] = c[4].split('｜舊：');
  const w = readPairs(wherePart, ['part', 'qType', 'point', 'level', 'format', 'setSize', 'maxWordCount', 'speakerCount', 'earLevel', 'unitIds']);
  if (module === 'tip_cards') w.pairs.ids = (c[4].match(/tip-P[1-7]-[a-z_]+/) || []);
  const lg = readPairs(rest || '', ['difficulty', 'category', 'type', 'format', 'stemKeyword', 'maxWordCount']);
  const label = mm[1] + (/交錯/.test(c[4]) ? '（交錯）' : '');
  const count = Number((/^(\d+)/.exec(c[6]) || [])[1]);
  return makeBlock({ module, label, count, sec: Number(c[7]), timing: TIMING[c[8]], where: w.pairs, legacy: lg.pairs, legacyText: rest || '', mix: mixOf(c[5]), level });
}

/* 逐堂表 → { <段>: { minutes, rows: [區塊或 issue] } } */
function readTable(lesson, level) {
  const out = {};
  let fmt = null, slot = null;
  lesson.lines.forEach((line) => {
    const c = cells(line);
    if (!c) return;
    if (c[0] === '段') { fmt = c[1] === '分鐘' ? 'entry' : c[1] === '分' ? 'threshold' : null; return; }
    if (!fmt || /^-+$/.test(c[0])) return;
    const name = fmt === 'entry' ? SLOT_ZH[c[0]] : c[0];
    if (c[0]) { slot = name || null; if (slot && !out[slot]) out[slot] = { minutes: Number(c[1]), rows: [] }; }
    if (!slot) return;
    const src = c[3] || '';
    if (/^(段小計|段合計)$/.test(src) || ['listening', 'reading'].indexOf(slot) < 0) return;
    const r = fmt === 'entry' ? rowEntryFormat(c, level) : rowThresholdFormat(c, level);
    out[slot].rows.push(Object.assign({ text: src }, r));
  });
  return out;
}

/* ---------- 單字段(規則產生) ---------- */
/* 主課:字卡＋10 題(本週 6、上週 2、前 3 週 2);延伸 14 題(9、3、2);小檢核堂 11 題(7、2、2);
   新字第一次出現的延伸堂(前一堂是測驗)字卡＋11 題(6、3、2)。沒有新字的週那一組併到下一組 */
function vocabPlan(no, level) {
  const k = kindOf(no), week = Math.ceil(no / 2);
  const noWords = NO_WORD_WEEKS[level].weeks;
  const has = (w) => w >= 1 && noWords.indexOf(w) < 0;
  const firstOfWeek = no % 2 === 1 || k === 'test_review';
  const card = firstOfWeek && has(week);
  let want = k === 'checkpoint' ? [7, 2, 2] : no % 2 === 1 ? [6, 2, 2] : card ? [6, 3, 2] : [9, 3, 2];
  const weeks = [week, week - 1, week - 3];
  const which = ['this_week', 'last_week', 'three_weeks_ago'];
  for (let i = 0; i < 3; i++) {
    if (has(weeks[i]) || !want[i]) continue;
    const to = [0, 1, 2].filter((j) => j !== i && has(weeks[j]))[0];
    if (to === undefined) return null;
    want = want.map((v, j) => (j === to ? v + want[i] : j === i ? 0 : v));
  }
  return { card, groups: which.map((wk, i) => ({ which: wk, n: want[i] })).filter((g) => g.n > 0) };
}
function vocabBlocks(no, level) {
  const plan = vocabPlan(no, level);
  if (!plan) return null;
  const sel = (which) => ({ where: { weekWords: [which] }, levelMix: 'none' });
  const out = [];
  if (plan.card) out.push({ labelZh: '本週新字卡', module: 'article_vocab', unit: 'card', count: 1, secondsPerUnit: 60, timing: 'untimed', select: sel('this_week'), bankStatus: 'new_content' });
  const names = { this_week: '本週新字', last_week: '上週的字', three_weeks_ago: '前 3 週的字' };
  plan.groups.forEach((g) => out.push({ labelZh: names[g.which] + '小考', module: 'article_vocab', unit: 'word', count: g.n, secondsPerUnit: 20, timing: 'untimed', select: sel(g.which), bankStatus: 'new_content' }));
  return out;
}

/* ---------- 小檢核(表 C′) ---------- */
function cpKey(token) {
  if (/^P5\.vocab_\*$/.test(token)) return 'P5.cat:字彙辨析';
  return /^P[1-7]\.[a-z_:一-鿿]+$/.test(token) ? token : null;
}
/* 一格考點 → [{ key, part, n, qType, single, words }] 與 includeUnpassed */
function cpPoints(cell) {
  let text = String(cell), unpassed = false;
  if (/補位：|未過關主考點/.test(text)) { unpassed = true; text = text.replace(/；?補位：.*$/, '').replace(/＋未過關主考點/, ''); }
  const out = [], bad = [];
  const each = /^((?:`[^`]+`、?)+)\s*各\s*(\d+)$/.exec(text.trim());
  const items = each ? ticks(each[1]).map((k) => '`' + k + '` ' + each[2]) : splitTop(text, '、');
  items.forEach((it) => {
    const m = /^(?:`([^`]+)`\s*)?(?:(P7) )?(單篇 )?(\d+)\s*(組)?(?:（(.*)）)?$/.exec(it.trim());
    const key = m && m[1] ? cpKey(m[1]) : m && m[2] ? 'P7.set' : null;
    if (!m || !key) { bad.push(it); return; }
    const note = m[6] || '';
    out.push({ key, part: key.charAt(1), n: Number(m[4]), group: !!m[5] || /^[3467]$/.test(key.charAt(1)), qType: ticks(note), words: Number((/≤(\d+) 字/.exec(note) || [])[1]) || null });
  });
  return { points: out, unpassed, bad };
}
/* 考點鍵 → where 的 qType 或 point(新欄位,補標後用) */
function newWhere(key) {
  const m = /^P([1-7])\.(.+)$/.exec(key), part = m[1], code = m[2];
  if (/^[2347]$/.test(part)) return code === 'set' ? {} : { qType: [code] };
  if (part === '6') return { qType: [/^type:/.test(code) ? ({ 文法: 'grammar', 字彙: 'vocab', 句子插入: 'insertion' }[code.slice(5)] || 'grammar') : code] };
  if (part === '5') return /^cat:字彙辨析$/.test(code) ? { qType: ['vocab'] } : /^cat:/.test(code) ? {} : { point: [code] };
  return part === '1' ? { qType: ['photo'] } : {};
}
function cpBlock(pt) {
  const w = R.bankWhere(pt.key);
  const part = pt.part;
  const where = Object.assign({ part: ['P' + part] }, newWhere(pt.key));
  if (pt.qType.length) where.qType = pt.qType;
  const legacy = Object.assign({}, w.where);
  if (part === '7') { legacy.format = ['single']; where.passages = [1]; if (pt.words) { legacy.maxWordCount = pt.words; where.maxWordCount = pt.words; } }
  if (pt.key === 'P7.not') legacy.stemKeyword = ['NOT'];
  const sec = part === '7' ? 240 : ANSWER_SECONDS[part];
  const sel = { where, levelMix: 'pack', exclude: { seenWithinDays: 14, usedInLesson: true, sameScenarioInLesson: true } };
  if (Object.keys(legacy).length) sel.legacyWhere = Object.assign({}, legacy, legacy.category ? { category: legacy.category.slice() } : {});
  const b = { labelZh: '小檢核 ' + pt.key, module: 'p' + part, unit: pt.group ? 'set' : 'item', count: pt.n, secondsPerUnit: sec, timing: 'test', select: sel };
  if (/^[1-4]$/.test(part)) b.playsAllowed = 1;
  b.bankStatus = /^[347]$/.test(part) && (pt.qType.length || pt.key !== 'P' + part + '.set') ? 'needs_tags' : 'available_legacy';
  return b;
}
function fillBlocks(cell, level, answerSec) {
  const out = [], bad = [];
  splitTop(String(cell).split('；')[0], '、').forEach((t) => {
    let m;
    if ((m = /^文法單元 ([a-z]{2}-\d{2})（(\d+)）$/.exec(t))) out.push({ labelZh: '文法單元 ' + m[1], module: 'grammar', unit: 'unit', count: 1, secondsPerUnit: Number(m[2]), timing: 'untimed', select: { where: { unitIds: [m[1]] }, levelMix: 'none' }, bankStatus: 'available' });
    else if ((m = /^聽寫 (\d+) 句（(\d+)）$/.exec(t))) out.push({ labelZh: '聽寫', module: 'ear_dictation', unit: 'sentence', count: Number(m[1]), secondsPerUnit: 60, timing: 'timed', select: { where: { earLevel: EAR_LEVEL[level] }, levelMix: 'none' }, bankStatus: 'available' });
    else if ((m = /^已學單字與片語小考 (\d+) 題（(\d+)）$/.exec(t))) out.push(learnedWords(Number(m[1])));
    else if (/^未過關主考點依權重加到/.test(t)) {
      const n = Math.ceil((918 - 60 - answerSec) / 20);
      if (/已學單字與片語小考補到 ≥918 秒/.test(cell) && n > 0) out.push(learnedWords(n));
    } else bad.push(t);
  });
  return { blocks: out, bad };
}
function learnedWords(n) {
  return { labelZh: '已學單字小考', module: 'article_vocab', unit: 'word', count: n, secondsPerUnit: 20, timing: 'timed', select: { where: { weekWords: ['this_week', 'last_week', 'three_weeks_ago'] }, levelMix: 'none' }, bankStatus: 'new_content' };
}
/* 表 C′ → { <堂號>: { listening, reading, answer, total, fill } };秒數取第一個數字(「440；有補位 540」取 440) */
function firstNumber(s) {
  const m = /^([\d,]+)/.exec(String(s || '').trim());
  return m ? Number(m[1].replace(/,/g, '')) : NaN;
}
function cpTable(md) {
  const out = {};
  alignSection(md).split(/\r?\n/).forEach((line) => {
    const c = cells(line);
    if (!c || !/^\d+$/.test(c[0]) || c.length < 6) return;
    out[Number(c[0])] = { listening: c[1], reading: c[2], answer: firstNumber(c[3]), fill: c[4], total: firstNumber(c[5]) };
  });
  return out;
}

module.exports = {
  kindOf, skeleton, cells, ticks, splitTop, lessonsOf, alignSection, header, splitFocus, objectives, readPairs, mixOf, selectOf,
  rowEntryFormat, rowThresholdFormat, readTable, vocabPlan, vocabBlocks, cpPoints, cpBlock, fillBlocks, cpTable,
  STATUS_RANK, REPLAY, SCORE, LEVEL_ZH, NO_WORD_WEEKS, TITLE, EAR_LEVEL,
};
