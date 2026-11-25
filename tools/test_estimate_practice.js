/* 平常練習記第一次作答(js/practice-fa.js 與 js/practice.js、js/listening.js 的呼叫點):
   1. 刷題、聽力練習交卷:有作答的題寫一筆計分紀錄(刷題 p;聽力只播一次、1 倍速 l,重播或改速 r),key 在 data/item-params.js 查得到;
      沒作答的記成看過;同一題第二次、上線前做過的題、錯題本、課程回合都不寫計分紀錄;交卷後背景重算(計時器跑了才寫 est_v1)。
   2. 估分的檔沒載到、或出錯:不丟錯,練習照常。
   3. 同一組操作在改之前(9754b22)的引擎與現在的引擎各跑一次:畫面、共用元件的呼叫、作答紀錄、學習記錄逐位元組相同(只多 fa_v1、est_v1)。
   node + vm(tools/engine_kit.js 的假環境),不開瀏覽器、不連網。用法:node tools/test_estimate_practice.js */
'use strict';
const { spawnSync } = require('child_process');
const { REPO, J, NOW, ser, engineEnv } = require('./engine_kit');

const BASE = '9754b22';
const DATA = ['data/part5.js', 'data/part6.js', 'data/part7.js', 'data/listening.js', 'data/item-params.js'];
const EST = ['js/estimate-core.js', 'js/estimate-data.js', 'js/estimate-store.js', 'js/practice-fa.js'];
const PFX = 'tr_us1_';
const DAY_MS = 864e5;
const T = {};
const clone = (x) => JSON.parse(J(x));

function baseSrc(file) {
  const r = spawnSync('git', ['-C', REPO, 'show', BASE + ':' + file], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error('git show ' + file + ' 失敗：' + r.stderr);
  return r.stdout.replace(/\r\n/g, '\n');
}
/* o:{ search, ls(不帶前綴的鍵), page(預設 true:有 #practice-root), est(預設 true), old(用改之前的引擎), before } */
function makeEnv(o) {
  const opt = o || {};
  const ls = { tr_current_profile: J('s1') };
  Object.keys(opt.ls || {}).forEach((k) => { ls[PFX + k] = J(opt.ls[k]); });
  const est = opt.est === false ? [] : (opt.estFiles || EST).map((file) => ({ file }));
  const eng = ['js/listening.js', 'js/practice.js'].map((file) => (opt.old ? { file, src: baseSrc(file) } : { file }));
  return engineEnv({ data: DATA, engines: est.concat(eng), rootId: opt.page === false ? null : 'practice-root', search: opt.search || '', ls, seed: 7, before: opt.before });
}
const stored = (env) => { const s = env.stored(), out = {}; Object.keys(s).forEach((k) => { out[k.indexOf(PFX) === 0 ? k.slice(PFX.length) : k] = s[k]; }); return out; };
const faOf = (env) => (stored(env).fa_v1 || { i: {} }).i;
const primary = (env) => env.foot().find((b) => b.classList.contains('primary')) || null;
function answerVisible(box, round, skip) {
  box.querySelectorAll('.opts, .letter-row').forEach((o, n) => { if (!(skip && skip(n, round))) o.children[(n + round) % o.children.length].click(); });
}
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
function dayNum(ms) { const d = new Date(ms); return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / DAY_MS); }
const TODAY = dayNum(NOW);
/* 作答紀錄(drill_p*、listen_p*)裡今天作答的題 → 跟 fa_v1 比:每題一筆 [今天, 對錯, 來源],key 查得到難度 */
function scoredMatch(env, recKeys, src) {
  const st = stored(env), fa = faOf(env), b = env.ctx.ITEM_PARAMS.b, bad = [];
  let n = 0;
  recKeys.forEach((rk) => Object.keys(st[rk] || {}).forEach((key) => {
    const rec = st[rk][key];
    if (rec.t !== NOW) return;
    n++;
    const e = fa[key];
    if (!e || e[0] !== TODAY || e[1] !== (rec.ok ? 1 : 0) || e[2] !== src || typeof b[key] !== 'number') bad.push(key + ' ' + J(e));
  }));
  return { n, bad };
}

/* ================= 1. 刷題 ================= */
T['P1 刷題 Part 5、6、7 第一次作答：每題一筆計分紀錄（p、今天、對錯跟作答紀錄一樣），key 查得到難度；交卷時不重算，計時器跑了才寫 est_v1'] = () => {
  const out = ['5', '6', '7'].map((p) => {
    const env = makeEnv({ search: '?part=' + p });
    drive(env, env.root, ['交卷']);
    const before = 'est_v1' in stored(env);
    env.flush();
    const m = scoredMatch(env, ['drill_p' + p], 'p');
    return { p, n: m.n, bad: m.bad, fa: Object.keys(faOf(env)).length, before, after: 'est_v1' in stored(env) };
  });
  const ok = out.every((x) => x.n > 0 && !x.bad.length && x.fa === x.n && !x.before && x.after);
  return { ok, detail: J(out) };
};
T['P2 交卷時留空的題記成看過（ok 是 null），不是計分紀錄；作答紀錄照舊不記留空的題'] = () => {
  const env = makeEnv({ search: '?part=7' });
  drive(env, env.root, ['交卷'], (n) => n === 1);
  const fa = faOf(env), st = stored(env).drill_p7 || {};
  const blank = Object.keys(fa).filter((k) => fa[k][1] === null);
  const ok = blank.length > 0 && blank.every((k) => !(k in st) && fa[k][2] === 'p' && typeof env.ctx.ITEM_PARAMS.b[k] === 'number')
    && Object.keys(fa).filter((k) => fa[k][1] !== null).every((k) => k in st);
  return { ok, detail: J({ blank, scored: Object.keys(fa).length - blank.length }) };
};
T['P3 同一題第二次：fa_v1 已經有的題（做過或看過）一筆都不改'] = () => {
  const P = makeEnv().ctx.TOEIC.part5;
  const pre = { v: 1, i: Object.fromEntries(P.map((q, n) => [q.id, [100, n % 3 === 0 ? null : n % 2, n % 2 ? 'h' : 'p']])) };
  const env = makeEnv({ search: '?part=5', ls: { fa_v1: pre } });
  drive(env, env.root, ['交卷']);
  env.flush();
  return { ok: J(stored(env).fa_v1) === J(pre) && Object.keys(stored(env).drill_p5 || {}).length > 0, detail: Object.keys(faOf(env)).length + ' 題' };
};
T['P4 上線前做過的題（有作答紀錄與學習記錄、還沒有 fa_v1）：這一次不算第一次，照學習記錄補成較早那一筆(h)；學習記錄被截斷時是看過(o)'] = () => {
  const P = makeEnv().ctx.TOEIC.part5;
  const old = NOW - 10 * DAY_MS;
  const drill = Object.fromEntries(P.map((q) => [q.id, { c: 0, ok: q.answer === 0, t: old }]));
  const hist = P.map((q) => ({ m: 'p5', id: q.id, c: 0, ok: q.answer === 0, t: old }));
  const run = (h) => {
    const env = makeEnv({ search: '?part=5', ls: { drill_p5: drill, hist: h } });
    drive(env, env.root, ['交卷']);
    const now = Object.keys(stored(env).drill_p5).filter((k) => stored(env).drill_p5[k].t === NOW);
    return { now, fa: faOf(env) };
  };
  const a = run(hist);
  const okA = a.now.length > 0 && a.now.every((k) => J(a.fa[k]) === J([dayNum(old), drill[k].ok ? 1 : 0, 'h']));
  const cut = hist.concat([{ m: 'p5', id: 'zz', c: 0, ok: true, t: NOW - 70 * DAY_MS }]);
  const b = run(cut);
  const okB = b.now.length > 0 && b.now.every((k) => J(b.fa[k]) === J([dayNum(old), null, 'o']));
  return { ok: okA && okB, detail: J({ a: a.now.length, b: b.now.length, sample: a.fa[a.now[0]] }) };
};
T['P5 錯題本複習：不寫計分紀錄（作答前先照舊紀錄補，沒有學習記錄的記成看過）'] = () => {
  const P = makeEnv().ctx.TOEIC.part5;
  const wrong = Object.fromEntries(P.slice(0, 5).map((q) => [q.id, { c: (q.answer + 1) % 4, ok: false, t: NOW - 5 * DAY_MS }]));
  const env = makeEnv({ search: '?mode=review&part=5', ls: { drill_p5: wrong } });
  drive(env, env.root, ['看成績']);
  env.flush();
  const fa = faOf(env), keys = Object.keys(wrong);
  const ok = keys.every((k) => fa[k] && fa[k][1] === null) && Object.keys(fa).every((k) => fa[k][1] === null)
    && keys.every((k) => stored(env).drill_p5[k].t === NOW);
  return { ok, detail: J(keys.map((k) => fa[k])) };
};
T['P6 課程回合（DRILL.startQuiz 帶 onDone）：交卷式、即時回饋都只記成看過(c)，含留空的小題；不寫 est_v1'] = () => {
  const out = ['submit', 'instant'].map((fb) => {
    const env = makeEnv({ page: false });
    const t = env.ctx.TOEIC;
    const units = [{ p: '5', item: clone(t.part5[7]) }, { p: '6', item: clone(t.part6[2]) }, { p: '7', item: clone(t.part7[1]) }];
    const keys = [t.part5[7].id].concat(t.part6[2].questions.map((q) => t.part6[2].id + ':' + q.num), t.part7[1].questions.map((q, i) => t.part7[1].id + ':' + i));
    let done = 0;
    env.ctx.DRILL.startQuiz(env.host, units, { onDone: () => done++, feedback: fb });
    drive(env, env.host, ['交卷', '完成'], fb === 'submit' ? (n, round) => round === 2 && n === 0 : null);
    env.flush();
    const fa = faOf(env);
    return { fb, done, all: keys.every((k) => fa[k] && fa[k][1] === null && fa[k][2] === 'c'), n: Object.keys(fa).length, want: keys.length, est: 'est_v1' in stored(env) };
  });
  return { ok: out.every((x) => x.done === 1 && x.all && x.n === x.want && !x.est), detail: J(out) };
};

/* ================= 2. 聽力 ================= */
function listenRun(setup, parts) {
  const env = makeEnv({ page: false });
  env.ctx.LISTEN.startQuiz(env.host, parts || [{ p: '2', n: 1 }]);
  if (setup) setup(env);
  drive(env, env.host, ['交卷']);
  return env;
}
const playBtn = (env) => env.host.querySelector('.player-btn');
const speed = (env, v) => { const s = env.host.querySelector('.speed-sel'); s.value = v; s.fire('change'); };
T['L1 聽力第一次作答：沒播或只播一次、1 倍速是 l；播兩次是 r；先選 0.75 倍速再播是 r；播放中改成 1.25 倍速是 r；播完才改速度不算'] = () => {
  const cases = {
    沒播: [null, 'l'],
    播一次: [(e) => { speed(e, '1'); playBtn(e).click(); }, 'l'],
    播兩次: [(e) => { playBtn(e).click(); playBtn(e).click(); }, 'r'],
    慢速: [(e) => { speed(e, '0.75'); playBtn(e).click(); }, 'r'],
    播放中改速: [(e) => { playBtn(e).click(); speed(e, '1.25'); }, 'r'],
    播完改速: [(e) => { playBtn(e).click(); e.audios[e.audios.length - 1].paused = true; e.audios[e.audios.length - 1].ended = true; speed(e, '1.25'); }, 'l'],
  };
  const out = Object.keys(cases).map((name) => {
    const env = listenRun(cases[name][0]);
    const m = scoredMatch(env, ['listen_p2'], cases[name][1]);
    return { name, n: m.n, bad: m.bad };
  });
  return { ok: out.every((x) => x.n === 1 && !x.bad.length), detail: J(out) };
};
T['L2 聽力四個 Part 交卷：每題一筆計分紀錄、key 查得到難度；題組留空的小題記成看過'] = () => {
  const env = listenRun(null, [{ p: '1', n: 2 }, { p: '2', n: 2 }, { p: '3', n: 1 }, { p: '4', n: 1 }]);
  const m = scoredMatch(env, ['listen_p1', 'listen_p2', 'listen_p3', 'listen_p4'], 'l');
  const fa = faOf(env), b = env.ctx.ITEM_PARAMS.b;
  const partsSeen = [...new Set(Object.keys(fa).map((k) => k.slice(0, 2)))].sort();
  const env2 = makeEnv({ page: false });
  env2.ctx.LISTEN.startQuiz(env2.host, [{ p: '3', n: 1 }]);
  drive(env2, env2.host, ['交卷'], (n) => n === 1);
  const fa2 = faOf(env2), blank = Object.keys(fa2).filter((k) => fa2[k][1] === null);
  const ok = m.n === 10 && !m.bad.length && J(partsSeen) === J(['l1', 'l2', 'l3', 'l4']) && Object.keys(fa).every((k) => typeof b[k] === 'number')
    && blank.length === 1 && !(blank[0] in (stored(env2).listen_p3 || {}));
  return { ok, detail: J({ n: m.n, bad: m.bad, partsSeen, blank }) };
};
T['L3 聽力錯題本與課程回合：不寫計分紀錄（錯題本看過、課程回合 c）'] = () => {
  const wrong = { 'l2-01': { c: 0, ok: false, t: 1 }, 'l2-02': { c: 1, ok: false, t: 1 } };
  const env = makeEnv({ page: false, ls: { listen_p2: wrong } });
  env.ctx.LISTEN.startReview(env.host, '2');
  for (let i = 0; i < 4; i++) { answerVisible(env.host, i); const b = primary(env); if (b) b.click(); }
  const faW = faOf(env);
  const env2 = makeEnv({ page: false });
  const L = env2.ctx.TOEIC.listening;
  const units = [{ p: '2', item: clone(L.p2[5]) }, { p: '3', item: clone(L.p3[1]) }];
  let done = 0;
  env2.ctx.LISTEN.startQuiz(env2.host, null, { units, onDone: () => done++ });
  drive(env2, env2.host, ['交卷']);
  const faL = faOf(env2);
  const ok = ['l2-01', 'l2-02'].every((k) => faW[k] && faW[k][1] === null) && Object.keys(faW).every((k) => faW[k][1] === null)
    && done === 1 && Object.keys(faL).length === 4 && Object.keys(faL).every((k) => faL[k][1] === null && faL[k][2] === 'c');
  return { ok, detail: J({ faW, faL }) };
};

/* ================= 3. 沒載到、出錯 ================= */
T['N1 估分的檔沒載到（全沒有、只有 practice-fa 沒有資料層）、資料層丟錯：不丟錯、走到結算卡、沒有 fa_v1，作答紀錄照寫'] = () => {
  const broken = (ctx) => { ctx.ESTIMATE_STORE = { seen() { throw new Error('x'); }, refresh() { throw new Error('x'); }, recordMany() { throw new Error('x'); } }; };
  const variants = [{ est: false }, { estFiles: ['js/practice-fa.js'] }, { estFiles: ['js/practice-fa.js'], before: broken }];
  const out = variants.map((v, n) => {
    const env = makeEnv(Object.assign({ search: '?part=6' }, v));
    drive(env, env.root, ['交卷']);
    env.flush();
    const l = makeEnv(Object.assign({ page: false }, v));
    l.ctx.LISTEN.startQuiz(l.host, [{ p: '2', n: 2 }]);
    drive(l, l.host, ['交卷']);
    l.flush();
    return { n, result: env.log.some((x) => /^result /.test(x)) && l.log.some((x) => /^result /.test(x)),
      fa: 'fa_v1' in stored(env) || 'fa_v1' in stored(l), rec: !!stored(env).drill_p6 && !!stored(l).listen_p2 };
  });
  return { ok: out.every((x) => x.result && !x.fa && x.rec), detail: J(out) };
};

/* ================= 4. 跟改之前逐位元組比 ================= */
const P5 = () => makeEnv({ est: false }).ctx.TOEIC.part5;
function legacyLs() {
  const q = P5().slice(0, 40), old = NOW - 3 * DAY_MS;
  return { drill_p5: Object.fromEntries(q.map((x, n) => [x.id, { c: n % 4, ok: x.answer === n % 4, t: old }])),
    hist: q.map((x, n) => ({ m: 'p5', id: x.id, c: n % 4, ok: x.answer === n % 4, t: old })) };
}
function lessonUnits(env, kind) {
  const t = env.ctx.TOEIC;
  return kind === 'L' ? [{ p: '1', item: clone(t.listening.p1[0]) }, { p: '4', item: clone(t.listening.p4[0]) }]
    : [{ p: '5', item: clone(t.part5[2]) }, { p: '7', item: clone(t.part7[0]) }];
}
const FLOWS = [
  { name: '首頁開始', act: (e) => { e.root.querySelector('.practice-start').click(); drive(e, e.root, ['交卷']); } },
  { name: 'P5', search: '?part=5', legacy: true, act: (e) => drive(e, e.root, ['交卷']) },
  { name: 'P6', search: '?part=6', act: (e) => drive(e, e.root, ['交卷']) },
  { name: 'P7 留空', search: '?part=7', act: (e) => drive(e, e.root, ['交卷'], (n) => n === 1) },
  { name: '再做一次', search: '?part=5&cat=介系詞', act: (e) => { drive(e, e.root, ['交卷']); e.root.querySelector('.result-go').click(); drive(e, e.root, ['交卷']); } },
  { name: 'P5 錯題本', search: '?mode=review&part=5', legacy: true, act: (e) => drive(e, e.root, ['看成績']) },
  { name: '聽力四個 Part', act: (e) => { e.ctx.LISTEN.startQuiz(e.root, [{ p: '1', n: 2 }, { p: '2', n: 3 }, { p: '3', n: 1 }, { p: '4', n: 1 }]); drive(e, e.root, ['交卷'], (n, r) => r === 2); } },
  { name: '聽力重播與慢速', act: (e) => { e.ctx.LISTEN.startQuiz(e.root, [{ p: '2', n: 2 }]); const s = e.root.querySelector('.speed-sel'); s.value = '0.75'; s.fire('change'); const b = e.root.querySelector('.player-btn'); b.click(); b.click(); drive(e, e.root, ['交卷']); } },
  { name: '聽力錯題本', ls: { listen_p2: { 'l2-01': { c: 0, ok: false, t: 1 }, 'l2-03': { c: 1, ok: false, t: 1 } } }, act: (e) => { e.ctx.LISTEN.startReview(e.root, '2'); for (let i = 0; i < 4; i++) { answerVisible(e.root, i); const b = primary(e); if (b) b.click(); } } },
  { name: '課程回合刷題', page: false, act: (e) => { e.ctx.DRILL.startQuiz(e.host, lessonUnits(e, 'R'), { onDone: () => e.log.push('onDone') }); drive(e, e.host, ['交卷']); } },
  { name: '課程回合即時', page: false, act: (e) => { e.ctx.DRILL.startQuiz(e.host, lessonUnits(e, 'R'), { onDone: () => e.log.push('onDone'), feedback: 'instant' }); drive(e, e.host, ['完成']); } },
  { name: '課程回合聽力', page: false, act: (e) => { e.ctx.LISTEN.startQuiz(e.host, null, { units: lessonUnits(e, 'L'), plays: 1, onDone: () => e.log.push('onDone') }); drive(e, e.host, ['交卷']); } },
];
function flowSnap(flow, old) {
  const ls = Object.assign(flow.legacy ? legacyLs() : {}, flow.ls || {});
  if (flow.name === 'P5 錯題本') Object.keys(ls.drill_p5).slice(0, 6).forEach((k) => { ls.drill_p5[k] = { c: 9, ok: false, t: ls.drill_p5[k].t }; });
  const env = makeEnv({ search: flow.search, ls, page: flow.page, old, est: !old });
  flow.act(env);
  env.flush();
  const st = stored(env), fa = st.fa_v1;
  delete st.fa_v1; delete st.est_v1;
  return { snap: { dom: ser(env.root) + ser(env.host), log: env.log.join('\n'), stored: J(st), title: env.dom.title, href: env.ctx.location.href }, fa };
}
T['B1 同一組操作在 ' + BASE + ' 的引擎（不載估分）與現在的引擎（載估分）各跑一次：畫面、呼叫、作答紀錄、學習記錄、其他鍵逐位元組相同，現在的多寫了 fa_v1'] = () => {
  const bad = [];
  FLOWS.forEach((f) => {
    const a = flowSnap(f, true), b = flowSnap(f, false);
    Object.keys(a.snap).forEach((k) => {
      if (a.snap[k] !== b.snap[k]) { let i = 0; while (a.snap[k][i] === b.snap[k][i]) i++; bad.push(f.name + ' ' + k + ' @' + i + ': ' + b.snap[k].slice(Math.max(0, i - 40), i + 60)); }
    });
    if (a.fa !== undefined) bad.push(f.name + '：改之前不該有 fa_v1');
    if (!b.fa || !Object.keys(b.fa.i).length) bad.push(f.name + '：現在沒寫 fa_v1');
    if (!/^result |onDone/m.test(b.snap.log)) bad.push(f.name + '：沒有走到結算卡');
  });
  return { ok: !bad.length, detail: bad.join(' | ') || FLOWS.length + ' 種流程' };
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let r;
    try { r = await T[name](); } catch (e) { r = { ok: false, detail: '丟錯：' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ') : e) }; }
    if (r.ok) pass++;
    process.stdout.write((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + String(r.detail).slice(0, 700) + '\n');
  }
  process.stdout.write(pass + ' / ' + names.length + ' 通過\n');
  process.exit(pass === names.length ? 0 : 1);
})();
