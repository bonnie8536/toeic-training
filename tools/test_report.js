/* 回報題目(js/report.js、各頁詳解方塊的按鈕)。
   假 DOM + 假 store + 假 Supabase,不連網、不開瀏覽器、不改 repo 檔案。用法:node tools/test_report.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const K = require('./owner_test_kit.js');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const COMMON = read('js/common.js');
const H_SRC = (COMMON.match(/function h\(tag[\s\S]*?\n}\r?\n/) || [''])[0];
const J = (x) => JSON.stringify(x);
const T = {};

/* 一個新環境。opts:joined(true/false/'error')、online、canKeep、storeFails、membershipHold(回傳 release 函式) */
function env(opts) {
  const o = Object.assign({ joined: true, online: true, canKeep: true, storeFails: false }, opts || {});
  const dom = K.fakeDom();
  /* 假 DOM 的 querySelectorAll 回空陣列;焦點圈需要,補一個依標籤找的 */
  dom.Node.prototype.querySelectorAll = function () { return this.find((n) => ['BUTTON', 'INPUT', 'TEXTAREA'].includes(n.tagName) || (n.tagName === 'A' && n.attrs.href)); };
  const mem = new Map();
  const log = { sets: 0, gets: 0, memberQueries: 0, asked: 0 };
  let release = null;
  const holdP = o.hold ? new Promise((r) => { release = r; }) : null;
  const ctx = { console: { warn() {}, log() {}, error() {} }, document: dom.document, window: {}, setTimeout, clearTimeout, Promise,
    navigator: { onLine: o.online, clipboard: { writeText: async (t) => { ctx.copied = t; } } }, location: { pathname: '/practice.html' } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(H_SRC, ctx);
  ctx.store = {
    get: (k, fb) => { log.gets++; return mem.has(k) ? JSON.parse(mem.get(k)) : fb; },
    set: (k, v) => { log.sets++; if (!o.storeFails) mem.set(k, J(v)); },
  };
  ctx.canKeepProgress = () => o.canKeep;
  ctx.PROFILE = { askToAct: () => { log.asked++; } };
  const query = () => {
    log.memberQueries++;
    const b = { select() { return b; }, eq() { return b; }, then(ok, bad) {
      const res = o.joined === 'error' ? { data: null, error: { message: 'x' } } : { data: o.joined ? [{ class_id: 'c1' }] : [], error: null };
      return (holdP ? holdP.then(() => res) : Promise.resolve(res)).then(ok, bad);
    } };
    return b;
  };
  ctx.CLOUD = { enabled: true, ready: Promise.resolve({}), user: { id: 'u1' }, client: { from: (t) => (t === 'memberships' ? query() : null) } };
  vm.runInContext(read('js/report.js'), ctx);
  const R = ctx.REPORT;
  const explain = () => { const e = new dom.Node('div'); e.className = 'explain'; dom.body.append(e); return e; };
  return { ctx, dom, R, mem, log, explain, release: () => release && release(), body: dom.body, stored: () => (mem.has('q_reports') ? JSON.parse(mem.get('q_reports')) : {}) };
}
const modal = (E) => E.body.byClass('modal-mask')[0] || null;
const radios = (m) => m.find((n) => n.tagName === 'INPUT' && n.attrs.type === 'radio');
const submitBtn = (m) => m.find((n) => n.tagName === 'BUTTON' && n.attrs.type === 'submit')[0];
const noteBox = (m) => m.find((n) => n.tagName === 'TEXTAREA')[0];
async function openAndSend(E, ctx, type, note) {
  const ex = E.explain();
  E.R.attach(ex, ctx);
  const btn = ex.byClass('report-btn')[0];
  await btn.fire('click');
  const m = modal(E);
  const r = radios(m).find((x) => x.attrs.value === type);
  r.checked = true; await r.fire('change');
  if (note !== undefined) noteBox(m).value = note;
  await m.find((n) => n.tagName === 'FORM')[0].fire('submit');
  await K.settle();
  return { btn, m };
}
const CTX = { m: 'p5', id: 'p5-b3-04' };
const title = (m) => m.byClass('auth-h')[0].textContent;
const ALL_TEXT = [];

T['搬家規則:q_reports 是 pool,合併兩邊留 t 新的'] = () => {
  const E = env();
  vm.runInContext(read('js/move-rules.js'), E.ctx); vm.runInContext(read('js/move-merge.js'), E.ctx);
  const rule = E.ctx.MOVE_RULES.ruleOf('q_reports');
  const a = { 'p5:a': { c: 'typo', n: '', t: 5, f: 5 }, 'p5:b': { c: 'other', n: '', t: 1, f: 1 } };
  const b = { 'p5:a': { c: 'wrong_key', n: '新', t: 9, f: 3 }, 'p5:c': { c: 'audio', n: '', t: 2, f: 2 } };
  const v = E.ctx.MOVE_MERGE.pool(a, b);
  return { ok: rule === 'pool' && v['p5:a'].c === 'wrong_key' && v['p5:a'].t === 9 && !!v['p5:b'] && !!v['p5:c'], detail: rule + ' ' + J(Object.keys(v)) };
};
T['選項:六個(有音檔才有「音檔有問題」),預設都沒選、送出鈕 disabled'] = async () => {
  const E1 = env();
  const ex = E1.explain(); E1.R.attach(ex, CTX);
  await ex.byClass('report-btn')[0].fire('click');
  const m = modal(E1);
  const labels = m.byClass('buy-opt-name').map((n) => n.textContent);
  const E2 = env();
  const ex2 = E2.explain(); E2.R.attach(ex2, { m: 'l1', id: 'l1-02', audio: true });
  await ex2.byClass('report-btn')[0].fire('click');
  const l2 = modal(E2).byClass('buy-opt-name').map((n) => n.textContent);
  const none = radios(m).every((r) => !r.checked) && submitBtn(m).disabled === true;
  return { ok: labels.join() === '答案有誤,不只一個答案,題目或選項有錯字,詳解看不懂,其他' && l2.length === 6 && l2.includes('音檔有問題') && none, detail: labels.length + ' / ' + l2.length };
};
T['寫入:store 有 q_reports[key] = { c, n, t, f };補充說明去頭尾空白、換行變空格、超過 200 字截斷'] = async () => {
  const E = env();
  const long = '長'.repeat(260);
  await openAndSend(E, CTX, 'wrong_key', '  第一行\n第二行\t  ' + long + '  ');
  const e = E.stored()['p5:p5-b3-04'];
  const note = e && e.n;
  return { ok: !!e && e.c === 'wrong_key' && e.t > 0 && e.f === e.t && note.startsWith('第一行 第二行 長') && note.length === 200 && !/[\n\t]/.test(note) && Object.keys(e).sort().join() === 'c,f,n,t', detail: J(e).slice(0, 80) };
};
T['重複回報:同題只有一筆、f 不變、c 與 n 更新;視窗預選上次類型並寫日期'] = async () => {
  const E = env();
  await openAndSend(E, CTX, 'typo', '第一次');
  const f1 = E.stored()['p5:p5-b3-04'].f;
  E.body.byClass('modal-mask').forEach((n) => n.remove());
  await new Promise((r) => setTimeout(r, 5));
  const ex = E.explain(); E.R.attach(ex, CTX);
  await ex.byClass('report-btn')[0].fire('click');
  const m = modal(E);
  const pre = radios(m).find((r) => r.checked);
  const dateLine = m.textContent.includes('回報過這題，再送出會更新內容。');
  const noteBack = noteBox(m).value;
  const r2 = radios(m).find((x) => x.attrs.value === 'unclear'); r2.checked = true; await r2.fire('change');
  noteBox(m).value = '第二次';
  await m.find((n) => n.tagName === 'FORM')[0].fire('submit'); await K.settle();
  const all = E.stored(); const e = all['p5:p5-b3-04'];
  return { ok: Object.keys(all).length === 1 && e.f === f1 && e.c === 'unclear' && e.n === '第二次' && e.t >= f1 && pre && pre.attrs.value === 'typo' && dateLine && noteBack === '第一次', detail: J(e) };
};
T['存量上限:先放 100 筆再送第 101 題,總數仍是 100,最舊的被丟掉'] = async () => {
  const E = env();
  const seed = {};
  for (let i = 0; i < 100; i++) seed['p5:old' + i] = { c: 'other', n: '', t: 1000 + i, f: 1000 + i };
  E.mem.set('q_reports', J(seed));
  await openAndSend(E, { m: 'p5', id: 'newest' }, 'typo');
  const all = E.stored();
  return { ok: Object.keys(all).length === 100 && !all['p5:old0'] && !!all['p5:old1'] && !!all['p5:newest'], detail: Object.keys(all).length + ' 筆' };
};
T['沒登入:按鈕有 data-gate;canKeepProgress 為假時不開視窗、不寫入,改叫登入卡'] = async () => {
  const E = env({ canKeep: false });
  const ex = E.explain(); E.R.attach(ex, CTX);
  const btn = ex.byClass('report-btn')[0];
  await btn.fire('click');
  return { ok: btn.hasAttribute('data-gate') && !modal(E) && E.log.sets === 0 && E.log.asked === 1 && !('q_reports' in E.stored()) && Object.keys(E.stored()).length === 0, detail: 'asked ' + E.log.asked + ',sets ' + E.log.sets };
};
T['在班:結果標題「已收到回報」,沒有寄信鈕'] = async () => {
  const E = env({ joined: true });
  const { m } = await openAndSend(E, CTX, 'wrong_key', 'x');
  ALL_TEXT.push(m.textContent);
  return { ok: title(m) === '已收到回報' && !m.find((n) => n.tagName === 'A').length && E.log.memberQueries === 1, detail: title(m) };
};
T['不在班與查詢失敗:「已記下回報」,有寄信鈕與地址,mailto 內容與編碼正確、長度小於 1500'] = async () => {
  const outs = [];
  for (const joined of [false, 'error']) {
    const E = env({ joined });
    const note = '他說 A&B #1\n第二行，' + '字'.repeat(190);
    const { m } = await openAndSend(E, CTX, 'multi_key', note);
    ALL_TEXT.push(m.textContent);
    const a = m.find((n) => n.tagName === 'A')[0];
    const href = a && a.attrs.href;
    const q = href ? href.split('?')[1] : '';
    const params = {}; q.split('&').forEach((p) => { const i = p.indexOf('='); params[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); });
    outs.push({ t: title(m), href, params, hasAddr: m.textContent.includes('rushuplanguage@gmail.com'), line: m.textContent.includes('寄出信件後，客服才收得到。') });
  }
  const ok = outs.every((x) => x.t === '已記下回報' && x.href.startsWith('mailto:rushuplanguage@gmail.com?') && x.href.length < 1500 && x.hasAddr && x.line
    && x.params.subject === '題目回報 p5-b3-04（Part 5）不只一個答案' && x.params.body.includes('題號：p5-b3-04') && x.params.body.includes('Part：5')
    && x.params.body.includes('回報類型：不只一個答案') && x.params.body.includes('補充說明：他說 A&B #1 第二行，') && x.params.body.includes('頁面：practice.html'));
  return { ok, detail: outs.map((x) => x.t + ' ' + (x.href || '').length).join(' / ') };
};
T['mailto:補充說明很長時整段網址仍小於 1500'] = () => {
  const E = env();
  const url = E.R.mailto({ c: 'other', n: '字'.repeat(200) }, { m: 'p6', id: 'p6-b10-4:2' });
  return { ok: url.length < 1500 && url.length > 300 && decodeURIComponent(url).includes('Part：6'), detail: url.length + ' 字元' };
};
T['離線(在班):寫「已存在這台裝置，連上網路後會自動送出。」,不寫「已收到」,store 照樣寫入'] = async () => {
  const E = env({ joined: true, online: false });
  const { m } = await openAndSend(E, CTX, 'typo', '');
  ALL_TEXT.push(m.textContent);
  return { ok: title(m) === '已存在這台裝置，連上網路後會自動送出。' && !m.textContent.includes('已收到') && !!E.stored()['p5:p5-b3-04'], detail: title(m) };
};
T['寫入失敗:顯示錯誤句,視窗不關,輸入留著'] = async () => {
  const E = env({ storeFails: true });
  const ex = E.explain(); E.R.attach(ex, CTX);
  await ex.byClass('report-btn')[0].fire('click');
  const m = modal(E);
  const r = radios(m)[0]; r.checked = true; await r.fire('change');
  noteBox(m).value = '我寫的字';
  await m.find((n) => n.tagName === 'FORM')[0].fire('submit'); await K.settle();
  const msg = m.byClass('auth-msg')[0].textContent;
  ALL_TEXT.push(msg);
  return { ok: msg === '存不進去，請重新整理後再試。' && !!modal(E) && noteBox(m).value === '我寫的字' && !submitBtn(m).disabled, detail: msg };
};
T['文案:全部結果文案不含「停止出題」「暫停」「審」「專家」,無破折號、emoji、半形標點'] = () => {
  const src = read('js/report.js');
  const strings = (src.match(/'[^'\n]*[一-鿿][^'\n]*'/g) || []).join('\n') + ALL_TEXT.join('\n');
  const bad = [/停止出題|暫停|已審|專家|審訂|人工/, /[—–―]/, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, /[一-鿿][,;:?!]/].filter((re) => re.test(strings));
  return { ok: bad.length === 0 && ALL_TEXT.length >= 4, detail: bad.length + ' 項違規,檢查了 ' + ALL_TEXT.length + ' 段結果文案' };
};
T['視窗:Esc 關、焦點回原按鈕、已有視窗時不開第二個、Tab 圈在視窗內'] = async () => {
  const E = env();
  const ex = E.explain(); E.R.attach(ex, CTX);
  const btn = ex.byClass('report-btn')[0];
  btn.focus();
  await btn.fire('click');
  const m = modal(E);
  await btn.fire('click');
  const one = E.body.byClass('modal-mask').length === 1;
  const items = radios(m).concat(noteBox(m));
  const last = m.find((n) => n.tagName === 'BUTTON');   // 關閉鈕、送出鈕
  const sub = submitBtn(m);
  radios(m)[0].checked = true; await radios(m)[0].fire('change');
  sub.focus();
  const prevented = E.dom.document.key({ key: 'Tab' });
  const wrapped = E.dom.document.activeElement !== sub;
  E.dom.document.key({ key: 'Escape' });
  const closed = !modal(E);
  const back = E.dom.document.activeElement === btn;
  return { ok: one && prevented && wrapped && closed && back && items.length > 0 && last.length > 0, detail: J({ one, prevented, wrapped, closed, back }) };
};
T['視窗:送出中不能關(等班級查詢回來才有結果)'] = async () => {
  const E = env({ joined: true, hold: true });
  const ex = E.explain(); E.R.attach(ex, CTX);
  await ex.byClass('report-btn')[0].fire('click');
  const m = modal(E);
  const r = radios(m)[0]; r.checked = true; await r.fire('change');
  const p = m.find((n) => n.tagName === 'FORM')[0].fire('submit');
  await K.settle();
  E.dom.document.key({ key: 'Escape' });
  const stillOpen = !!modal(E);
  E.release(); await p; await K.settle();
  return { ok: stillOpen && title(modal(E)) === '已收到回報', detail: 'stillOpen ' + stillOpen };
};
T['按鈕:同一個詳解方塊只加一次;aria-label 帶 Part 與題號;缺題號不加'] = () => {
  const E = env();
  const ex = E.explain();
  E.R.attach(ex, CTX); E.R.attach(ex, CTX);
  const n = ex.byClass('report-btn').length;
  const label = ex.byClass('report-btn')[0].attrs['aria-label'];
  const ex2 = E.explain();
  const none = E.R.attach(ex2, { m: 'p5', id: '' }) === null && ex2.byClass('report-btn').length === 0 && E.R.attach(null, CTX) === null;
  return { ok: n === 1 && label === '回報題目，Part 5，p5-b3-04' && none, detail: n + ' 顆;' + label };
};
T['normalize:不是物件當空的,壞掉的單筆丟掉,不改傳進來的'] = () => {
  const E = env();
  const src = { a: { c: 'typo', n: ' x ', t: 5 }, b: { c: 'nope', t: 1 }, c: 'junk', d: { c: 'other', t: 'x' } };
  const before = J(src);
  const out = E.R.normalize(src);
  return { ok: J(Object.keys(out)) === '["a"]' && out.a.f === 5 && J(E.R.normalize('x')) === '{}' && J(E.R.normalize([1])) === '{}' && J(E.R.normalize(null)) === '{}' && J(src) === before, detail: J(out) };
};
T['不改既有鍵:report.js 只讀寫 q_reports'] = () => {
  const src = read('js/report.js');
  const keys = Array.from(src.matchAll(/store\.(?:get|set|remove)\('([^']+)'/g)).map((m) => m[1]);
  return { ok: keys.length > 0 && keys.every((k) => k === 'q_reports') && !/localStorage|sessionStorage/.test(src), detail: J(Array.from(new Set(keys))) };
};

K.run(T);
