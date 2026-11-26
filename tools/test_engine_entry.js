/* 練習引擎給課程頁的入口:DRILL.startQuiz(js/practice.js)、LISTEN.startQuiz 的 onDone 與播放次數(js/listening.js)、
   GRAMMAR.unit 與完成時間(js/grammar.js)、EAR.round(js/ear.js),以及共用的 js/lesson-entry.js。
   1. 沒給新參數時:四個檔的頁面流程(畫面、專心模式與結算卡的每一次呼叫、localStorage、頁面標題、換頁)跟改之前(main 分岔點)逐字一樣;
      文法的完成紀錄只多了 at。
   2. 新入口:照給的題目出、紀錄照原頁面的方式存、做完呼叫一次 onDone、不畫成績卡也不給點心、參數不對丟 TypeError。
   node + vm(tools/engine_kit.js 的假環境),不開瀏覽器、不連網。用法:node tools/test_engine_entry.js */
'use strict';
const { J, NOW, baseSrc, ser, engineEnv } = require('./engine_kit');

const BANK_DATA = ['data/part5.js', 'data/part6.js', 'data/part7.js', 'data/listening.js'];
const T = {};
const clone = (x) => JSON.parse(J(x));
const typeErr = (f) => { try { f(); return 'no error'; } catch (e) { return e && e.name; } };
const primary = (env) => env.foot().find((b) => b.classList.contains('primary')) || null;
const nodes = (el, sel) => el.querySelectorAll(sel);
function snap(env, box) {
  return { dom: ser(box || env.root), log: env.log.join('\n'), stored: env.stored(), title: env.dom.title, href: env.ctx.location.href };
}
/* 兩份快照逐項比,回第一個不一樣的地方 */
function diff(a, b) {
  for (const k of Object.keys(a)) {
    const x = typeof a[k] === 'string' ? a[k] : J(a[k]), y = typeof b[k] === 'string' ? b[k] : J(b[k]);
    if (x !== y) { let i = 0; while (x[i] === y[i]) i++; return k + ' @' + i + ': ' + x.slice(Math.max(0, i - 60), i + 80) + ' ≠ ' + y.slice(Math.max(0, i - 60), i + 80); }
  }
  return '';
}
/* 作答:畫面上每一組選項按第 (n + 輪次) 顆;skip(n) 為真的那組不答 */
function answerVisible(box, round, skip) {
  nodes(box, '.opts, .letter-row, .pair-row').forEach((o, n) => { if (!(skip && skip(n, round))) o.children[(n + round) % o.children.length].click(); });
}
/* 一路作答、按主按鈕,直到沒有主按鈕或按了 stopAt */
function drive(env, box, stopAt, skip) {
  for (let round = 0; round < 80; round++) {
    answerVisible(box, round, skip);
    const b = primary(env);
    if (!b || b.disabled) return round;
    const label = b.textContent;
    b.click();
    if (stopAt.indexOf(label) > -1) return round;
  }
  return -1;
}
/* 同一個流程跑改之前與現在的檔各一次,快照要一樣;除了首頁,流程要真的走到結算卡、存了紀錄(免得比的是兩個空畫面) */
function compare(file, data, cases) {
  const old = baseSrc(file);
  const bad = [];
  cases.forEach((c) => {
    const run = (src) => { const env = engineEnv(Object.assign({ data, engines: [{ file, src }], seed: 11 }, c.env)); c.act(env); return c.pick ? c.pick(snap(env), env) : snap(env); };
    const now = run(undefined);
    const d = diff(run(old), now);
    if (d) bad.push(c.name + ':' + d);
    else if (c.name !== '首頁' && !(/^result /m.test(now.log) && Object.keys(now.stored).length)) bad.push(c.name + ':沒有走到結算卡');
    else if (!now.dom.length) bad.push(c.name + ':畫面是空的');
  });
  return { ok: !bad.length, detail: bad.join(' | ') || cases.length + ' 種流程' };
}

/* ================= js/lesson-entry.js ================= */
const E0 = engineEnv({ data: BANK_DATA });
const LE = E0.ctx.LESSON_ENTRY;
T['E1 LESSON_ENTRY.check:元素、onDone 必填、onExit 要是函式、feedback 只能 instant 或 submit;錯誤訊息帶入口名稱'] = () => {
  const el = E0.host, f = () => {};
  const r = [typeErr(() => LE.check('X', null, { onDone: f })), typeErr(() => LE.check('X', el, {})), typeErr(() => LE.check('X', el, { onDone: f, onExit: 1 })),
    typeErr(() => LE.check('X', el, { onDone: f, feedback: 'now' }, true))];
  let msg = '';
  try { LE.check('DRILL.startQuiz', el, {}); } catch (e) { msg = e.message; }
  const ok = LE.check('X', el, { onDone: f, feedback: 'now' }, false).onDone === f && LE.check('X', el, { onDone: f, feedback: 'instant' }, true).feedback === 'instant';
  return { ok: r.every((x) => x === 'TypeError') && ok && /^DRILL\.startQuiz：/.test(msg), detail: J(r) + msg };
};
T['E2 LESSON_ENTRY.units 與 bankResult:p 轉字串;Part 不對、空的、題組沒有小題都丟錯;結果一小題一筆(P6 空格號、P7 第幾題、單題 null),沒作答 c 是 -1'] = () => {
  const T6 = E0.ctx.TOEIC.part6[0], T7 = E0.ctx.TOEIC.part7[0], T5 = E0.ctx.TOEIC.part5[0];
  const list = LE.units('X', [{ p: 5, item: T5 }, { p: '6', item: T6 }, { p: 7, item: T7 }], ['5', '6', '7'], ['5']);
  const bad = [[], [{ p: '4', item: T5 }], [{ p: '6', item: { id: 'x', questions: [] } }], [{ p: '5' }], 'x'].map((u) => typeErr(() => LE.units('X', u, ['5', '6', '7'], ['5'])));
  const res = LE.bankResult('p', list, ['5'], (i, key, qi) => (i === 0 ? T5.answer : i === 1 && qi === 0 ? T6.questions[0].answer : undefined));
  const it = res.items;
  const ok = J(list.map((u) => u.p)) === J(['5', '6', '7']) && bad.every((x) => x === 'TypeError') && it.length === 1 + T6.questions.length + T7.questions.length
    && it[0].sub === null && it[0].key === T5.id && it[0].ok && it[1].key === T6.id + ':1' && it[1].sub === 1 && it[1].ok && it[2].c === -1 && !it[2].ok
    && it[1 + T6.questions.length].key === T7.id + ':0' && it[1 + T6.questions.length].sub === 1 && res.score === 2 && res.total === it.length;
  return { ok, detail: J(bad) + ' ' + J(it.slice(0, 3)) };
};

/* ================= 題庫刷題 js/practice.js ================= */
const PRACTICE = { file: 'js/practice.js' };
T['D1 刷題頁沒給新參數:首頁、深連結 Part 5/6/7 作答交卷(含沒答完按確定)、再做一次、錯題本複習,畫面與紀錄跟改之前一樣'] = () => {
  const wrong5 = Object.fromEntries(E0.ctx.TOEIC.part5.slice(0, 4).map((q) => [q.id, { c: 0, ok: false, t: 1 }]));
  const page = (search, ls) => ({ rootId: 'practice-root', search, ls });
  return compare('js/practice.js', BANK_DATA, [
    { name: '首頁', env: page(''), act: () => {} },
    { name: '首頁開始', env: page(''), act: (env) => { env.root.querySelector('.practice-start').click(); drive(env, env.root, ['交卷']); } },
    { name: 'P5 深連結', env: page('?part=5'), act: (env) => drive(env, env.root, ['交卷']) },
    { name: 'P6 深連結', env: page('?part=6'), act: (env) => drive(env, env.root, ['交卷']) },
    { name: 'P7 沒答完', env: page('?part=7'), act: (env) => drive(env, env.root, ['交卷'], (n) => n === 1) },
    { name: '再做一次', env: page('?part=5&cat=介系詞'), act: (env) => { drive(env, env.root, ['交卷']); env.root.querySelector('.result-go').click(); drive(env, env.root, ['交卷']); } },
    { name: 'P5 錯題本', env: page('?mode=review&part=5', { tr_drill_p5: J(wrong5) }), act: (env) => drive(env, env.root, ['看成績']) },
  ]);
};
function lessonEnv(extra) {
  const pet = [];
  const env = engineEnv(Object.assign({ data: BANK_DATA, engines: [PRACTICE], before: (ctx) => { ctx.PET_HOOK = { done: (...a) => pet.push(a) }; ctx.WRONGBOOK = { syncCloud: () => pet.push('sync') }; } }, extra));
  env.pet = pet;
  return env;
}
T['D2 沒有 #practice-root 的頁面(課程頁):不畫刷題頁、不改標題、不跟雲端對錯題;只開 window.DRILL.startQuiz(凍結)'] = () => {
  const env = lessonEnv();
  const ok = env.dom.title === '' && !env.log.length && !env.pet.length && typeof env.ctx.DRILL.startQuiz === 'function' && Object.isFrozen(env.ctx.DRILL);
  return { ok, detail: J({ title: env.dom.title, log: env.log, pet: env.pet }) };
};
T['D3 DRILL.startQuiz 交卷式:照給的順序出題;交卷後 drill_p* 與學習記錄照刷題頁的格式存;onDone 一次,結果逐小題;不畫成績卡、不給點心、不換頁'] = () => {
  const env = lessonEnv();
  const t = env.ctx.TOEIC;
  const units = [{ p: '5', item: clone(t.part5[7]) }, { p: 6, item: clone(t.part6[2]) }, { p: '5', item: clone(t.part5[3]) }, { p: '7', item: clone(t.part7[1]) }];
  const done = [];
  env.ctx.DRILL.startQuiz(env.host, units, { onDone: (r) => done.push(r) });
  const first = env.host.querySelector('.q-text').textContent;
  drive(env, env.host, ['交卷'], (n, round) => round === 3 && n === 0);   // 第 4 個單元(P7)第一小題不答
  const st = env.stored();
  const r = done[0] || { items: [] };
  const keys = r.items.map((x) => x.key);
  const want = [t.part5[7].id].concat(t.part6[2].questions.map((q) => t.part6[2].id + ':' + q.num), [t.part5[3].id], t.part7[1].questions.map((q, i) => t.part7[1].id + ':' + i));
  const answered = want.filter((k, i) => i !== want.indexOf(t.part7[1].id + ':0'));
  const recOk = answered.every((k) => { const p = k.slice(1, 2), rec = st['tr_drill_p' + p][k]; return rec && typeof rec.c === 'number' && rec.t === NOW && Object.keys(rec).join() === 'c,ok,t'; });
  const hist = st.tr_hist || [];
  const ok = done.length === 1 && first.indexOf(t.part5[7].question) > -1 && J(keys) === J(want) && recOk && !(t.part7[1].id + ':0' in st.tr_drill_p7)
    && r.items.find((x) => x.key === t.part7[1].id + ':0').c === -1 && r.score === r.items.filter((x) => x.ok).length && r.total === want.length
    && hist.length === answered.length && hist.every((x) => /^p[567]$/.test(x.m)) && r.items[1].sub === 1 && r.items[0].sub === null
    && !env.log.some((l) => /^result |^detail /.test(l)) && env.log.indexOf('leave') > -1 && !env.pet.length && env.ctx.location.href === 'page' && env.dom.title === '';
  return { ok, detail: J({ done: done.length, keys: keys.length, recOk, hist: hist.length, pet: env.pet.length }) };
};
T['D4 DRILL.startQuiz 即時回饋:選了就對答案、存紀錄、看解析;單題回饋條、題組全部答了才能下一題;最後是「完成」;離開不用確認'] = () => {
  const env = lessonEnv();
  const t = env.ctx.TOEIC;
  const q5 = clone(t.part5[0]), s6 = clone(t.part6[0]);
  const done = [];
  env.ctx.DRILL.startQuiz(env.host, [{ p: '5', item: q5 }, { p: '6', item: s6 }], { feedback: 'instant', onDone: (r) => done.push(r) });
  const bad = [];
  if (!/"confirmExit":false/.test(env.log[0])) bad.push('confirmExit');
  if (!primary(env) || !primary(env).disabled) bad.push('沒答前不能下一題');
  const wrongPick = (q5.answer + 1) % 4;
  env.host.querySelector('.opts').children[wrongPick].click();
  if (!env.stored().tr_drill_p5 || env.stored().tr_drill_p5[q5.id].c !== wrongPick) bad.push('P5 沒馬上存');
  if (!env.host.querySelector('.opt.correct') || !env.host.querySelector('.explain')) bad.push('P5 沒看到解析');
  if (!/^feedback \{"ok":false,"answer":"[A-D]\. /.test(env.log[env.log.length - 1])) bad.push('P5 回饋條 ' + env.log[env.log.length - 1]);
  primary(env).click();
  env.host.querySelectorAll('.opts')[0].children[s6.questions[0].answer].click();
  if (Object.keys(env.stored().tr_drill_p6 || {}).join() !== s6.id + ':' + s6.questions[0].num) bad.push('P6 第一小題沒存');
  if (!primary(env).disabled || primary(env).textContent !== '完成') bad.push('題組還沒答完就能按');
  for (let i = 1; i < s6.questions.length; i++) env.host.querySelectorAll('.opts')[i].children[0].click();
  if (primary(env).disabled) bad.push('題組答完不能按');
  primary(env).click();
  const r = done[0];
  if (done.length !== 1 || r.total !== 1 + s6.questions.length || r.items[0].c !== wrongPick || r.items[0].ok || !r.items[1].ok) bad.push('結果 ' + J(r));
  if (env.log.some((l) => /^result /.test(l)) || env.pet.length || env.log.filter((l) => l === 'leave').length !== 1) bad.push('畫了成績卡或給了點心');
  return { ok: !bad.length, detail: bad.join(';') };
};
T['D5 DRILL.startQuiz 的參數錯誤丟 TypeError;onExit 交給專心模式(沒給就是 undefined,共用元件回上一頁)'] = () => {
  const env = lessonEnv();
  const D = env.ctx.DRILL, t = env.ctx.TOEIC, f = () => {};
  const u = [{ p: '5', item: t.part5[0] }];
  const r = [typeErr(() => D.startQuiz(null, u, { onDone: f })), typeErr(() => D.startQuiz(env.host, [], { onDone: f })), typeErr(() => D.startQuiz(env.host, [{ p: '1', item: t.part5[0] }], { onDone: f })),
    typeErr(() => D.startQuiz(env.host, [{ p: '6', item: t.part5[0] }], { onDone: f })), typeErr(() => D.startQuiz(env.host, u, {})), typeErr(() => D.startQuiz(env.host, u, { onDone: f, feedback: 'x' }))];
  const exit = () => {};
  D.startQuiz(env.host, u, { onDone: f, onExit: exit });
  const ok = r.every((x) => x === 'TypeError') && env.ctx.UI.focusOpt.onExit === exit && env.ctx.UI.focusOpt.body === '還沒交卷的作答不會計分';
  D.startQuiz(env.host, u, { onDone: f });
  return { ok: ok && env.ctx.UI.focusOpt.onExit === undefined, detail: J(r) };
};

/* ================= 聽力 js/listening.js ================= */
const LISTEN_PAGE = { rootId: 'practice-root' };
T['L1 聽力練習沒給新參數:交卷式(四個 Part、含沒答完)、錯題複習即時對答,畫面與紀錄跟改之前一樣'] = () => {
  const wrong = { tr_listen_p2: J({ 'l2-01': { c: 0, ok: false, t: 1 }, 'l2-02': { c: 1, ok: false, t: 1 }, 'l2-03': { c: 1, ok: false, t: 1 } }) };
  return compare('js/listening.js', BANK_DATA, [
    { name: '交卷式', env: LISTEN_PAGE, act: (env) => { env.ctx.LISTEN.startQuiz(env.root, [{ p: '1', n: 2 }, { p: '2', n: 3 }, { p: '3', n: 1 }, { p: '4', n: 1 }]); drive(env, env.root, ['交卷'], (n, round) => round === 2); } },
    { name: '播放兩次', env: LISTEN_PAGE, act: (env) => { env.ctx.LISTEN.startQuiz(env.root, [{ p: '2', n: 1 }]); const b = env.root.querySelector('.player-btn'); b.click(); b.click(); b.click(); drive(env, env.root, ['交卷']); } },
    { name: '錯題複習', env: Object.assign({ ls: wrong }, LISTEN_PAGE), act: (env) => { env.ctx.LISTEN.startReview(env.root, '2'); for (let i = 0; i < 5; i++) { answerVisible(env.root, i); const b = primary(env); if (b) b.click(); } } },
  ]);
};
function listenEnv() {
  const pet = [];
  const env = engineEnv({ data: BANK_DATA, engines: [{ file: 'js/listening.js' }], before: (ctx) => { ctx.PET_HOOK = { done: (...a) => pet.push(a) }; } });
  env.pet = pet;
  return env;
}
T['L2 LISTEN.startQuiz 帶 onDone(交卷式):照給的題出;listen_p* 與學習記錄照聽力練習存;onDone 一次;不畫成績卡、不給點心、不掛 pagehide'] = () => {
  const env = listenEnv();
  const L = env.ctx.TOEIC.listening;
  const units = [{ p: 2, item: clone(L.p2[5]) }, { p: '3', item: clone(L.p3[1]) }, { p: '1', item: clone(L.p1[2]) }];
  const done = [];
  env.ctx.LISTEN.startQuiz(env.host, null, { units, onDone: (r) => done.push(r) });
  drive(env, env.host, ['交卷']);
  const st = env.stored(), r = done[0] || { items: [] };
  const want = [L.p2[5].id].concat(L.p3[1].questions.map((q, i) => L.p3[1].id + ':' + i), [L.p1[2].id]);
  const ok = done.length === 1 && J(r.items.map((x) => x.key)) === J(want) && r.items.every((x) => x.m === 'l' + x.key.slice(1, 2))
    && want.every((k) => st['tr_listen_p' + k.slice(1, 2)][k].t === NOW) && (st.tr_hist || []).length === want.length
    && !env.log.some((l) => /^result |^detail |^window\.on/.test(l)) && !env.pet.length && /"body":"還沒交卷的作答不會計分"/.test(env.log[0]);
  return { ok, detail: J({ done: done.length, items: r.items.length }) };
};
T['L3 即時回饋跟錯題本拆開:feedback instant(不是錯題本)每題作答就存、看解析,最後是「完成」;錯題本照舊、feedback submit 時錯題本也是交卷式'] = () => {
  const env = listenEnv();
  const L = env.ctx.TOEIC.listening;
  const done = [];
  env.ctx.LISTEN.startQuiz(env.host, null, { units: [{ p: '2', item: clone(L.p2[0]) }], feedback: 'instant', onDone: (r) => done.push(r) });
  env.host.querySelector('.letter-row').children[0].click();
  const saved = !!env.stored().tr_listen_p2[L.p2[0].id];
  const fb = env.log[env.log.length - 1];
  primary(env).click();
  const env2 = listenEnv();
  env2.ctx.LISTEN.startQuiz(env2.host, [{ p: '2', n: 1 }], { wrongOnly: true, feedback: 'submit', units: [{ p: '2', item: L.p2[1] }] });
  const sub = env2.log.some((l) => /^action \{"label":"交卷"/.test(l)) || (primary(env2) && primary(env2).textContent === '交卷');
  const ok = saved && /^feedback .*"next":"完成"/.test(fb) && done.length === 1 && done[0].total === 1 && /"confirmExit":false/.test(env.log[0]) && sub && /"confirmExit":true/.test(env2.log[0]);
  return { ok, detail: J({ saved, fb, sub }) };
};
T['L4 播放次數:plays 1 時「還可播放 1 次」、播一次就鎖;沒給還是 2 次;不是 1 到 3 的整數丟 TypeError'] = () => {
  const L = listenEnv().ctx.TOEIC.listening;
  const env = listenEnv();
  env.ctx.LISTEN.startQuiz(env.host, null, { units: [{ p: '1', item: L.p1[0] }], plays: 1, onDone: () => {} });
  const note = () => env.host.querySelector('.player-note').textContent, btn = () => env.host.querySelector('.player-btn');
  const a = note();
  btn().click();
  const b = note(), locked = btn().disabled;
  btn().click();
  const env2 = listenEnv();
  env2.ctx.LISTEN.startQuiz(env2.host, null, { units: [{ p: '1', item: L.p1[0] }], onDone: () => {} });
  const c = env2.host.querySelector('.player-note').textContent;
  const r = [0, 4, 1.5, '2'].map((n) => typeErr(() => listenEnv().ctx.LISTEN.startQuiz(env.host, null, { units: [{ p: '1', item: L.p1[0] }], plays: n, onDone: () => {} })));
  const ok = a === '還可播放 1 次' && b === '播放次數已用完' && locked && env.audios.length === 1 && c === '還可播放 2 次' && r.every((x) => x === 'TypeError');
  return { ok, detail: J({ a, b, c, plays: env.audios.length, r }) };
};
T['L5 LISTEN.startQuiz 帶 onDone 的參數錯誤:沒給 units、空的、Part 不對、feedback 不對都丟 TypeError'] = () => {
  const env = listenEnv(), L = env.ctx.TOEIC.listening, f = () => {};
  const r = [{ onDone: f }, { onDone: f, units: [] }, { onDone: f, units: [{ p: '5', item: L.p1[0] }] }, { onDone: f, units: [{ p: '1', item: L.p1[0] }], feedback: 'x' }, { onDone: 'x', units: [{ p: '1', item: L.p1[0] }] }]
    .map((o) => typeErr(() => env.ctx.LISTEN.startQuiz(env.host, null, o)));
  return { ok: r.every((x) => x === 'TypeError'), detail: J(r) };
};

/* ================= 文法 js/grammar.js ================= */
T['G1 文法頁沒給新參數:首頁、單元作答完,畫面與紀錄跟改之前一樣(完成紀錄不加 at,只有課程頁才寫)'] = () => {
  const data = ['data/grammar.js'];
  const quiz = (env) => { for (let i = 0; i < 12; i++) { const o = nodes(env.root, '.opts').find((x) => !x.children[0].disabled); if (!o) break; o.children[i % 4].click(); } env.flush(); };
  const res = compare('js/grammar.js', data, [
    { name: '首頁', env: { rootId: 'grammar-root' }, act: (env) => env.flush() },
    { name: '單元', env: { rootId: 'grammar-root', search: '?u=gb-03', ls: { tr_grammar_done: J({ 'ga-01': { ok: 3, t: 8 } }) } }, act: quiz },
  ]);
  const env = engineEnv({ data, engines: [{ file: 'js/grammar.js' }], rootId: 'grammar-root', search: '?u=gb-03' });
  quiz(env);
  const rec = env.stored().tr_grammar_done['gb-03'];
  return { ok: res.ok && rec && Object.keys(rec).join() === 'ok,t', detail: res.detail + ' ' + J(rec) };
};
function grammarEnv(ls) {
  const pet = [];
  const env = engineEnv({ data: ['data/grammar.js'], engines: [{ file: 'js/grammar.js' }], ls, before: (ctx) => { ctx.PET_HOOK = { done: (...a) => pet.push(a) }; } });
  env.pet = pet;
  return env;
}
T['G2 GRAMMAR.unit:畫在給的元素裡(課名 h2、講解、小試身手;沒有章節路徑與 h1、不改標題);答完存 grammar_done 與學習記錄、onDone 一次'] = () => {
  const env = grammarEnv();
  const u = env.ctx.TOEIC.grammar.find((x) => x.id === 'gc-02');
  const done = [];
  env.ctx.GRAMMAR.unit(env.host, 'gc-02', { onDone: (r) => done.push(r) });
  const shape = { h2: env.host.querySelector('h2').textContent, h1: !!env.host.querySelector('h1'), rail: !!env.host.querySelector('.gx-rail'), view: !!env.host.querySelector('.lesson-view') };
  nodes(env.host, '.opts').forEach((o, i) => o.children[i === 0 ? u.quiz[0].answer : (u.quiz[i].answer + 1) % 4].click());
  const st = env.stored(), r = done[0] || { items: [] };
  const ok = shape.h2 === u.title.split('：')[0] && !shape.h1 && !shape.rail && shape.view && env.dom.title === '' && done.length === 1
    && J(st.tr_grammar_done['gc-02']) === J({ ok: 1, t: u.quiz.length, at: NOW }) && (st.tr_hist || []).length === u.quiz.length
    && r.total === u.quiz.length && r.score === 1 && r.items[0].key === 'gc-02:0' && r.items[0].sub === 1 && r.items[1].c === (u.quiz[1].answer + 1) % 4
    && r.items.every((x) => x.m === 'g' && x.id === 'gc-02') && !env.log.some((l) => /^result /.test(l)) && !env.pet.length;
  return { ok, detail: J({ shape, done: done.length, rec: st.tr_grammar_done }) };
};
T['G3 GRAMMAR.done:新紀錄有 at;舊紀錄 {ok,t} 的 at 是 null;更舊的 true、1 照讀成三個 null;沒做過是 null'] = () => {
  const env = grammarEnv({ tr_grammar_done: J({ a: { ok: 3, t: 8 }, b: true, c: 1, d: { ok: 8, t: 8, at: 5 } }) });
  const G = env.ctx.GRAMMAR;
  const got = ['a', 'b', 'c', 'd', 'e'].map((k) => G.done(k));
  const want = [{ ok: 3, t: 8, at: null }, { ok: null, t: null, at: null }, { ok: null, t: null, at: null }, { ok: 8, t: 8, at: 5 }, null];
  return { ok: J(got) === J(want) && Object.isFrozen(G), detail: J(got) };
};
T['G4 GRAMMAR.unit 錯誤:沒有這一課、沒給 onDone、元素不對丟 TypeError;沒有 #grammar-root 的頁面不畫文法頁'] = () => {
  const env = grammarEnv(), G = env.ctx.GRAMMAR;
  const r = [typeErr(() => G.unit(env.host, 'zz-99', { onDone: () => {} })), typeErr(() => G.unit(env.host, 'ga-01', {})), typeErr(() => G.unit({}, 'ga-01', { onDone: () => {} }))];
  return { ok: r.every((x) => x === 'TypeError') && !env.log.length && env.dom.title === '', detail: J(r) };
};

/* ================= 英語耳 js/ear.js ================= */
const EAR_DATA = ['data/ear.js'];
function shadowRun(env) {   // 跟讀:音檔播完(onended)與停頓(計時器)一步一步往下走
  for (let i = 0; i < 12; i++) { env.audios.forEach((a) => { const f = a.onended; if (f && !a.paused) { a.paused = true; f(); } }); env.flush(); }
}
T['R1 聽力訓練頁沒給新參數:首頁、相似音、數字、聽寫(選級別)、跟讀一輪,畫面與紀錄跟改之前一樣'] = () => {
  const page = { rootId: 'ear-root' };
  const round = (env) => { for (let i = 0; i < 12; i++) { answerVisible(env.root, i); const ta = env.root.querySelector('textarea'); if (ta) { ta.value = i % 2 ? 'wrong words' : ''; env.root.querySelector('textarea').fire('keydown', { key: 'Enter' }); } const b = primary(env); if (!b) break; b.click(); } };
  return compare('js/ear.js', EAR_DATA, [
    { name: '首頁', env: page, act: () => {} },
    { name: '相似音', env: Object.assign({ search: '?sec=mp' }, page), act: round },
    { name: '數字', env: Object.assign({ search: '?sec=n&lv=中級' }, page), act: round },
    { name: '聽寫', env: Object.assign({ search: '?sec=d' }, page), act: round },
    { name: '跟讀', env: Object.assign({ search: '?sec=s&lv=初級' }, page), act: (env) => { for (let i = 0; i < 6; i++) { const s = env.root.querySelector('.player-btn'); if (s && !s.disabled && /開始/.test(s.textContent)) s.click(); shadowRun(env); const b = primary(env); if (b && b.parentNode === env.ctx.UI.foot) b.click(); } } },
  ]);
};
function earEnv() {
  const pet = [];
  const env = engineEnv({ data: EAR_DATA, engines: [{ file: 'js/ear.js' }], before: (ctx) => { ctx.PET_HOOK = { done: (...a) => pet.push(a) }; } });
  env.pet = pet;
  return env;
}
T['R2 EAR.round:照給的題出;ear_* 照聽力訓練頁存;最後是「完成」;onDone 一次(相似音 c 是選項、聽寫 c 是打的字、跟讀 c 是 null);不畫成績卡'] = () => {
  const bad = [];
  const env = earEnv(), E = env.ctx.TOEIC.ear;
  const ids = [E.pairs[3].id, E.pairs[0].id];
  const done = [];
  env.ctx.EAR.round(env.host, 'mp', { items: ids, onDone: (r) => done.push(r) });
  if (env.dom.title !== '') bad.push('改了標題');
  env.host.querySelector('.pair-row').children[E.pairs[3].answer].click();
  primary(env).click();
  env.host.querySelector('.pair-row').children[1 - E.pairs[0].answer].click();
  if (primary(env).textContent !== '完成') bad.push('最後一題不是完成');
  primary(env).click();
  const r = done[0] || { items: [] };
  if (done.length !== 1 || J(r.items.map((x) => [x.m, x.key, x.c, x.ok])) !== J([['ear_mp', ids[0], E.pairs[3].answer, true], ['ear_mp', ids[1], 1 - E.pairs[0].answer, false]])) bad.push('結果 ' + J(r));
  if (J(env.stored().tr_ear_mp) !== J({ [ids[0]]: { ok: true }, [ids[1]]: { ok: false } })) bad.push('紀錄 ' + J(env.stored().tr_ear_mp));
  const env2 = earEnv();
  const d2 = [];
  env2.ctx.EAR.round(env2.host, 'd', { items: [E.dictation[0]], onDone: (x) => d2.push(x) });
  env2.host.querySelector('textarea').value = 'hello there';
  env2.host.querySelector('textarea').fire('keydown', { key: 'Enter' });
  primary(env2).click();
  if (!d2[0] || d2[0].items[0].c !== 'hello there' || env2.stored().tr_ear_d[E.dictation[0].id].text !== 'hello there') bad.push('聽寫 ' + J(d2));
  const env3 = earEnv();
  const d3 = [];
  env3.ctx.EAR.round(env3.host, 's', { items: [E.shadow[0].id], onDone: (x) => d3.push(x) });
  env3.host.querySelector('.player-btn').click();
  shadowRun(env3);
  primary(env3).click();
  if (!d3[0] || d3[0].items[0].c !== null || !d3[0].items[0].ok) bad.push('跟讀 ' + J(d3));
  if ([env, env2, env3].some((e) => e.pet.length || e.log.some((l) => /^result /.test(l)))) bad.push('畫了成績卡或給了點心');
  return { ok: !bad.length, detail: bad.join(';') };
};
T['R3 EAR.round:區不對、題目不在這一區、空的、沒給 onDone 丟 TypeError;離開時有 onExit 叫它,沒有回上一頁(不去聽力訓練頁)'] = () => {
  const env = earEnv(), E = env.ctx.TOEIC.ear, R = env.ctx.EAR.round, f = () => {};
  const r = [typeErr(() => R(env.host, 'x', { items: [E.pairs[0].id], onDone: f })), typeErr(() => R(env.host, 'mp', { items: [E.numbers[0].id], onDone: f })),
    typeErr(() => R(env.host, 'mp', { items: [], onDone: f })), typeErr(() => R(env.host, 'mp', { items: [E.pairs[0].id] }))];
  const exits = [];
  R(env.host, 'n', { items: [E.numbers[0].id], onDone: f, onExit: () => exits.push(1) });
  env.ctx.UI.focusOpt.onExit();
  R(env.host, 'n', { items: [E.numbers[0].id], onDone: f });
  env.ctx.UI.focusOpt.onExit();
  const ok = r.every((x) => x === 'TypeError') && exits.length === 1 && env.log.filter((l) => l === 'history.back').length === 1 && env.ctx.location.href === 'page';
  return { ok, detail: J(r) };
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let r;
    try { r = await T[name](); } catch (e) { r = { ok: false, detail: '丟錯:' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ') : e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + String(r.detail).slice(0, 700));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
