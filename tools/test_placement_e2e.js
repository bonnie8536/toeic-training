/* 程度檢測與預估分數的整合測試:無頭 Chrome、真的頁面、假雲端(tools/fixtures/lesson_cloud_stub.js)、假時鐘、假的 Audio。不連外網、不用真的帳號。
   a 新用戶從設定流程選檢測 → 做完 24 題 → 結果頁有聽力、閱讀、總分與範圍 → 設定流程的結果、首頁卡、個人頁、能力分析頁同一個數字
   b 全對與全錯各走一次:題目真的變難/變易、分數在兩端、「450 以上」「150 以下」照規則;已有級別又有課程進度的人只給建議
   c 中途重新整理接著做、聽力音檔失敗(重新播放一次;再失敗換題不記)、超過 24 小時重新開始
   d 做 30 題刷題後個人頁的數字與範圍更新;錯題本重做不改第一次作答
   e 舊使用者(只有舊 28 題):個人頁有閱讀數字、聽力要再做;舊檢測報告還看得到
   f 兩個瀏覽器設定檔同帳號交錯刷題:雲端的 fa_v1 是兩邊的聯集
   g 訪客:開始頁看得到,按開始不建立檢測
   h 375×812 觸控走完整個檢測,每個畫面沒有橫向捲動
   i 沒登入與沒做過檢測的人:首頁、刷題、聽力、模擬考的畫面跟 --base 的資料夾一樣(只差檢測入口改成 24 題與新網址)
   用法:node tools/test_placement_e2e.js [--port <起始埠,用兩個>] [--debug-port <Chrome 的埠>] [--tmp <資料夾>] [--base <對照用的資料夾>]
        [--shots <截圖資料夾>] [--only <測試名稱的一段,幾段用 | 分開>]
   沒給 --base 時 i 不跑(印出來)。--shots 給了時,走到的畫面存 375 與 1280 兩張(檔名「編號_畫面_寬.png」)。 */
'use strict';
const os = require('os');
const path = require('path');
const assert = require('assert');
const K = require('./placement_e2e_kit.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const PORT = Number(opt('--port')) || 8961, BASE_PORT = PORT + 1, DEBUG = Number(opt('--debug-port')) || PORT + 2;
const TMP = path.resolve(opt('--tmp') || os.tmpdir());
const BASE = opt('--base') ? path.resolve(opt('--base')) : null;
const SHOTS = opt('--shots') ? path.resolve(opt('--shots')) : null;
const ONLY = opt('--only') || '';
const { J, sleep } = K;
const DAY = 864e5;
const user = (n, name, created) => ({ id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), email: 's' + n + '@example.com', user_metadata: { name }, created_at: created || new Date(K.nowMs()).toISOString() });
const pidOf = (u) => 'c' + u.id.replace(/-/g, '');
const fresh = (o) => { K.SV.cloud = K.STUB.createCloud(Object.assign({ now: K.nowMs }, o || {})); return K.SV.cloud; };
const open = (u, o) => K.tab(u, Object.assign({ port: PORT }, o || {}));
const shot = (p, name) => K.shot(p, SHOTS, name);
const peek = (p) => p.eval('(() => { const v = ESTIMATE_STORE.peek(); const s = (x) => x && x.show ? [x.kind, x.est, x.lo, x.hi, x.band] : null; return { L: s(v.L), R: s(v.R), total: v.total ? [v.total.est, v.total.lo, v.total.hi] : null, n: v.n }; })()');
const cardText = (p, sel) => p.wait('!!document.querySelector(' + J(sel + ' .est-card') + ')', '預估卡').then(() => p.text(sel + ' .est-card'));
const runOf = (p) => p.eval("(() => { const r = (store.get('placement_v1', {}).runs || []).slice(-1)[0]; return r || null; })()");
const avgB = (p, ids) => p.eval('(' + J(ids) + ').map((id) => { const ks = Object.keys(ITEM_PARAMS.b).filter((k) => k === id || k.indexOf(id + ":") === 0); return ks.reduce((a, k) => a + ITEM_PARAMS.b[k], 0) / ks.length; })');

const T = {};
T['a 新用戶:設定流程選檢測 → 24 題 → 結果頁有兩科、總分與範圍 → 設定結果、首頁、個人頁、能力分析同一個數字'] = async () => {
  fresh();
  const u = user(31, '新同學');
  const p = await open(u);
  await p.go('start.html');
  await p.press('開始'); await p.press('600 分');
  await p.wait("location.search === '?step=exam'", '考試月份');
  await p.press('還沒報名');
  await p.wait("location.search === '?step=level'", '程度');
  await p.press('不確定，幫我測');
  await p.wait("!!document.querySelector('.diag-intro')", '檢測說明');
  await shot(p, '13_設定流程_檢測說明');
  await p.press('開始檢測');
  await p.wait("location.pathname === '/placement.html' && !!document.querySelector('.pl-meta')", '檢測頁直接開始', 20000);
  const taken = new Set();
  const NAMES = { '2': '02_聽力題', '5': '03_閱讀單題', '6': '04_題組' };
  const w = await K.walk(p, 'mix', { hook: async (s) => {
    const name = s.screen === 'between' ? '05_兩科中間' : s.screen === 'quiz' ? NAMES[s.part] : null;
    if (name && !taken.has(name)) { taken.add(name); await shot(p, name); }
    return false;
  } });
  assert.strictEqual(w.units.length, 14, '聽力 8 格、閱讀 6 格');
  await sleep(1500);
  const note = await p.text('.result-card .result-note');
  assert.ok(/^根據 24 題 · 本站估計，不是正式成績。/.test(note), note);
  const card = await p.text('.result-card');
  assert.ok(/預估總分/.test(card) && /聽力/.test(card) && /閱讀/.test(card), card);
  const pv = await peek(p);
  assert.ok(pv.L && pv.R && pv.total, '兩科與總分都有:' + J(pv));
  assert.ok(card.indexOf(String(pv.total[0])) > -1, '結果頁有總分:' + card);
  assert.strictEqual(await p.store('levels'), null, '從設定流程來的:檢測頁不寫級別');
  assert.strictEqual(await p.eval("document.querySelectorAll('#pl-root .btn.primary').length"), 1, '結果頁一顆主按鈕');
  await shot(p, '06_結果頁');
  await p.press('看作答');
  await shot(p, '07_看作答');
  await p.press('下一步');
  await p.wait("location.search === '?step=result' && !!document.querySelector('.result-card') && !document.querySelector('.ob-loading')", '設定結果', 30000);
  await sleep(800);
  const lv = await p.store('levels');
  assert.deepStrictEqual([lv.listening, lv.reading, lv.source], [pv.L[4], pv.R[4], { listening: 'est', reading: 'est' }], '設定流程用預估的級別');
  await shot(p, '14_設定流程_結果頁');
  await p.go('index.html');
  await p.wait("!!document.querySelector('#onboard-home h2')", '首頁卡');
  await shot(p, '15_首頁卡');
  await p.go('me.html');
  const me = await cardText(p, 'main');
  await sleep(1500);
  const meView = await peek(p);
  assert.deepStrictEqual(meView, pv, '個人頁跟結果頁同一份預估');
  [pv.L, pv.R].forEach((s) => assert.ok(me.indexOf(s[0] === 'num' ? String(s[1]) : s[0] === 'high' ? '450 以上' : '150 以下') > -1, '個人頁的數字:' + me));
  await shot(p, '09_個人頁卡片_剛測完');
  await p.go('analysis.html');
  const an = await cardText(p, 'main');
  assert.deepStrictEqual(await peek(p), pv, '能力分析頁同一份預估');
  assert.strictEqual(an.replace(/做.*檢測/, ''), me.replace(/做.*檢測/, '').replace(/依目前預估.*$/, ''), '兩頁的卡片字一樣');
  await shot(p, '12_能力分析頁');
  K.noErrors(p, '新用戶');
  await p.close();
  return '聽力 ' + pv.L.slice(0, 4).join('/') + '、閱讀 ' + pv.R.slice(0, 4).join('/') + '、總分 ' + pv.total.join('/');
};

T['b 全對與全錯:後面的題變難/變易、分數到兩端照「450 以上」「150 以下」;有課程進度的人只給建議'] = async () => {
  const c = fresh();
  const out = {};
  for (const [n, mode] of [[41, 'right'], [42, 'wrong']]) {
    const u = user(n, mode);
    if (mode === 'right') {
      const lv = { listening: 'entry', reading: 'entry', source: { listening: 'manual', reading: 'manual' }, setAt: '2026-11-01T00:00:00.000Z', history: [] };
      c.put(u.id, 'levels', lv, new Date(K.nowMs() - DAY).toISOString());
      c.put(u.id, 'plan', { v: 1, startDate: '2026-11-01' }, new Date(K.nowMs() - DAY).toISOString());
    }
    const p = await open(u);
    await p.go('placement.html');
    if (mode === 'right') await shot(p, '01_檢測開始頁');
    await p.press('開始', '.pl-intro');
    const w = await K.walk(p, mode);
    await sleep(1500);
    const b = await avgB(p, w.units);
    const run = await runOf(p);
    const v = await peek(p);
    out[mode] = { first: b.slice(0, 1).concat(b.slice(8, 9)), late: (b[3] + b[4] + b[5] + b[12] + b[13]) / 5, v, items: run.items.length, card: await p.text('.result-card') };
    if (mode === 'right') {
      assert.deepStrictEqual((await p.store('levels')).listening, 'entry', '有課程進度:不自動改級');
      assert.ok(/改成這個級別/.test(out.right.card), '結果頁給「改成這個級別」');
      await p.go('me.html');
      await cardText(p, 'main');
      await sleep(1500);
      assert.ok(/依目前預估，建議改成/.test(await p.text('.est-card')), '個人頁的建議改級:' + await p.text('.est-card'));
      await shot(p, '11_個人頁卡片_建議改級');
    }
    K.noErrors(p, mode);
    await p.close();
  }
  const R = out.right, W = out.wrong;
  assert.ok(R.late > W.late + 0.5, '全對的人後面的題比較難:' + R.late.toFixed(2) + ' 對 ' + W.late.toFixed(2));
  assert.ok(R.v.L[1] >= 350 && R.v.R[1] >= 350, '全對在高的一端:' + J(R.v));
  assert.ok(W.v.L[1] <= 200 && W.v.R[1] <= 200, '全錯在低的一端:' + J(W.v));
  [R, W].forEach((x) => ['L', 'R'].forEach((s) => {
    const [kind, est] = x.v[s];
    assert.strictEqual(kind, est < 150 ? 'low' : est >= 450 ? 'high' : 'num', s + ' 兩端的規則');
    const text = kind === 'low' ? '150 以下' : kind === 'high' ? '450 以上' : String(est);
    assert.ok(x.card.indexOf(text) > -1, '結果頁寫「' + text + '」:' + x.card);
  }));
  assert.ok(!/\d+ \/ 24|答對/.test(R.card + W.card), '結果頁不寫答對幾題');
  return '全對 後段平均難度 ' + R.late.toFixed(2) + ' 聽 ' + R.v.L.slice(0, 2).join(' ') + ' 讀 ' + R.v.R.slice(0, 2).join(' ')
    + ';全錯 ' + W.late.toFixed(2) + ' 聽 ' + W.v.L.slice(0, 2).join(' ') + ' 讀 ' + W.v.R.slice(0, 2).join(' ');
};

T['c 中途重新整理接著做;音檔失敗重新播放一次、再失敗換題不記;超過 24 小時重新開始'] = async () => {
  fresh();
  const u = user(51, '續做');
  const p = await open(u);
  await p.go('placement.html');
  await p.press('開始', '.pl-intro');
  let failed = null;
  await K.walk(p, 'right', { hook: async (s, i, units) => units.length >= 3 });
  await p.eval('window.__audioFail = 1; true');
  await p.eval(K.PL_ROBOT + ';__plStep("right")');
  await sleep(600);
  assert.ok(/重新播放/.test(await p.text('#pl-root')), '出錯時有「重新播放」');
  await shot(p, '16_聽力重新播放');
  await p.eval("document.querySelector('#pl-root .pl-play').click(), true");
  await sleep(1200);
  const before = await runOf(p);
  const doneIds = before.items.map((x) => x[1]);
  await p.reload();
  await p.wait("!!document.querySelector('.pl-meta')", '重新整理後接著做');
  const s = await p.eval(K.PL_ROBOT + ';__pl()');
  assert.ok(doneIds.indexOf(s.unit) < 0, '接著做的不是做過的題');
  await p.eval('window.__audioFail = 2; true');
  for (let i = 0; i < 12 && !/重新播放/.test(await p.text('#pl-root')); i++) { await p.eval(K.PL_ROBOT + ';__plStep("right")'); await sleep(300); }
  const dead = (await p.eval(K.PL_ROBOT + ';__pl()')).unit;
  await p.eval("document.querySelector('#pl-root .pl-play').click(), true");
  await sleep(900);
  const after = (await p.eval(K.PL_ROBOT + ';__pl()')).unit;
  assert.ok(after && after !== dead, '兩次失敗換另一題:' + dead + ' → ' + after);
  failed = dead;
  await K.walk(p, 'right');
  await sleep(1200);
  const run = await runOf(p);
  assert.ok(run.items.every((x) => x[1].split(':')[0] !== failed), '失敗兩次的題不記');
  assert.strictEqual(run.items.length, 24);
  await p.go('placement.html');
  await p.press('開始', '.pl-intro');
  await K.walk(p, 'right', { hook: async (x, i, units) => units.length >= 2 });
  await K.advance([p], 25 * 3600e3);
  await p.reload();
  assert.ok(await p.eval("!!document.querySelector('.pl-intro')"), '超過 24 小時:回開始頁,不接著做');
  K.noErrors(p, '續做');
  await p.close();
  K.CLK.off = 0;
  return '換題 ' + dead + ' → ' + after;
};

T['d 做 30 題刷題後個人頁的數字與範圍更新;錯題本重做不改第一次作答'] = async () => {
  fresh();
  const u = user(61, '練習');
  const p = await open(u);
  await p.go('placement.html');
  await p.press('開始', '.pl-intro');
  await K.walk(p, 'wrong');
  await sleep(1200);
  await p.go('me.html');
  await cardText(p, 'main');
  await sleep(1500);
  const v0 = await peek(p);
  for (let i = 0; i < 3; i++) await K.practiceRound(p, 'practice.html?part=5', true);
  await sleep(800);
  await p.go('me.html');
  await cardText(p, 'main');
  await sleep(1500);
  const v1 = await peek(p);
  const fresh30 = await p.eval("Object.values(store.get('fa_v1', { i: {} }).i).filter((x) => x[2] === 'p' && x[1] !== null).length");
  assert.ok(fresh30 >= 25 && v1.n - v0.n === fresh30, '多算的題數等於刷題新記的第一次作答(做過檢測的題不算):' + v0.n + ' → ' + v1.n + ',新記 ' + fresh30);
  assert.ok(v1.R[1] > v0.R[1], '閱讀數字往上:' + v0.R[1] + ' → ' + v1.R[1]);
  assert.ok(v1.R[3] - v1.R[2] < v0.R[3] - v0.R[2] || v1.R[0] !== 'num' || v0.R[0] !== 'num', '範圍變窄:' + J([v0.R, v1.R]));
  await shot(p, '10_個人頁卡片_練習後');
  await K.practiceRound(p, 'practice.html?part=5', false);
  await sleep(800);
  const fa1 = await p.store('fa_v1');
  await p.go('me.html'); await sleep(1500);
  const n1 = (await peek(p)).n;
  await K.practiceRound(p, 'practice.html?mode=review&part=5', true);
  await sleep(800);
  const fa2 = await p.store('fa_v1');
  const wrong = Object.keys(fa1.i).filter((k) => /^p5-/.test(k) && fa1.i[k][1] === 0 && fa1.i[k][2] === 'p');
  const redo = await p.eval("(() => { const d = store.get('drill_p5', {}); return " + J(wrong) + ".filter((k) => d[k] && d[k].ok).length; })()");
  assert.ok(redo > 0, '錯題本有重做到');
  assert.strictEqual(J(fa2), J(fa1), '錯題本重做不改第一次作答');
  await p.go('me.html'); await sleep(1500);
  assert.strictEqual((await peek(p)).n, n1, '重做不增加題數');
  K.noErrors(p, '練習');
  await p.close();
  return '閱讀 ' + v0.R.slice(1, 4).join('/') + ' → ' + v1.R.slice(1, 4).join('/') + ',題數 ' + v0.n + ' → ' + v1.n + ',錯題本重做 ' + redo + ' 題、第一次作答不變';
};

T['e 舊使用者(只有舊 28 題):個人頁閱讀有數字、聽力要再做;舊檢測報告還看得到'] = async () => {
  const c = fresh();
  const u = user(71, '舊同學', '2026-09-01T00:00:00.000Z');
  const old = new Date(K.nowMs() - 20 * DAY).toISOString();
  const answers = {}; for (let i = 0; i < 28; i++) answers[i] = i % 4;
  const diag = { answers, done: true, startedAt: old, finishedAt: old };
  c.put(u.id, 'diag', diag, old);
  const p = await open(u);
  await p.go('me.html');
  const t = await cardText(p, 'main');
  await sleep(1500);
  const v = await peek(p);
  assert.ok(v.R && !v.L, '閱讀有數字、聽力沒有:' + J(v));
  assert.ok(/再做 12 題聽力，就會顯示預估分數。/.test(await p.text('.est-card')), await p.text('.est-card'));
  assert.ok(/做聽力檢測/.test(t), '主按鈕做聽力檢測');
  assert.deepStrictEqual(await p.store('diag'), diag, '舊檢測不動');
  await shot(p, '08_個人頁卡片_資料不夠');
  await p.go('diagnostic.html');
  await p.wait("!!document.querySelector('.result-card')", '舊檢測報告');
  K.noErrors(p, '舊使用者');
  await p.close();
  return '閱讀 ' + v.R.slice(0, 2).join(' ');
};

T['f 兩個瀏覽器設定檔同帳號交錯刷題:fa_v1 是聯集'] = async () => {
  const c = fresh();
  const u = user(81, '兩台');
  const a = await open(u), b = await open(u);
  await K.practiceRound(a, 'practice.html?part=5', true);
  await sleep(2500);
  const ka = Object.keys((await a.store('fa_v1')).i);
  await K.practiceRound(b, 'practice.html?part=6', true);
  await sleep(2500);
  const kb = Object.keys((await b.store('fa_v1')).i);
  await K.practiceRound(a, 'practice.html?part=7', true);
  await sleep(3000);
  const ka2 = Object.keys((await a.store('fa_v1')).i);
  const cloud = Object.keys((c.get(u.id, 'fa_v1') || { i: {} }).i);
  const all = new Set(ka.concat(kb, ka2));
  assert.ok([...all].every((k) => cloud.indexOf(k) > -1), '雲端有兩邊的題:' + [...all].filter((k) => cloud.indexOf(k) < 0).join(','));
  await b.go('me.html');
  await sleep(1500);
  const kb2 = Object.keys((await b.store('fa_v1')).i);
  assert.ok([...all].every((k) => kb2.indexOf(k) > -1), '另一台讀回後也是聯集');
  K.noErrors(a, '第一台'); K.noErrors(b, '第二台');
  await a.close(); await b.close();
  return '第一台 ' + ka2.length + ' 題、第二台 ' + kb.length + ' 題、雲端 ' + cloud.length + ' 題';
};

T['g 訪客:開始頁看得到,按開始不建立檢測'] = async () => {
  fresh();
  const p = await open(null);
  await p.go('placement.html');
  assert.ok(await p.eval("!!document.querySelector('.pl-intro .pl-go[data-gate]')"), '開始鈕帶 data-gate');
  await p.press('開始', '.pl-intro');
  await sleep(800);
  assert.ok(await p.eval("!document.querySelector('.pl-meta')"), '沒有開始作答');
  assert.ok(await p.eval("Object.keys(localStorage).every((k) => !/placement_v1|fa_v1/.test(k))"), '沒有寫檢測的鍵');
  await p.close();
  return 'ok';
};

T['h 375×812 觸控走完整個檢測,每個畫面沒有橫向捲動'] = async () => {
  fresh();
  const p = await open(user(91, '手機'), { w: 375, h: 812, touch: true });
  await p.go('placement.html');
  await K.noOverflow(p, '開始頁');
  await p.press('開始', '.pl-intro');
  let n = 0;
  await K.walk(p, 2, { hook: async (s) => { if (s.screen !== 'other') { n++; await K.noOverflow(p, s.screen + ' ' + (s.part || '')); } return false; } });
  await sleep(1200);
  await K.noOverflow(p, '結果頁');
  assert.ok(/^根據 24 題/.test(await p.text('.result-note')));
  K.noErrors(p, '手機');
  await p.close();
  return '檢查 ' + n + ' 個畫面';
};

/* i:畫面的字與連結;舊版到新版只准換掉檢測入口(28 題 → 24 題、diagnostic.html → placement.html)與首頁卡的副標 */
const SWAP = [['diagnostic.html', 'placement.html'], ['28 題檢測（約 20 分鐘）', '24 題檢測（約 15–20 分鐘）'], ['28 題', '24 題']];
const SNAP = "(() => { const m = document.querySelector('main'); return { text: m ? m.innerText.replace(/\\s+/g, ' ').trim() : '', links: Array.from(document.querySelectorAll('main a, header a')).map((a) => a.getAttribute('href')), title: document.title }; })()";
T['i 沒登入與沒做過檢測的人:首頁、刷題、聽力、模擬考跟舊版一樣(只差檢測入口)'] = async () => {
  if (!BASE) return '沒給 --base,不跑';
  const diffs = [];
  for (const who of [null, user(99, '空帳號')]) {
    fresh();
    const now = await open(who), base = await K.tab(who, { port: BASE_PORT });
    for (const url of ['index.html', 'drill.html', 'listening.html', 'mock.html']) {
      await now.go(url); await base.go(url);
      const a = await now.eval(SNAP), b = await base.eval(SNAP);
      const fix = (s) => SWAP.reduce((x, [o, n]) => x.split(o).join(n), s);
      const bb = { text: fix(b.text), links: b.links.map(fix), title: b.title };
      if (J(a) !== J(bb)) diffs.push((who ? '登入 ' : '沒登入 ') + url + ':' + J(a).slice(0, 200) + ' ≠ ' + J(bb).slice(0, 200));
      K.noErrors(now, url);
    }
    await now.close(); await base.close();
  }
  assert.deepStrictEqual(diffs, []);
  return '8 個畫面一樣';
};

async function main() {
  const srv = await K.serve(K.REPO, PORT);
  const bsrv = BASE ? await K.serve(BASE, BASE_PORT) : null;
  const names = Object.keys(T).filter((n) => !ONLY || ONLY.split('|').some((o) => n.indexOf(o) > -1));
  let pass = 0, warn = '';
  try {
    await K.launch(TMP, DEBUG);
    for (const name of names) {
      let detail = '', ok = true;
      K.CLK.off = 0;
      try { detail = await T[name](); } catch (e) { ok = false; detail = e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e); }
      if (ok) pass++;
      console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + String(detail).slice(0, 700) : ''));
    }
  } finally {
    warn = await K.shutdown();
    srv.close();
    if (bsrv) bsrv.close();
  }
  if (warn) console.log(warn);
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
