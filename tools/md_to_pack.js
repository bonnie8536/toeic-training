/* 課表文件(Markdown)轉學習包 JSON(data/packs/pack_<級>.json,格式見 data/packs/pack_schema.json v1.2)。
   用法:node tools/md_to_pack.js --level entry --md <入門課表.md> [--out data/packs/pack_entry.json]
          [--live-through 4] [--version 1.0.0] [--date 2026-11-24] [--dry]
   課表文件不在 repo 裡,路徑一律由參數給。
   - 聽力段、閱讀段的區塊讀逐堂表;單字、小檢核、測驗檢討、測驗段照規則產生(讀法與規則在 tools/pack_md.js)。
   - 段的分鐘照堂型固定;引導聽力的重播加秒超過段時間 60 秒內:聽力段 +1 分、回顧段 −1 分(上限 −1 單位),
     再跟課表第 0.1 節列的堂號核對。
   - 轉不出來的列不猜:不放進 JSON,列在最後。開放的堂(≤ liveThrough)有轉不出的列就不寫檔、exit 1;之後的堂只列出來。
   寫完要再跑 node tools/check_packs.js。 */
'use strict';
const fs = require('fs');
const path = require('path');
const M = require('./pack_md.js');

/* 前測、期中、後測:專用卷上線前用過渡期半回卷 */
const TEST_KIND = { 1: 'pretest', 13: 'midterm', 23: 'posttest' };
const TEST_SEC = { test_listening: [1380, '半回卷聽力'], test_reading: [2220, '半回卷閱讀'] };
const pad = (n) => (n < 10 ? '0' : '') + n;

/* 0.1 節寫的「第 n、m 堂聽力段 a → b 分」 */
function replayListed(md) {
  const out = new Set(), re = /第 ([\d、]+) 堂聽力段 (\d+) → (\d+) 分/g;
  let m;
  while ((m = re.exec(M.alignSection(md)))) m[1].split('、').forEach((n) => out.add(Number(n)));
  return out;
}
function replaySeconds(blocks) {
  return blocks.filter((b) => b.timing === 'guided' && M.REPLAY[b.module]).reduce((a, b) => a + b.count * M.REPLAY[b.module], 0);
}
const secondsOf = (blocks) => blocks.reduce((a, b) => a + b.count * b.secondsPerUnit, 0);

/* ---------- 包層 ---------- */
function difficultyMix(md) {
  const m = /D1 (\d+)%、D2 (\d+)%、D3 (\d+)%、D4 (\d+)%/.exec(md);
  if (!m) return null;
  const v = m.slice(1).map(Number);
  return v.reduce((a, x) => a + x, 0) === 100 ? { D1: v[0] / 100, D2: v[1] / 100, D3: v[2] / 100, D4: v[3] / 100 } : null;
}
function legacyCell(key) {
  return key === 'P6.grammar' ? 'P6.type:文法' : key === 'P6.vocab' ? 'P6.type:字彙' : key;
}
function mainPoints(md, issues) {
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex((l) => /mainPoints/.test(l) && !/^\s*\|/.test(l));
  const out = { listening: [], reading: [] };
  lines.slice(at + 1, at + 14).forEach((l) => {
    const m = /^\s*[|-]\s*(聽力|閱讀)\s*（?(\d+)/.exec(l);
    if (!m) return;
    const keys = M.ticks(l.replace(/（補標後[^）]*）/g, '')).filter((k) => /^P[1-7]\./.test(k));
    const track = m[1] === '聽力' ? 'listening' : 'reading';
    if (keys.length !== Number(m[2])) issues.push({ no: 0, at: 'mainPoints', why: track + ' 寫 ' + m[2] + ' 個、讀到 ' + keys.length + ' 個' });
    out[track] = keys;
  });
  if (at < 0 || !out.listening.length || !out.reading.length) issues.push({ no: 0, at: 'mainPoints', why: '找不到主考點清單' });
  return out;
}
function cellKeys(text) {
  const out = [], re = /`(P[1-7])\.([^`]+)`|(P[1-7])\s*`([^`]+)`|`([^`]+)`/g;
  let part = null, m;
  while ((m = re.exec(text))) {
    if (m[1]) part = m[1];
    else if (m[3]) part = m[3];
    const code = m[2] || m[4] || m[5];
    if (!part || !/^[a-z_]+$/.test(code)) continue;
    const key = legacyCell(part + '.' + code);
    if (out.indexOf(key) < 0) out.push(key);
  }
  return out;
}
function pointCells(md, issues) {
  const lines = md.split(/\r?\n/);
  let at = lines.findIndex((l) => /\|\s*聽力主考點\s*\|/.test(l));
  if (at < 0) at = lines.findIndex((l) => /\|\s*聽力 Part 與考點\s*\|/.test(l));
  const head = at < 0 ? [] : M.cells(lines[at]);
  const li = head.findIndex((c) => /^聽力(主考點| Part 與考點)$/.test(c)), ri = head.findIndex((c) => /^閱讀(主考點| Part 與考點)$/.test(c));
  const out = [];
  for (let i = at + 2; at >= 0 && i < lines.length; i++) {
    const c = M.cells(lines[i]);
    if (!c) break;
    const w = Number(c[0]);
    if ([2, 3, 4, 5, 6, 8, 9, 10, 11].indexOf(w) < 0) continue;
    [['listening', li], ['reading', ri]].forEach(([track, idx]) => {
      const keys = cellKeys(c[idx] || '');
      if (!keys.length || keys.length > 4) issues.push({ no: 0, at: 'pointCells', why: '第 ' + w + ' 週' + track + ' 讀到 ' + keys.length + ' 個考點' });
      else out.push({ week: w, track, keys });
    });
  }
  if (out.length !== 18) issues.push({ no: 0, at: 'pointCells', why: '主考點格要 18 格，讀到 ' + out.length + ' 格' });
  return out;
}

/* ---------- 段 ---------- */
function testSegment(slot, order) {
  const [sec, label] = TEST_SEC[slot];
  return {
    slot, order, titleZh: M.TITLE[slot], minutes: slot === 'test_listening' ? 23 : 37, fixed: true, track: slot === 'test_listening' ? 'listening' : 'reading',
    blocks: [{ labelZh: label, module: 'test_forms', unit: 'form', count: 1, secondsPerUnit: sec, timing: 'test', ids: [{ module: 'test_forms', id: 'interim_half' }], bankStatus: 'available_legacy' }],
  };
}
function checkpointPart(no, ctx, issues) {
  const row = ctx.cp[no];
  if (!row) { issues.push({ no, at: 'checkpoint', why: '第 0.1 節的表 C′ 沒有這一堂' }); return null; }
  const L = M.cpPoints(row.listening), Rd = M.cpPoints(row.reading);
  L.bad.concat(Rd.bad).forEach((t) => issues.push({ no, at: 'checkpoint', text: t, why: '考點與題量讀不出來' }));
  const pts = L.points.concat(Rd.points);
  if (!L.points.length || !Rd.points.length || L.points.length > 3 || Rd.points.length > 3) {
    issues.push({ no, at: 'checkpoint', why: '聽讀考點數要各 1–3 個' });
    return null;
  }
  const blocks = pts.map(M.cpBlock);
  const answer = secondsOf(blocks);
  if (answer !== row.answer) issues.push({ no, at: 'checkpoint', why: '檢核作答秒數算出 ' + answer + '，表上寫 ' + row.answer });
  const fill = M.fillBlocks(row.fill, ctx.level, answer);
  fill.bad.forEach((t) => issues.push({ no, at: 'checkpoint', text: t, why: '補足區塊讀不出來' }));
  const total = answer + 60 + secondsOf(fill.blocks);
  if (total !== row.total) issues.push({ no, at: 'checkpoint', why: '段合計算出 ' + total + '，表上寫 ' + row.total });
  const cw = no === 24 ? [11] : [no / 2 - 1, no / 2];
  return {
    blocks, fill: fill.blocks,
    checkpoint: {
      coversWeeks: cw, listening: L.points.map((p) => p.key), reading: Rd.points.map((p) => p.key), itemsPerPoint: { single: 5, group: 2 },
      includeUnpassed: L.unpassed || Rd.unpassed, rules: { meetAt: 4, weakAt: 2 }, answerSeconds: answer,
    },
  };
}

/* 一堂的段(還沒編 blockId) */
function segmentsOf(no, table, ctx, issues, extra) {
  return M.skeleton(no).map(([slot, minutes, maxUnits], i) => {
    const seg = { slot, order: i + 1, titleZh: M.TITLE[slot], minutes, fixed: slot !== 'review' && slot !== 'weak' };
    seg.track = slot === 'listening' ? 'listening' : slot === 'reading' || slot === 'vocab' ? 'reading' : 'both';
    if (slot === 'test_listening' || slot === 'test_reading') return testSegment(slot, i + 1);
    if (slot === 'review') return Object.assign(seg, { rule: 'review_v1', maxUnits });
    if (slot === 'weak') return Object.assign(seg, { rule: 'weak_v1' });
    if (slot === 'wrapup') return Object.assign(seg, { rule: 'wrapup_v1' });
    if (slot === 'test_review') return Object.assign(seg, { rule: 'test_review_v1' });
    if (slot === 'vocab') {
      const b = M.vocabBlocks(no, ctx.level);
      if (!b) issues.push({ no, at: 'vocab', why: '這一週與前幾週都沒有新字' });
      return Object.assign(seg, { blocks: b || [] });
    }
    if (slot === 'checkpoint') {
      const c = checkpointPart(no, ctx, issues);
      if (c) extra.checkpoint = Object.assign(c.checkpoint, { fill: c.fill });
      return Object.assign(seg, { blocks: c ? c.blocks : [] });
    }
    const t = table[slot];
    if (!t) { issues.push({ no, at: slot, why: '逐堂表沒有這一段' }); return Object.assign(seg, { blocks: [] }); }
    if (t.minutes !== minutes && t.minutes !== minutes + 1) issues.push({ no, at: slot, why: '逐堂表寫 ' + t.minutes + ' 分，這種堂是 ' + minutes + ' 分' });
    t.rows.filter((r) => r.issue).forEach((r) => issues.push({ no, at: slot, text: r.text, why: r.issue }));
    return Object.assign(seg, { blocks: t.rows.filter((r) => r.block).map((r) => r.block) });
  });
}

/* 引導聽力的重播:超出 ≤60 秒,聽力 +1 分、回顧 −1 分與上限 −1 */
function applyReplay(no, segs, issues) {
  const lis = segs.filter((s) => s.slot === 'listening')[0], rev = segs.filter((s) => s.slot === 'review')[0];
  if (!lis || !rev) return false;
  const over = secondsOf(lis.blocks) + replaySeconds(lis.blocks) - lis.minutes * 60;
  if (over <= 0) return false;
  if (over > 60) { issues.push({ no, at: 'listening', why: '加上重播超過段時間 ' + over + ' 秒（只接受 60 秒內）' }); return false; }
  lis.minutes += 1;
  rev.minutes -= 1;
  rev.maxUnits -= 1;
  return true;
}

function numberBlocks(lessonId, segs, cp) {
  segs.forEach((s) => (s.blocks || []).forEach((b, i) => { b.blockId = lessonId + '-' + s.slot + '-' + (i + 1); }));
  if (cp) {
    const n = segs.filter((s) => s.slot === 'checkpoint')[0].blocks.length;
    cp.fill.forEach((b, i) => { b.blockId = lessonId + '-checkpoint-' + (n + i + 1); });
  }
}
/* 欄位照 schema 的順序排好 */
function order(o, keys) {
  const out = {};
  keys.forEach((k) => { if (o[k] !== undefined) out[k] = o[k]; });
  return out;
}
const BLOCK_KEYS = ['blockId', 'labelZh', 'module', 'unit', 'count', 'secondsPerUnit', 'timing', 'playsAllowed', 'select', 'ids', 'bankStatus'];

function buildLesson(L, ctx, issues) {
  const no = L.no, kind = M.kindOf(no), week = Math.ceil(no / 2), lessonId = ctx.level + '-L' + pad(no);
  const h = M.header(L);
  if (h.lessonId !== lessonId || h.week !== week || h.kind !== kind) issues.push({ no, at: 'header', why: '堂號、週或種類跟規則不同：' + [h.lessonId, h.week, h.kind].join('、') });
  const titleLen = Array.from(L.title).length;
  if (titleLen < 2 || titleLen > 20) issues.push({ no, at: 'title', why: '堂名要 2–20 字：' + L.title });
  const goals = M.objectives(h.goals);
  const okGoals = goals.filter((g) => Array.from(g).length >= 4 && Array.from(g).length <= 30).slice(0, 3);
  if (okGoals.length !== goals.length) issues.push({ no, at: 'objectives', why: '本堂目標每句要 4–30 字、最多 3 句：' + h.goals });
  const focus = kind === 'test' ? { listening: [], reading: [] } : M.splitFocus((h.keys || []).map(legacyCell));
  if (kind !== 'test') ['listening', 'reading'].forEach((t) => {
    const cell = ctx.cells.filter((c) => c.week === week && c.track === t)[0];
    if (!focus[t].length && cell) { focus[t] = cell.keys.slice(); ctx.notes.push('第 ' + no + ' 堂的' + (t === 'listening' ? '聽力' : '閱讀') + '主考點沒寫，用第 ' + week + ' 週的主考點格'); }
  });
  const extra = {};
  const segs = segmentsOf(no, M.readTable(L, ctx.level), ctx, issues, extra);
  if (applyReplay(no, segs, issues)) ctx.replayed.add(no);
  numberBlocks(lessonId, segs, extra.checkpoint);
  const all = [].concat(...segs.map((s) => s.blocks || []), extra.checkpoint ? extra.checkpoint.fill : []);
  const fixedMin = segs.filter((s) => s.fixed).reduce((a, s) => a + s.minutes, 0);
  const worst = all.reduce((a, b) => Math.max(a, M.STATUS_RANK.indexOf(b.bankStatus)), 0);
  const lesson = {
    lessonId, no, week, lessonType: no % 2 ? 'main' : 'extension', kind, titleZh: L.title, minutes: 60, focus,
    objectivesZh: okGoals, segments: segs.map((s) => Object.assign(s, s.blocks ? { blocks: s.blocks.map((b) => order(b, BLOCK_KEYS)) } : {})),
    fixedShare: kind === 'test' ? 1 : Math.round(fixedMin / 60 * 100) / 100, bankStatus: M.STATUS_RANK[worst],
  };
  if (extra.checkpoint) lesson.checkpoint = Object.assign(extra.checkpoint, { fill: extra.checkpoint.fill.map((b) => order(b, BLOCK_KEYS)) });
  if (kind === 'test') lesson.test = { kind: TEST_KIND[no], form: 'interim_half', blueprint: 'half_v1' };
  return lesson;
}

/* opt = { level, liveThrough, version, date } → { pack, issues, notes } */
function buildPack(md, opt) {
  const level = opt.level, issues = [], notes = [];
  if (!M.LEVEL_ZH[level]) throw new Error('這一版只轉入門(entry)、門檻(threshold)');
  if (!M.NO_WORD_WEEKS[level].text.test(md)) issues.push({ no: 0, at: 'vocab', why: '課表文件沒寫哪幾週沒有新字，單字段的週次對不上' });
  const ctx = { level, cp: M.cpTable(md), notes, replayed: new Set() };
  ctx.cells = pointCells(md, issues);
  const lessons = M.lessonsOf(md).map((L) => buildLesson(L, ctx, issues));
  if (lessons.map((l) => l.no).join() !== Array.from({ length: 24 }, (_, i) => i + 1).join()) issues.push({ no: 0, at: 'lessons', why: '逐堂表要剛好第 1 到 24 堂' });
  const listed = replayListed(md);
  const a = [...ctx.replayed].sort((x, y) => x - y).join('、'), b = [...listed].sort((x, y) => x - y).join('、');
  if (a !== b) issues.push({ no: 0, at: 'listening', why: '算出要加重播時間的堂是 ' + (a || '無') + '，第 0.1 節寫 ' + (b || '無') });
  const mix = difficultyMix(md);
  if (!mix) issues.push({ no: 0, at: 'difficultyMix', why: '找不到難度配比' });
  const delta = /前測預估分數（取 5 的倍數）＋(\d+)/.exec(md);
  if (!delta) issues.push({ no: 0, at: 'termGoal', why: '找不到分數目標的加分' });
  const liveThrough = opt.liveThrough;
  const pack = {
    schemaVersion: '1.2', packId: 'pack-' + level + '-v1', level, nameZh: M.LEVEL_ZH[level], packVersion: opt.version,
    status: liveThrough > 0 ? 'live' : 'draft', liveThrough, specRefs: ['00-v1.2'], scoreRange: M.SCORE[level],
    difficultyMix: mix || { D1: 0, D2: 1, D3: 0, D4: 0 }, weeks: 12, lessonsPerWeek: 2, mainPoints: mainPoints(md, issues).valueOf(), pointCells: ctx.cells,
    termGoal: { scoreDelta: { listening: delta ? Number(delta[1]) : 0, reading: delta ? Number(delta[1]) : 0 }, scoreCap: 495, completion: { twicePerWeek: 20, oncePerWeek: 10 }, cellsPassed: 9, scoreVisibleToStudent: false },
    weeklyGoals: { completionRate: 0.8, studyDays: { twicePerWeek: 3, oncePerWeek: 2 }, focusAccuracy: 0.6, pointMet: { minItems: 5, rate: 0.8, groupWindow: 'week' }, reviewDone: 0.8, testWeeks: { studyDays: { twicePerWeek: 2, oncePerWeek: 1 } } },
    lessons,
    authoring: { designer: 'designer:' + level, updatedAt: opt.date, changeNote: '由課表文件轉出（tools/md_to_pack.js）；開放到第 ' + liveThrough + ' 堂' },
  };
  return { pack, issues, notes };
}

function args(argv) {
  const o = { liveThrough: 0, version: '1.0.0', date: new Date().toISOString().slice(0, 10), dry: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--level') { o.level = v; i++; } else if (k === '--md') { o.md = v; i++; } else if (k === '--out') { o.out = v; i++; }
    else if (k === '--live-through') { o.liveThrough = Number(v); i++; } else if (k === '--version') { o.version = v; i++; }
    else if (k === '--date') { o.date = v; i++; } else if (k === '--dry') o.dry = true;
    else throw new Error('認不得的參數：' + k);
  }
  if (!o.level || !o.md) throw new Error('要給 --level 與 --md');
  if (!Number.isInteger(o.liveThrough) || o.liveThrough < 0 || o.liveThrough > 24) throw new Error('--live-through 要是 0 到 24');
  if (!/^\d+\.\d+\.\d+$/.test(o.version)) throw new Error('--version 要是 主.次.修');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Error('--date 要是 YYYY-MM-DD');
  return o;
}

function main(argv) {
  let o;
  try { o = args(argv); } catch (e) { console.error(e.message); return 2; }
  let md;
  try { md = fs.readFileSync(o.md, 'utf8'); } catch (e) { console.error('讀不到課表文件：' + e.message); return 2; }
  const { pack, issues, notes } = buildPack(md, o);
  const blocking = issues.filter((x) => x.no === 0 || x.no <= o.liveThrough);
  notes.forEach((n) => console.log('說明　' + n));
  issues.forEach((x) => console.log((x.no === 0 || x.no <= o.liveThrough ? '不能轉　' : '待補　') + (x.no ? '第 ' + x.no + ' 堂 ' : '') + x.at + '：' + x.why + (x.text ? '（' + x.text + '）' : '')));
  if (blocking.length) { console.log('有 ' + blocking.length + ' 項會影響開放的堂或整包，沒有寫檔'); return 1; }
  const out = o.out || path.join(__dirname, '..', 'data', 'packs', 'pack_' + o.level + '.json');
  if (!o.dry) fs.writeFileSync(out, JSON.stringify(pack, null, 2) + '\n');
  console.log((o.dry ? '試轉完成（沒有寫檔）' : '寫好 ' + path.relative(process.cwd(), out)) + '：24 堂，開放到第 ' + o.liveThrough + ' 堂；待補 ' + issues.length + ' 項');
  return 0;
}

module.exports = { buildPack, buildLesson, mainPoints, pointCells, cellKeys, difficultyMix, replayListed, applyReplay, args };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
