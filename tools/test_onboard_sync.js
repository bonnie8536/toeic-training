/* 新用戶設定起始程度的三個帳號鍵(levels、onboard、self_score)多台裝置的合併。
   以前三個鍵整份上傳、後傳的蓋掉先傳的:舊裝置離線時排隊的上傳,之後補傳會蓋掉雲端較新的那一份。
   現在跟模擬考紀錄一樣先讀雲端、合併、再上傳(js/cloud.js MERGED;合併函式在 js/sync-merge.js):
   - levels:主值(兩科、來源)留 setAt 較新的那一份;history 兩份聯集,照 at 排序,留最新 20 筆。
   - onboard 看 updatedAt、self_score 看 enteredAt,整份留較新的那一份。
   - 缺時間欄位的輸給有時間的;格式壞掉(不是物件)的輸給好的;認不得的版本(v 不是 1)不合併、不上傳、帳本留著。
   第 D 段:既有的鍵(hist、diag、題庫、刪除標記、模擬考紀錄、模擬考錯題)同一串動作,用改之前的 cloud.js
   (tools/fixtures/cloud_before_onboard_merge.js,加這三個鍵之前的 main)和現在的 cloud.js 各跑一次,請求、雲端、本機逐項相同。
   第 E 段:裝置時鐘不準。寫入端的時間只往前走(js/onboard-core.js stampAfter),合併時超過現在一天的時間當成沒有時間。
   第 F 段:設定流程接上新檢測(placement_v1):手機做完的檢測,電腦灌資料後認得「看起始程度」,兩台各自的檢測紀錄都留著。
   用法:node tools/test_onboard_sync.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const H = require('./sync_harness');
const { J, makeWorld, makeDevice, signIn, newSession, localOf, cloudOf, ledgerOf, setCloud, storeSet, now, PREFIX } = H;

const HOUR = 3600e3;
const iso = (t) => new Date(t).toISOString();
const NEW_KEYS = ['levels', 'onboard', 'self_score'];

/* ---------- 合併函式(純計算) ---------- */
const smCtx = { console };
smCtx.window = smCtx;
vm.createContext(smCtx);
vm.runInContext(read('js/sync-merge.js'), smCtx);
const SM = smCtx.SYNC_MERGE;
const need = (name) => { if (!SM || typeof SM[name] !== 'function') throw new Error('還沒有 SYNC_MERGE.' + name); return SM[name]; };
const canon = (x) => SM.canon(x);

const hist = (at, l, r, reason) => ({ at: iso(at), listening: l, reading: r, reason: reason || 'score' });
function levels(l, r, at, history) {
  return { listening: l, reading: r, source: { listening: 'score', reading: 'score' }, setAt: iso(at), history: history || [hist(at, l, r)] };
}
function onboard(status, step, at) {
  return { v: 1, status, step, path: 'self', targetScore: 600, examMonth: '2027-01', levelSource: 'score', testFrom: null, previous: null,
    startedAt: iso(at - HOUR), doneAt: status === 'done' ? iso(at) : null, updatedAt: iso(at) };
}
function selfScore(l, r, at) { return { listening: l, reading: r, total: l + r, examYm: '2026-09', fromTotal: false, enteredAt: iso(at) }; }
const T0 = H.T0;

const T = {};

T['A1 SYNC_MERGE 有 levels、onboard、selfScore;兩份都沒有是 null;一份沒有就用另一份'] = () => {
  const out = ['levels', 'onboard', 'selfScore'].map((f) => {
    const fn = need(f);
    const x = f === 'levels' ? levels('entry', 'threshold', T0) : f === 'onboard' ? onboard('done', 'result', T0) : selfScore(300, 250, T0);
    const nn = fn(null, null), a = fn(null, x), b = fn(x, undefined);
    return nn.ok === true && nn.v === null && a.ok && canon(a.v) === canon(x) && !a.sameAsLocal && a.sameAsCloud
      && b.ok && canon(b.v) === canon(x) && b.sameAsLocal && !b.sameAsCloud;
  });
  return { ok: out.every(Boolean), detail: J(out) };
};

T['A2 levels:兩科、來源留 setAt 較新的那一份;history 兩份聯集、照 at 排序、一樣的只留一筆;參數順序不影響結果'] = () => {
  const L = need('levels');
  const shared = hist(T0 - 5 * HOUR, 'entry', 'entry', 'entry');
  const a = levels('threshold', 'threshold', T0 - HOUR, [shared, hist(T0 - HOUR, 'threshold', 'threshold')]);
  const b = Object.assign(levels('advanced', 'high', T0, [shared, hist(T0, 'advanced', 'high', 'legacy')]), { source: { listening: 'legacy_plus1', reading: 'legacy' } });
  const m = L(a, b), n = L(b, a);
  const ats = m.v.history.map((h) => h.at);
  const ok = m.ok && canon(m.v) === canon(n.v) && m.v.listening === 'advanced' && m.v.reading === 'high' && m.v.setAt === iso(T0)
    && m.v.source.reading === 'legacy' && m.v.history.length === 3 && J(ats) === J(ats.slice().sort()) && !m.sameAsLocal && !m.sameAsCloud;
  return { ok, detail: J(m.v) };
};

T['A3 levels:缺 setAt(或不是日期)的輸給有 setAt 的,history 照樣聯集'] = () => {
  const L = need('levels');
  const noTime = levels('high', 'high', T0 + HOUR); delete noTime.setAt;
  const badTime = Object.assign(levels('high', 'high', T0 + HOUR), { setAt: 'not-a-date' });
  const good = levels('entry', 'entry', T0 - HOUR);
  const r = [noTime, badTime].map((x) => { const m = L(x, good), n = L(good, x); return [m, n]; });
  const ok = r.every(([m, n]) => m.ok && n.ok && m.v.listening === 'entry' && m.v.setAt === good.setAt && canon(m.v) === canon(n.v) && m.v.history.length === 2);
  return { ok, detail: J(r.map(([m]) => m.v)) };
};

T['A4 格式壞掉:不是物件的那份輸給好的;壞的配上沒有、或兩份都壞,回 ok:false(不合併、不上傳);history 不是陣列當空的、不是物件的項目丟掉'] = () => {
  const L = need('levels'), O = need('onboard'), S = need('selfScore');
  const good = levels('entry', 'threshold', T0);
  const bads = ['x', 5, true, [], [good]];
  const lose = bads.every((bad) => { const m = L(bad, good), n = L(good, bad); return m.ok && n.ok && canon(m.v) === canon(good) && n.sameAsLocal && m.sameAsCloud; });
  const none = bads.every((bad) => L(bad, null).ok === false && L(null, bad).ok === false && L(bad, 'y').ok === false);
  const og = onboard('done', 'result', T0), sg = selfScore(300, 250, T0);
  const others = O('junk', og).ok && canon(O('junk', og).v) === canon(og) && S(sg, []).ok && canon(S(sg, []).v) === canon(sg) && O('a', null).ok === false && S(null, 3).ok === false;
  const weird = Object.assign(levels('entry', 'entry', T0 - HOUR), { history: 'oops' });
  const junkItems = Object.assign(levels('high', 'high', T0), { history: [hist(T0, 'high', 'high'), 'junk', null, 7] });
  const w = L(weird, junkItems);
  const items = w.ok && w.v.history.length === 1 && w.v.history[0].at === iso(T0) && w.v.listening === 'high';
  return { ok: lose && none && others && items, detail: J({ lose, none, others, items, w: w.v }) };
};

T['A5 認不得的版本(v 不是 1):任一邊是就回 ok:false,不拿舊格式蓋掉新格式'] = () => {
  const L = need('levels'), O = need('onboard'), S = need('selfScore');
  const future = (x) => Object.assign({}, x, { v: 2 });
  const r = [
    L(future(levels('entry', 'entry', T0)), levels('high', 'high', T0 + HOUR)).ok,
    L(levels('high', 'high', T0 + HOUR), future(levels('entry', 'entry', T0))).ok,
    O(onboard('done', 'result', T0 + HOUR), future(onboard('done', 'result', T0))).ok,
    O(Object.assign(onboard('done', 'result', T0), { v: 'x' }), onboard('done', 'result', T0)).ok,
    S(future(selfScore(300, 250, T0)), null).ok,
  ];
  return { ok: r.every((x) => x === false), detail: J(r) };
};

T['A6 levels.history 超過 20 筆:留 at 最新的 20 筆'] = () => {
  const L = need('levels');
  const ha = [], hb = [];
  for (let i = 0; i < 15; i++) { ha.push(hist(T0 + i * 2 * HOUR, 'entry', 'entry')); hb.push(hist(T0 + (i * 2 + 1) * HOUR, 'high', 'high')); }
  const m = L(levels('entry', 'entry', T0 + 28 * HOUR, ha), levels('high', 'high', T0 + 29 * HOUR, hb));
  const ats = m.v.history.map((h) => Date.parse(h.at));
  const ok = m.ok && m.v.history.length === 20 && ats[0] === T0 + 10 * HOUR && ats[19] === T0 + 29 * HOUR;
  return { ok, detail: J({ n: m.v.history.length, first: iso(ats[0]), last: iso(ats[19]) }) };
};

T['A7 onboard 看 updatedAt、self_score 看 enteredAt,整份留較新的;缺時間的輸;時間一樣、內容不同時兩個順序結果一樣'] = () => {
  const O = need('onboard'), S = need('selfScore');
  const oOld = onboard('done', 'result', T0 - HOUR), oNew = onboard('in_progress', 'test', T0);
  const o1 = O(oOld, oNew), o2 = O(oNew, oOld);
  const oNoT = Object.assign({}, oNew); delete oNoT.updatedAt;
  const o3 = O(oNoT, oOld);
  const sOld = selfScore(300, 250, T0 - HOUR), sNew = selfScore(400, 350, T0);
  const s1 = S(sNew, sOld), s2 = S(sOld, sNew);
  const sNoT = Object.assign({}, sNew); delete sNoT.enteredAt;
  const s3 = S(sOld, sNoT);
  const tieA = onboard('done', 'result', T0), tieB = Object.assign(onboard('done', 'result', T0), { targetScore: 785 });
  const tie = canon(O(tieA, tieB).v) === canon(O(tieB, tieA).v);
  const ok = canon(o1.v) === canon(oNew) && canon(o2.v) === canon(oNew) && o2.sameAsLocal && canon(o3.v) === canon(oOld)
    && canon(s1.v) === canon(sNew) && canon(s2.v) === canon(sNew) && canon(s3.v) === canon(sOld) && tie;
  return { ok, detail: J({ o3: o3.v && o3.v.status, s3: s3.v && s3.v.listening, tie }) };
};

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
T['A8 隨機 300 組三份:可交換、可結合、merge(x,x)=x(兩台各自合併會收斂)'] = () => {
  const R = rng(11), LV = ['entry', 'threshold', 'advanced', 'high'];
  const pick = (a) => a[Math.floor(R() * a.length)];
  const t = () => T0 + Math.floor(R() * 6) * HOUR;
  const gen = {
    levels: () => {
      if (R() < 0.08) return pick([null, 'bad', [1]]);
      const h = []; const n = Math.floor(R() * 25);
      for (let i = 0; i < n; i++) h.push(R() < 0.05 ? 'junk' : hist(t(), pick(LV), pick(LV), pick(['score', 'entry', 'legacy', 'manual'])));
      const x = { listening: pick(LV), reading: pick(LV), source: { listening: 'score', reading: 'score' }, setAt: iso(t()), history: h };
      if (R() < 0.1) delete x.setAt;
      return x;
    },
    onboard: () => { if (R() < 0.08) return pick([null, 'bad']); const x = onboard(pick(['done', 'in_progress', 'dismissed']), pick(['target', 'test', 'result']), t()); if (R() < 0.1) delete x.updatedAt; return x; },
    selfScore: () => { if (R() < 0.08) return pick([null, 3]); const x = selfScore(pick([200, 300, 400]), pick([150, 250]), t()); if (R() < 0.1) delete x.enteredAt; return x; },
  };
  const bad = [];
  Object.keys(gen).forEach((f) => {
    const fn = need(f);
    const m = (a, b) => { const r = fn(a, b); return r.ok ? r.v : { __fail: true }; };
    for (let i = 0; i < 300; i++) {
      const a = gen[f](), b = gen[f](), c = gen[f]();
      const ab = fn(a, b), ba = fn(b, a);
      if (ab.ok !== ba.ok || (ab.ok && canon(ab.v) !== canon(ba.v))) { bad.push([f, 'comm', i]); continue; }
      const okAll = fn(a, b).ok && fn(b, c).ok && fn(a, c).ok;
      if (okAll && canon(m(m(a, b), c)) !== canon(m(a, m(b, c)))) bad.push([f, 'assoc', i]);
      const aa = fn(a, a);
      if (aa.ok && (canon(aa.v) !== canon(m(a, null)) || canon(m(aa.v, a)) !== canon(aa.v))) bad.push([f, 'idem', i]);
    }
  });
  return { ok: !bad.length, detail: J(bad.slice(0, 5)) };
};

T['A9 sync-merge.js 的 history 上限跟 js/onboard-core.js 的 HISTORY_MAX 一樣'] = () => {
  const a = /HISTORY_MAX = (\d+)/.exec(read('js/onboard-core.js')), b = /LEVELS_HISTORY_MAX = (\d+)/.exec(read('js/sync-merge.js'));
  return { ok: !!a && !!b && a[1] === b[1], detail: J([a && a[1], b && b[1]]) };
};

/* ---------- B:真的 js/cloud.js(tools/sync_harness.js 的假 Supabase、兩台裝置) ---------- */
async function pair(seed) {
  const w = makeWorld(seed || 3);
  const phone = makeDevice(w, '手機'), pc = makeDevice(w, '電腦');
  await signIn(phone);
  await signIn(pc);
  return { w, phone, pc };
}
const lvNow = (dev, l, r, reason, prev) => {
  const at = now(dev) + 1000;
  const h = (prev && Array.isArray(prev.history) ? prev.history : []).concat([hist(at, l, r, reason)]);
  return { listening: l, reading: r, source: { listening: 'score', reading: 'score' }, setAt: iso(at), history: h };
};

T['B1 舊裝置晚到的上傳:手機離線改級別(T1)、電腦之後做檢測(T2)上傳,手機恢復連線補傳:雲端主值仍是 T2,history 兩筆都在'] = async () => {
  const { w, phone, pc } = await pair();
  phone.offline = true;
  const v1 = lvNow(phone, 'threshold', 'threshold', 'manual', null);
  storeSet(phone, 'levels', v1);
  await phone.pg.runTimers();
  const v2 = lvNow(pc, 'advanced', 'high', 'score', null);
  storeSet(pc, 'levels', v2);
  await pc.pg.runTimers();
  phone.offline = false;
  await phone.pg.fire('win:online');
  const c = cloudOf(w, 'levels') || {};
  const loc = localOf(phone, 'levels') || {};
  const ok = c.setAt === v2.setAt && c.listening === 'advanced' && (c.history || []).length === 2 && canon(loc) === canon(c) && !('levels' in ledgerOf(phone));
  return { ok, detail: J({ cloud: c, ledger: ledgerOf(phone) }) };
};

T['B1b 舊裝置帳本留著、隔天重新開 App(灌資料):本機與雲端合併,雲端主值仍是較新的那份'] = async () => {
  const { w, phone, pc } = await pair(4);
  phone.offline = true;
  const v1 = lvNow(phone, 'threshold', 'threshold', 'manual', null);
  storeSet(phone, 'levels', v1);
  await phone.pg.runTimers();
  const v2 = lvNow(pc, 'advanced', 'high', 'score', null);
  storeSet(pc, 'levels', v2);
  await pc.pg.runTimers();
  phone.offline = false;
  await newSession(phone);
  const c = cloudOf(w, 'levels') || {};
  const ok = c.setAt === v2.setAt && (c.history || []).length === 2 && canon(localOf(phone, 'levels')) === canon(c) && !Object.keys(ledgerOf(phone)).length;
  return { ok, detail: J({ cloud: c, local: localOf(phone, 'levels'), ledger: ledgerOf(phone) }) };
};

T['B2 onboard、self_score 舊裝置晚到的上傳:雲端留 updatedAt、enteredAt 較新的那份'] = async () => {
  const { w, phone, pc } = await pair(5);
  phone.offline = true;
  const oOld = onboard('in_progress', 'test', now(phone) + 1000);
  storeSet(phone, 'onboard', oOld);
  const sOld = selfScore(300, 250, now(phone) + 1000);
  storeSet(phone, 'self_score', sOld);
  await phone.pg.runTimers();
  const oNew = onboard('done', 'result', now(pc) + 1000);
  storeSet(pc, 'onboard', oNew);
  const sNew = selfScore(400, 350, now(pc) + 1000);
  storeSet(pc, 'self_score', sNew);
  await pc.pg.runTimers();
  phone.offline = false;
  await phone.pg.fire('win:online');
  const ok = canon(cloudOf(w, 'onboard')) === canon(oNew) && canon(cloudOf(w, 'self_score')) === canon(sNew)
    && canon(localOf(phone, 'onboard')) === canon(oNew) && canon(localOf(phone, 'self_score')) === canon(sNew) && !Object.keys(ledgerOf(phone)).length;
  return { ok, detail: J({ onboard: (cloudOf(w, 'onboard') || {}).status, self: (cloudOf(w, 'self_score') || {}).listening, ledger: ledgerOf(phone) }) };
};

T['B3 兩台同時改(都離線、各自寫,先後恢復連線):雲端是兩份合併的結果,兩台重新開 App 後本機都一樣'] = async () => {
  const { w, phone, pc } = await pair(6);
  phone.offline = true; pc.offline = true;
  storeSet(phone, 'levels', lvNow(phone, 'entry', 'threshold', 'entry', null));
  const vPc = lvNow(pc, 'high', 'advanced', 'score', null);
  storeSet(pc, 'levels', vPc);
  await phone.pg.runTimers(); await pc.pg.runTimers();
  pc.offline = false; await pc.pg.fire('win:online');
  phone.offline = false; await phone.pg.fire('win:online');
  await newSession(pc); await newSession(phone);
  const c = cloudOf(w, 'levels') || {};
  const ok = c.setAt === vPc.setAt && c.listening === 'high' && (c.history || []).length === 2
    && canon(localOf(phone, 'levels')) === canon(c) && canon(localOf(pc, 'levels')) === canon(c);
  return { ok, detail: J({ cloud: c }) };
};

T['B4 其中一份缺時間欄位:雲端那份沒有 setAt、手機帳本較新:合併後有 setAt 的贏;反過來手機那份沒有 setAt,雲端有的贏'] = async () => {
  const r = [];
  {
    const { w, phone } = await pair(8);
    const noT = levels('high', 'high', T0); delete noT.setAt;
    setCloud(w, 'levels', noT, now(phone));
    const mine = lvNow(phone, 'entry', 'entry', 'entry', null);
    storeSet(phone, 'levels', mine);
    await phone.pg.runTimers();
    r.push((cloudOf(w, 'levels') || {}).setAt === mine.setAt && (cloudOf(w, 'levels') || {}).listening === 'entry');
  }
  {
    const { w, phone } = await pair(9);
    const theirs = levels('high', 'high', now(phone));
    setCloud(w, 'levels', theirs, now(phone));
    const mine = lvNow(phone, 'entry', 'entry', 'entry', null); delete mine.setAt;
    storeSet(phone, 'levels', mine);
    await phone.pg.runTimers();
    const c = cloudOf(w, 'levels') || {};
    r.push(c.setAt === theirs.setAt && c.listening === 'high' && c.history.length === 2 && canon(localOf(phone, 'levels')) === canon(c));
  }
  return { ok: r.every(Boolean), detail: J(r) };
};

T['B5 格式壞掉:本機那份壞了、雲端好的:灌資料時用雲端那份,不上傳壞的;雲端壞了、本機好的:上傳本機那份把雲端修好'] = async () => {
  const r = [];
  {
    const { w, phone } = await pair(10);
    const good = levels('advanced', 'advanced', now(phone));
    setCloud(w, 'levels', good, now(phone) + 5000);
    phone.local.setItem(PREFIX + 'levels', '"oops"');
    phone.local.setItem(H.LEDGER, J({ levels: now(phone) + 9000 }));
    await newSession(phone);
    r.push(canon(cloudOf(w, 'levels')) === canon(good) && canon(localOf(phone, 'levels')) === canon(good) && !('levels' in ledgerOf(phone)));
  }
  {
    const { w, phone } = await pair(12);
    setCloud(w, 'levels', ['broken'], now(phone));
    const mine = lvNow(phone, 'entry', 'threshold', 'entry', null);
    storeSet(phone, 'levels', mine);
    await phone.pg.runTimers();
    r.push(canon(cloudOf(w, 'levels')) === canon(mine) && !('levels' in ledgerOf(phone)));
  }
  return { ok: r.every(Boolean), detail: J(r) };
};

T['B6 雲端是認得不了的新版格式(v: 2):不上傳、不蓋掉雲端,帳本留著'] = async () => {
  const { w, phone } = await pair(13);
  const future = Object.assign(levels('high', 'high', now(phone)), { v: 2, extra: [1, 2] });
  setCloud(w, 'levels', future, now(phone));
  storeSet(phone, 'levels', lvNow(phone, 'entry', 'entry', 'entry', null));
  await phone.pg.runTimers();
  const ok = canon(cloudOf(w, 'levels')) === canon(future) && 'levels' in ledgerOf(phone);
  return { ok, detail: J({ cloud: cloudOf(w, 'levels'), ledger: ledgerOf(phone) }) };
};

T['B7 三個鍵在 CLOUD.mergedKeys 裡;不加登出對帳(syncKey 回 ok:false),登出、開頁的請求不多'] = async () => {
  const { phone } = await pair(14);
  const mk = Array.from(phone.pg.ctx.CLOUD.mergedKeys || []);
  const sk = await Promise.all(NEW_KEYS.map((k) => phone.pg.ctx.CLOUD.syncKey(k)));
  const ok = NEW_KEYS.every((k) => mk.indexOf(k) >= 0) && sk.every((x) => x.ok === false);
  return { ok, detail: J({ mk, sk }) };
};

/* ---------- E:裝置時鐘不準(時間欄位沒有上限時,時鐘快的那台一直贏) ---------- */
const ocCtx = {};
vm.createContext(ocCtx);
vm.runInContext(read('js/onboard-core.js'), ocCtx);
const OC = ocCtx.ONBOARD_CORE;
const MINUTE = 60e3;
const SRC_E = { listening: 'entry', reading: 'entry' };

T['E1 時鐘快 5 分鐘:手機(快 5 分鐘)設定級別、onboard,電腦拿到後真實時間晚 1 分鐘改:雲端與電腦本機都留電腦後改的那份'] = async () => {
  const { w, phone, pc } = await pair(16);
  phone.skew = 5 * MINUTE;
  storeSet(phone, 'levels', OC.newLevels(null, 'high', 'high', { listening: 'score', reading: 'score' }, 'score', iso(now(phone))));
  storeSet(phone, 'onboard', OC.patchOnboard(null, { step: 'result', status: 'done' }, iso(now(phone))));
  await phone.pg.runTimers();
  await newSession(pc);
  const got = (localOf(pc, 'levels') || {}).listening === 'high';
  w.clock.t += MINUTE;
  const mineL = OC.newLevels(localOf(pc, 'levels'), 'entry', 'entry', SRC_E, 'manual', iso(now(pc)));
  const mineO = OC.patchOnboard(localOf(pc, 'onboard'), { step: 'test', status: 'in_progress' }, iso(now(pc)));
  storeSet(pc, 'levels', mineL);
  storeSet(pc, 'onboard', mineO);
  await pc.pg.runTimers();
  const c = cloudOf(w, 'levels') || {}, o = cloudOf(w, 'onboard') || {};
  const ok = got && c.listening === 'entry' && (localOf(pc, 'levels') || {}).listening === 'entry'
    && o.step === 'test' && (localOf(pc, 'onboard') || {}).step === 'test' && !Object.keys(ledgerOf(pc)).length;
  return { ok, detail: J({ got, cloud: [c.listening, c.setAt], local: (localOf(pc, 'levels') || {}).listening, onboard: [o.step, (localOf(pc, 'onboard') || {}).step] }) };
};

T['E2 未來時間:雲端 setAt、updatedAt、enteredAt 在一年後,本機現在改:合併留本機那份(超過現在一天的時間當成沒有時間)'] = async () => {
  const r = [];
  const L = need('levels'), O = need('onboard'), S = need('selfScore');
  const far = T0 + 365 * 864e5;
  const cloudL = levels('high', 'high', far), cloudO = onboard('done', 'result', far), cloudS = selfScore(400, 400, far);
  const mineL = OC.newLevels(cloudL, 'entry', 'entry', SRC_E, 'manual', iso(T0));
  r.push(L(mineL, cloudL, T0).v.listening === 'entry', L(cloudL, mineL, T0).v.listening === 'entry');
  const mineO = OC.patchOnboard(cloudO, { step: 'test', status: 'in_progress' }, iso(T0));
  r.push(O(mineO, cloudO, T0).v.step === 'test', O(cloudO, mineO, T0).v.step === 'test');
  const mineS = selfScore(300, 250, T0);
  r.push(S(mineS, cloudS, T0).v.listening === 300);
  /* 一天以內的不打折扣:雲端那份 1 小時後,還是它贏(本機沒讀到它就寫的,沒辦法分) */
  r.push(L(levels('entry', 'entry', T0), levels('high', 'high', T0 + HOUR), T0).v.listening === 'high');
  {
    const { w, pc } = await pair(17);
    setCloud(w, 'levels', levels('high', 'high', now(pc) + 365 * 864e5), now(pc));
    await newSession(pc);
    storeSet(pc, 'levels', OC.newLevels(localOf(pc, 'levels'), 'entry', 'entry', SRC_E, 'manual', iso(now(pc))));
    await pc.pg.runTimers();
    r.push((cloudOf(w, 'levels') || {}).listening === 'entry' && (localOf(pc, 'levels') || {}).listening === 'entry');
  }
  return { ok: r.every(Boolean), detail: J(r) };
};

/* ---------- D:既有鍵的行為沒變(改之前的 cloud.js 對照) ---------- */
const CLOUD_PATH = path.join(REPO, 'js', 'cloud.js');
function harnessWith(cloudSrc) {
  const hp = require.resolve('./sync_harness.js');
  delete require.cache[hp];
  const orig = fs.readFileSync;
  fs.readFileSync = function (p) { if (path.resolve(String(p)) === CLOUD_PATH) return cloudSrc; return orig.apply(fs, arguments); };
  try { return require(hp); } finally { fs.readFileSync = orig; delete require.cache[hp]; }
}
const BEFORE = read('tools/fixtures/cloud_before_onboard_merge.js');
const AFTER = read('js/cloud.js');

/* 一串固定種子的動作:兩台、既有的鍵、離線、恢復連線、重開、登出。withNew:同時也寫三個新鍵 */
async function script(h, seed, withNew) {
  const w = h.makeWorld(seed);
  const a = h.makeDevice(w, '甲'), b = h.makeDevice(w, '乙');
  await h.signIn(a); await h.signIn(b);
  const devs = [a, b];
  const R = rng(seed * 7 + 1);
  const bankIds = [];
  for (let step = 0; step < 40; step++) {
    const d = devs[Math.floor(R() * 2)];
    const x = R();
    if (x < 0.12) h.storeSet(d, 'hist', { n: step, at: h.now(d) });
    else if (x < 0.2) h.storeSet(d, 'diag', { done: R() < 0.5, step });
    else if (x < 0.3) h.mockSubmit(d, Math.floor(R() * 10));
    else if (x < 0.38) h.mockWrongSubmit(d, { ['p5-' + Math.floor(R() * 5)]: Math.floor(R() * 4) });
    else if (x < 0.46) { const id = h.newBank(d, '庫' + step); bankIds.push(id); }
    else if (x < 0.54 && bankIds.length) h.addWords(d, bankIds[Math.floor(R() * bankIds.length)], [{ en: 'w' + step, zh: '字' + step }]);
    else if (x < 0.58 && bankIds.length) h.deleteBank(d, bankIds[Math.floor(R() * bankIds.length)]);
    else if (x < 0.66) d.offline = !d.offline;
    else if (x < 0.74) await d.pg.runTimers();
    else if (x < 0.8) { if (!d.offline) await d.pg.fire('win:online'); }
    else if (x < 0.85) { if (!d.offline) await h.newSession(d); }
    else if (x < 0.88) { if (!d.offline) { d.confirmAnswer = true; await h.logout(d); await h.signIn(d); } }
    else if (withNew && x < 0.94) {
      const k = NEW_KEYS[Math.floor(R() * 3)];
      const at = iso(h.now(d) + 1000);
      h.storeSet(d, k, k === 'levels' ? { listening: 'entry', reading: 'high', source: {}, setAt: at, history: [{ at, listening: 'entry', reading: 'high', reason: 'manual' }] }
        : k === 'onboard' ? { v: 1, status: 'done', step: 'result', updatedAt: at } : { listening: 300, reading: 200, enteredAt: at });
    } else await d.pg.runTimers();
  }
  devs.forEach((d) => { d.offline = false; });
  for (const d of devs) { await d.pg.runTimers(); await d.pg.fire('win:online'); }
  return snapshot(w, devs);
}
const isNew = (k) => NEW_KEYS.indexOf(k) >= 0;
function snapshot(w, devs) {
  const db = w.db.filter((r) => !isNew(r.k)).map((r) => [r.k, canon(r.v), r.updated_at]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const devOut = devs.map((d) => {
    const loc = {};
    for (let i = 0; i < d.local.length; i++) {
      const k = d.local.key(i);
      if (k.indexOf(PREFIX) === 0 && isNew(k.slice(PREFIX.length))) continue;
      let v = d.local.getItem(k);
      if (k === H.LEDGER) { const o = JSON.parse(v); NEW_KEYS.forEach((n) => delete o[n]); v = J(o); }
      loc[k] = v;
    }
    const ops = d.ops.map((o) => ({ op: o.op, keys: (o.keys || []).filter((k) => !isNew(k)), rows: (o.rows || []).filter((r) => !isNew(r.k)) }))
      .filter((o) => o.op !== 'read' && o.op !== 'write' ? true : o.keys.length > 0);
    return { name: d.name, loc: Object.keys(loc).sort().map((k) => [k, loc[k]]), ops, reloads: d.reloads, confirms: d.confirms.length };
  });
  return J({ db, devOut });
}

T['D1 既有鍵行為沒變:同一串動作(只動既有的鍵),改之前和現在的 cloud.js 請求、雲端、兩台本機逐項相同(8 個種子)'] = async () => {
  const diff = [];
  for (let s = 1; s <= 8; s++) {
    const a = await script(harnessWith(BEFORE), s, false);
    const b = await script(harnessWith(AFTER), s, false);
    if (a !== b) diff.push(s);
  }
  return { ok: !diff.length, detail: diff.length ? '不同的種子 ' + J(diff) : '8 個種子相同' };
};

T['D2 既有鍵行為沒變:動作裡夾著三個新鍵的寫入,扣掉新鍵的請求與資料後,改之前和現在逐項相同(8 個種子)'] = async () => {
  const diff = [];
  for (let s = 21; s <= 28; s++) {
    const a = await script(harnessWith(BEFORE), s, true);
    const b = await script(harnessWith(AFTER), s, true);
    if (a !== b) diff.push(s);
  }
  return { ok: !diff.length, detail: diff.length ? '不同的種子 ' + J(diff) : '8 個種子相同' };
};

T['D0 對照測試抓得到差別:同一串動作用沒有合併表的舊版 cloud.js(tools/fixtures/cloud_sync_base.js)跑,結果跟改之前的不同'] = async () => {
  const old = read('tools/fixtures/cloud_sync_base.js');
  let differ = 0;
  for (let s = 1; s <= 4; s++) if (await script(harnessWith(BEFORE), s, false) !== await script(harnessWith(old), s, false)) differ++;
  return { ok: differ === 4, detail: '4 個種子有 ' + differ + ' 個不同' };
};

T['D3 js/cloud.js 的 MERGED 原有五個鍵的設定一字不差(pet、sync_del、vgame_banks、mock_history、mock_wrong)'] = () => {
  const lines = (src) => (/const MERGED = \{([\s\S]*?)\n  \};/.exec(src.replace(/\r\n/g, '\n')) || [, ''])[1].split('\n').filter((l) => /^\s{4}(pet|sync_del|vgame_banks|mock_history|mock_wrong):/.test(l));
  const a = lines(BEFORE), b = lines(AFTER);
  return { ok: a.length === 5 && J(a) === J(b), detail: J(b) };
};

/* ---------- F:設定流程與新檢測(placement_v1)跨裝置 ---------- */
const runAt = (t, end) => ({ at: iso(t), end: end ? iso(end) : null, ip: 'ip1', cv: 'c1', sec: 'LR',
  tm: { L: [iso(t), iso(t + 10 * MINUTE)], R: [iso(t + 10 * MINUTE), end ? iso(end) : null] }, items: [['L', 'l1-01', 0, 1, 20]], res: {} });
T['F1 手機在設定流程裡做完新檢測、電腦之前做過一半:電腦灌資料後首頁是「看起始程度」、S8 走預估;兩次檢測都留著'] = async () => {
  const { w, phone, pc } = await pair(21);
  const t0 = now(pc);
  storeSet(pc, 'placement_v1', { v: 1, runs: [runAt(t0 - 2 * HOUR, null)] });
  await pc.pg.runTimers();
  const t1 = now(phone);
  const ob = { v: 1, status: 'in_progress', step: 'test', path: 'self', targetScore: 600, examMonth: null, levelSource: null, testFrom: iso(t1),
    previous: null, startedAt: iso(t1), doneAt: null, updatedAt: iso(t1) };
  storeSet(phone, 'onboard', ob);
  storeSet(phone, 'placement_v1', { v: 1, runs: [runAt(t1 + MINUTE, t1 + 25 * MINUTE)] });
  await phone.pg.runTimers();
  await newSession(pc);
  const pl = localOf(pc, 'placement_v1') || {}, cpl = cloudOf(w, 'placement_v1') || {};
  const ctx = { cloudEnabled: true, signedIn: true, onboard: localOf(pc, 'onboard'), nowMs: t1 + HOUR, createdAtMs: t1 - 30 * 24 * HOUR, placement: pl };
  const st = OC.homeState(ctx), route = OC.resultRoute(ctx.onboard, null, null, pl);
  const ok = st === 'B_result' && route === 'est' && (pl.runs || []).length === 2 && (cpl.runs || []).length === 2;
  return { ok, detail: J({ st, route, runs: (pl.runs || []).map((r) => [r.at, r.end]), cloud: (cpl.runs || []).length }) };
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let r;
    try { r = await T[name](); } catch (e) { r = { ok: false, detail: '丟錯:' + (e && e.message) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + String(r.detail).slice(0, 400));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
