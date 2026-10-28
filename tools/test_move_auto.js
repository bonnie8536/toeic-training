/* 舊網址自動搬家(有資料的訪客、本機學生不用按按鈕):舊網址每一頁組好搬家碼、帶到新網址 move-in.html#auto=,
   新網址驗證合併後帶回舊網址 move-out.html#ack=,舊網址核對雜湊才寫 tr_move_done。
   這裡測判斷、上限、特殊環境、同一個分頁不重試、ack 對不上不寫、網址的格式;無頭 Chrome 的整條路在 tools/test_move_e2e.js。
   用法:node tools/test_move_auto.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const OLD = 'https://www.shuashualanguage.com', NEW = 'https://www.rushuplanguage.com';
const J = JSON.stringify;
const T = {};
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function loadLink() {
  const ctx = { crypto: globalThis.crypto, Uint8Array, Array, Object, JSON };
  vm.createContext(ctx);
  vm.runInContext(read('js/move-link.js'), ctx);
  return ctx.MOVE_LINK;
}

/* 舊網址的一頁:move-rules、move-merge、move-pack、move-link、move-out 都載好(真的頁面是 move-out.js 自己補載);
   opt:{ ls, path, search, ping, ua, standalone, session: 'ok' | 'none'(不給寫) | 物件(分頁裡已經有的), cloud } */
function loadOld(opt) {
  const store = new Map(Object.entries(opt.ls || {}));
  const writes = [];
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), key: (i) => [...store.keys()][i] || null, get length() { return store.size; },
    setItem: (k, v) => { writes.push(k); store.set(k, String(v)); }, removeItem: (k) => { writes.push('-' + k); store.delete(k); },
  };
  const sess = new Map(Object.entries(opt.session && typeof opt.session === 'object' ? opt.session : {}));
  const sessionStorage = opt.session === 'none'
    ? { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } }
    : { getItem: (k) => (sess.has(k) ? sess.get(k) : null), setItem: (k, v) => { sess.set(k, String(v)); }, removeItem: (k) => { sess.delete(k); } };
  const loc = { protocol: 'https:', origin: OLD, pathname: opt.path || '/grammar.html', search: opt.search || '', hash: opt.hash || '', replaced: null,
    replace(u) { loc.replaced = u; }, assign(u) { loc.assigned = u; } };
  const bars = [];
  const node = (tag) => ({ tag, attrs: {}, children: [], textContent: '', setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, remove() { this.removed = true; }, get id() { return this.attrs.id; } });
  const body = { children: [], insertBefore(n) { bars.push(n); this.children.unshift(n); } };
  const textOf = (n) => (n.textContent || '') + n.children.map(textOf).join(' ');
  const win = {
    localStorage: ls, sessionStorage, location: loc, addEventListener() {},
    caches: { open: async () => ({}), delete: async () => true, keys: async () => [] },
    document: { set cookie(v) { /* 記號另外測 */ }, body, head: { appendChild() {} }, visibilityState: 'visible', addEventListener() {},
      getElementById: (id) => bars.filter((b) => !b.removed && b.attrs.id === id)[0] || null, createElement: node },
    navigator: { userAgent: opt.ua || UA_PC, platform: /iPhone/.test(opt.ua || '') ? 'iPhone' : 'Win32', maxTouchPoints: 0, standalone: !!opt.standalone },
    matchMedia: () => ({ matches: !!opt.standalone }),
    fetch: async () => { if (opt.ping !== 'fail') return { ok: true, text: async () => 'rushup-move-ping 1' }; throw new TypeError('fail'); },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)), clearTimeout, AbortController, MOVE_OUT_NO_AUTO: true,
    crypto: globalThis.crypto, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream, btoa, atob,
    MOVE: { from: [OLD], to: NEW, onOld: true, onNew: false, newName: 'www.rushuplanguage.com', oldName: 'shuashualanguage.com' },
  };
  if (opt.cloud) win.CLOUD = opt.cloud;
  win.window = win;
  vm.createContext(win);
  const asWin = (src) => src.replace(/typeof globalThis !== 'undefined' \? globalThis : this/g, 'window');
  ['js/move-rules.js', 'js/move-merge.js', 'js/move-pack.js', 'js/move-link.js'].forEach((f) => vm.runInContext(asWin(read(f)), win));
  vm.runInContext(read('js/move-out.js'), win);
  return { win, ls, store, writes, sess, loc, bars, barText: () => bars.filter((b) => !b.removed).map(textOf).join(' | '), O: win.MOVE_OUT, L: win.MOVE_LINK, P: win.MOVE_PACK };
}
const bank = (id, name, words) => ({ id, name, words: words.map((w) => ({ en: w, zh: '中' + w })) });
const HIST = J([{ t: Date.now() - 60000, m: 'p5', id: 'q1', c: 1, ok: true }]);
const BANKS = J([bank('b1', '我的單字', ['apple', 'banana'])]);
/* 壓不小的資料:隨機字(gzip 之後還是很大) */
function noise(n) { let s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }

/* ---------- 網址格式(js/move-link.js) ---------- */
T['上限:整個網址 48 KB(Safari 約 8 萬字、Firefox 網址列 65536 字都放得下)'] = () => {
  const L = loadLink();
  assert.equal(L.AUTO_MAX, 48 * 1024);
};
T['原路徑:只收本站的路徑與查詢字串;別的網站、// 開頭、反斜線、javascript:、太長的都改成 /'] = () => {
  const L = loadLink();
  assert.equal(L.safeBack('/vocab.html?x=1'), '/vocab.html?x=1');
  assert.equal(L.safeBack('/'), '/');
  assert.equal(L.safeBack('/practice.html?part=5&n=10'), '/practice.html?part=5&n=10');
  for (const bad of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)', 'vocab.html', '', null, undefined, 5, '/' + 'a'.repeat(600), '/a b', '/a"b', '/a<b']) {
    assert.equal(L.safeBack(bad), '/', String(bad));
  }
};
T['#auto= 與 #ack= 的格式:組出來的解得回去;格式不對回 null'] = () => {
  const L = loadLink();
  const code = 'RU1Z:H4sIAAAAAAAAA+3/AAAA==';
  const u = L.autoUrl(NEW, code, '/vocab.html?x=1');
  assert.equal(u.indexOf(NEW + '/move-in.html#auto='), 0);
  const a = L.parseAuto(u.slice(u.indexOf('#')));
  assert.deepEqual(JSON.parse(J(a)), { code, back: '/vocab.html?x=1' });
  assert.equal(L.parseAuto('#auto=' + code).back, '/');
  assert.equal(L.parseAuto('#auto=' + code + '&back=' + encodeURIComponent('//evil.example')).back, '/');
  assert.equal(L.parseAuto('#auto=<script>'), null);
  assert.equal(L.parseAuto('#foo'), null);
  assert.equal(L.parseAuto(''), null);
  const h = 'a'.repeat(64);
  const k = L.ackUrl(OLD, h, '/grammar.html');
  assert.equal(k, OLD + '/move-out.html#ack=' + h + '&back=' + encodeURIComponent('/grammar.html'));
  assert.deepEqual(JSON.parse(J(L.parseAck(k.slice(k.indexOf('#'))))), { hash: h, back: '/grammar.html' });
  assert.equal(L.parseAck('#ack=xyz'), null);
  assert.equal(L.parseAck('#ack=' + h + '&back=%E0%A4%A'), null, '解不開的 back');
};

/* ---------- 舊網址:要不要自動 ---------- */
T['判斷:只有 bar、ask 才自動;付款結果頁、LINE/FB/IG、主畫面 App、這個分頁試過、按過等一下再搬、登入著卻不能對帳的都不自動'] = () => {
  const { O } = loadOld({});
  const base = { kind: 'bar', page: 'grammar.html', inApp: false, standalone: false, tried: false, later: false, loggedIn: false, canFlush: false };
  const b = (o) => O.autoBlock(Object.assign({}, base, o));
  assert.equal(b({}), '');
  assert.equal(b({ kind: 'ask', page: 'pricing.html' }), '');
  for (const k of ['go', 'login', 'offline', 'stay']) assert.notEqual(b({ kind: k }), '', k);
  assert.notEqual(b({ kind: 'ask', page: 'pay-result.html' }), '');
  assert.notEqual(b({ inApp: true }), '');
  assert.notEqual(b({ standalone: true }), '');
  assert.notEqual(b({ tried: true }), '');
  assert.notEqual(b({ later: true }), '');
  assert.notEqual(b({ loggedIn: true }), '');
  assert.equal(b({ loggedIn: true, canFlush: true }), '');
};
T['特殊環境偵測:LINE、Facebook、Instagram 內建瀏覽器;iPhone 主畫面 App;一般瀏覽器都不是'] = () => {
  const { O } = loadOld({});
  assert.deepEqual(J(O.envOf({ userAgent: UA_PC }, () => ({ matches: false }))), J({ inApp: false, standalone: false }));
  assert.equal(O.envOf({ userAgent: UA_IPHONE + ' Line/13.0.0' }, () => ({ matches: false })).inApp, true);
  assert.equal(O.envOf({ userAgent: UA_IPHONE + ' [FBAN/FBIOS;FBAV/400.0]' }, () => ({ matches: false })).inApp, true);
  assert.equal(O.envOf({ userAgent: UA_IPHONE + ' Instagram 300.0' }, () => ({ matches: false })).inApp, true);
  assert.equal(O.envOf({ userAgent: UA_IPHONE, standalone: true }, () => ({ matches: false })).standalone, true);
  assert.equal(O.envOf({ userAgent: UA_PC }, () => ({ matches: true })).standalone, true);
};

/* ---------- 舊網址:整個自動流程 ---------- */
T['有題庫的訪客:先顯示「正在把你的進度帶過去」,帶到新網址 move-in.html#auto=<搬家碼>&back=<原路徑>;搬家碼跟「複製搬家碼」同一包;舊網址一筆都沒改'] = async () => {
  const o = loadOld({ ls: { tr_vgame_banks: BANKS, tr_hist: HIST }, path: '/vocab.html', search: '?x=1' });
  const before = new Map(o.store);
  assert.equal(await o.O.start(), 'bar');
  assert.equal(await o.O.autoRun(), 'auto');
  assert.ok(/^https:\/\/www\.rushuplanguage\.com\/move-in\.html#auto=RU1Z?:/.test(o.loc.replaced), o.loc.replaced);
  assert.match(o.barText(), /拍謝！我們換網址了，因為名字跟別人重疊！正在把你的進度帶過去…/);
  const a = o.L.parseAuto(o.loc.replaced.slice(o.loc.replaced.indexOf('#')));
  assert.equal(a.back, '/vocab.html?x=1');
  const r = await o.P.fromText(a.code);
  assert.ok(r.ok);
  /* 跟寄出頁「複製搬家碼」同一包:同樣的 collect、同樣的雜湊 */
  const same = o.P.collect(o.ls, { from: OLD, device: o.store.get('tr_move_device') });
  assert.equal(r.hash, await o.P.hashOf(same.pack));
  assert.equal(J(r.pack.keys), J(same.pack.keys));
  /* 舊網址:只多了裝置編號(寄出頁本來就會寫),沒有 tr_move_done,其他一個都沒變 */
  assert.deepEqual(o.writes, ['tr_move_device']);
  for (const [k, v] of before) assert.equal(o.store.get(k), v, k);
  /* 這個分頁記下送出的那一包(ack 回來時核對) */
  const memo = JSON.parse(o.sess.get('tr_move_auto'));
  assert.equal(memo.step, 'sent');
  assert.equal(memo.hash, r.hash);
  assert.equal(typeof memo.fp, 'string');
};
T['同一個分頁試過(不管成功失敗)就不再自動:顯示原本的按鈕'] = async () => {
  const o = loadOld({ ls: { tr_vgame_banks: BANKS }, session: { tr_move_auto: J({ step: 'sent', hash: 'x' }) } });
  assert.equal(await o.O.start(), 'bar');
  assert.equal(await o.O.autoRun(), 'tried');
  assert.equal(o.loc.replaced, null);
  assert.match(o.barText(), /帶我過去（進度一起搬）/);
};
T['sessionStorage 不給寫(記不住試過):不自動,免得每一頁都重來'] = async () => {
  const o = loadOld({ ls: { tr_vgame_banks: BANKS }, session: 'none' });
  await o.O.start();
  assert.notEqual(await o.O.autoRun(), 'auto');
  assert.equal(o.loc.replaced, null);
  assert.match(o.barText(), /帶我過去（進度一起搬）/);
};
T['搬家碼超過 48 KB:不自動,照舊顯示按鈕;這個分頁記下太大,下一頁不再重組'] = async () => {
  const o = loadOld({ ls: { tr_vgame_banks: BANKS, 'tr_read_q_art-1': J({ note: noise(80 * 1024) }) } });
  await o.O.start();
  assert.equal(await o.O.autoRun(), 'big');
  assert.equal(o.loc.replaced, null);
  assert.match(o.barText(), /帶我過去（進度一起搬）/);
  assert.doesNotMatch(o.barText(), /正在把你的進度帶過去/);
  assert.equal(JSON.parse(o.sess.get('tr_move_auto')).step, 'big');
};
T['LINE 內建瀏覽器、iPhone 主畫面 App:不自動,照舊顯示按鈕'] = async () => {
  for (const env of [{ ua: UA_IPHONE + ' Line/13.0.0' }, { ua: UA_IPHONE, standalone: true }]) {
    const o = loadOld(Object.assign({ ls: { tr_vgame_banks: BANKS } }, env));
    await o.O.start();
    assert.notEqual(await o.O.autoRun(), 'auto');
    assert.equal(o.loc.replaced, null);
    assert.equal(o.sess.has('tr_move_auto'), false, '沒試就不記');
  }
};
T['新網址連不上、搬過了、沒資料:不自動'] = async () => {
  const a = loadOld({ ls: { tr_vgame_banks: BANKS }, ping: 'fail' });
  assert.equal(await a.O.start(), 'stay');
  assert.notEqual(await a.O.autoRun(), 'auto');
  const b = loadOld({ ls: {} });
  assert.equal(await b.O.start(), 'go');
  assert.notEqual(await b.O.autoRun(), 'auto');
  assert.equal(b.sess.has('tr_move_auto'), false);
};
T['登入著:先 flushForMove 跟雲端對帳,帳號剩下的放進包;不能對帳(沒有 cloud.js)就不自動'] = async () => {
  const U = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
  let flushed = 0;
  const cloud = { enabled: true, ready: Promise.resolve(), user: { id: U }, flushForMove: async () => { flushed++; return { left: 1, accounts: { [U]: [['vgame_banks', BANKS, 5]] } }; } };
  const o = loadOld({ ls: { 'sb-abc-auth-token': '{}', tr_hist: HIST }, cloud });
  await o.O.start();
  assert.equal(await o.O.autoRun(), 'auto');
  assert.equal(flushed, 1);
  const r = await o.P.fromText(o.L.parseAuto(o.loc.replaced.slice(o.loc.replaced.indexOf('#'))).code);
  assert.deepEqual(Object.keys(r.pack.accounts), [U]);
  const n = loadOld({ ls: { 'sb-abc-auth-token': '{}', tr_hist: HIST } });
  await n.O.start();
  assert.equal(await n.O.autoRun(), 'noFlush');
  assert.equal(n.loc.replaced, null);
};

/* ---------- 舊網址:新網址搬好帶回來(#ack=) ---------- */
async function sentOld(ls) {
  const o = loadOld({ ls });
  await o.O.start();
  assert.equal(await o.O.autoRun(), 'auto');
  const hash = (await o.P.fromText(o.L.parseAuto(o.loc.replaced.slice(o.loc.replaced.indexOf('#'))).code)).hash;
  return { o, hash };
}
T['ack:雜湊對、送出之後沒有新的進度 → 可以寫完成記號(帶指紋)'] = async () => {
  const { o, hash } = await sentOld({ tr_vgame_banks: BANKS, tr_hist: HIST });
  const r = await o.O.ackCheck(o.ls, hash);
  assert.equal(r.ok, true);
  assert.equal(r.fp, o.win.MOVE_RULES.fingerprint(o.ls));
};
T['ack:送出之後又練習了(搬過去的不是現在這份)→ 不寫;雜湊不對、別的分頁(沒有送出紀錄)也不寫'] = async () => {
  const { o, hash } = await sentOld({ tr_vgame_banks: BANKS, tr_hist: HIST });
  assert.equal((await o.O.ackCheck(o.ls, 'f'.repeat(64))).ok, false);
  o.store.set('tr_hist', J([{ t: Date.now(), m: 'p5', id: 'new', c: 1, ok: false }].concat(JSON.parse(HIST))));
  assert.equal((await o.O.ackCheck(o.ls, hash)).ok, false);
  /* 只改了指紋不看的全域設定:包的雜湊還是不一樣,也不寫 */
  const g = await sentOld({ tr_vgame_banks: BANKS, tr_pet_hint: '1' });
  const fp0 = g.o.win.MOVE_RULES.fingerprint(g.o.ls);
  g.o.store.set('tr_pet_hint', '2');
  assert.equal(g.o.win.MOVE_RULES.fingerprint(g.o.ls), fp0, 'tr_pet_hint 不在指紋裡(這一項就是要測指紋看不到的改動)');
  assert.equal((await g.o.O.ackCheck(g.o.ls, g.hash)).ok, false);
  const other = loadOld({ ls: { tr_vgame_banks: BANKS } });
  assert.equal((await other.O.ackCheck(other.ls, hash)).ok, false);
};

/* ---------- 頁面上的接法(靜態檢查) ---------- */
T['新網址收件頁:第一件事拿掉 #auto=(在任何外部 script 之前 replaceState),再走跟貼上搬家碼同一條路'] = () => {
  const html = read('move-in.html');
  const head = html.slice(0, html.indexOf('</script>'));
  assert.ok(head.indexOf("history.replaceState") > -1 && head.indexOf('#auto=') > -1, '開頭的 script 就要拿掉 #auto=');
  assert.ok(html.indexOf('history.replaceState') < html.indexOf('<script src='), 'replaceState 要在所有外部 script 之前');
  /* 跑一次開頭那段:網址列與 history 的這一筆不再有搬家碼,搬家碼只留在記憶體 */
  const calls = [];
  const loc = { hash: '#auto=RU1Z:AAAA&back=%2Fvocab.html', pathname: '/move-in.html', search: '' };
  const ctx = { window: null, location: loc, history: { replaceState: (s, t, u) => { calls.push(u); loc.hash = ''; } }, document: { documentElement: { style: {}, classList: { add() {} } } },
    navigator: {}, matchMedia: () => ({ matches: false }) };
  ctx.window = ctx; ctx.window.top = ctx; ctx.window.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(head.slice(head.lastIndexOf('<script>') + 8), ctx);
  assert.deepEqual(calls, ['/move-in.html']);
  assert.equal(ctx.MOVE_AUTO_IN, '#auto=RU1Z:AAAA&back=%2Fvocab.html');
  const src = read('js/move-in-page.js');
  assert.ok(/MOVE_AUTO_IN/.test(src));
  assert.ok(/fromText\(auto\.code\)/.test(src), '自動搬家要走 fromText(跟貼上搬家碼同一條)');
};
T['舊網址寄出頁:開頭拿掉 #ack=;組包跟每一頁的自動搬家共用 MOVE_OUT.buildPack'] = () => {
  const html = read('move-out.html');
  assert.ok(html.indexOf('#ack=') > -1 && html.indexOf('history.replaceState') < html.indexOf('<script src='));
  const src = read('js/move-out-page.js');
  assert.ok(/OUT\.buildPack\(/.test(src), '寄出頁要用 MOVE_OUT.buildPack');
  assert.ok(/OUT\.ackCheck\(/.test(src));
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const n of names) {
    try { await T[n](); pass++; console.log('PASS ' + n); }
    catch (e) { console.log('FAIL ' + n + '  →  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e)); }
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
