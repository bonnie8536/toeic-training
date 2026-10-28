/* 舊網址自動搬家(有資料的訪客、本機學生不用按按鈕)。搬家碼不以明文進任何網址(瀏覽器的全域歷史紀錄 replaceState 清不掉):
   1. 舊網址每一頁(js/move-out.js tryAuto):只帶到新網址 move-in.html#want&back=<原路徑>,網址裡沒有任何資料;
      提示上有「等一下再搬」,使用者一有動作(點、按鍵)或模擬考進行中就不帶走,改顯示按鈕。
   2. 新網址產生這個分頁專用的一次性金鑰(私鑰只放新網址這個分頁的 sessionStorage),帶回舊網址 move-out.html#key=<公鑰>。
   3. 舊網址寄出頁(js/move-out.js autoSend):這個分頁真的開始過(sessionStorage 的 tr_move_auto 是 key)才組包,用公鑰加密,
      帶到新網址 move-in.html#auto=RU1E:<密文>;整段有總逾時,逾時、太大、按「等一下再搬」都不帶走。
   4. 新網址用私鑰解開(解開就刪私鑰),合併後帶回舊網址 move-out.html#ack=,舊網址核對雜湊才寫 tr_move_done。
   這裡測判斷、上限、特殊環境、同一個分頁不重試、加解密、ack 對不上不寫、網址的格式;無頭 Chrome 的整條路在 tools/test_move_e2e.js。
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadLink() {
  const ctx = { crypto: globalThis.crypto, Uint8Array, Array, Object, JSON, btoa, atob };
  vm.createContext(ctx);
  vm.runInContext(read('js/move-link.js'), ctx);
  return ctx.MOVE_LINK;
}

/* 舊網址的一頁:move-rules、move-merge、move-pack、move-link、move-out 都載好(一般頁面只用到 move-out 的 tryAuto,寄出頁用 autoSend);
   opt:{ ls, path, search, ping('fail' | 'slow'), ua, standalone, activated(navigator.userActivation.hasBeenActive),
     session: 'ok' | 'none'(不給寫) | 物件(分頁裡已經有的) | Map(跟別的頁面共用:同一個分頁換頁、重新整理), cloud, scale(計時器縮小的倍數,預設最多 5 毫秒) } */
function loadOld(opt) {
  const store = new Map(Object.entries(opt.ls || {}));
  const writes = [];
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), key: (i) => [...store.keys()][i] || null, get length() { return store.size; },
    setItem: (k, v) => { writes.push(k); store.set(k, String(v)); }, removeItem: (k) => { writes.push('-' + k); store.delete(k); },
  };
  const sess = opt.session instanceof Map ? opt.session : new Map(Object.entries(opt.session && typeof opt.session === 'object' ? opt.session : {}));
  const sessionStorage = opt.session === 'none'
    ? { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } }
    : { getItem: (k) => (sess.has(k) ? sess.get(k) : null), setItem: (k, v) => { sess.set(k, String(v)); }, removeItem: (k) => { sess.delete(k); } };
  const loc = { protocol: 'https:', origin: OLD, pathname: opt.path || '/grammar.html', search: opt.search || '', hash: opt.hash || '', replaced: null,
    replace(u) { loc.replaced = u; }, assign(u) { loc.assigned = u; } };
  const bars = [];
  const node = (tag) => ({ tag, attrs: {}, children: [], textContent: '', parentNode: null, on: {},
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }, remove() { this.removed = true; }, get id() { return this.attrs.id; } });
  const body = { children: [], dataset: {}, parentNode: null, insertBefore(n) { n.parentNode = body; bars.push(n); this.children.unshift(n); } };
  const textOf = (n) => (n.textContent || '') + n.children.map(textOf).join(' ');
  const winOn = {};
  const timer = (f, ms) => setTimeout(f, opt.scale ? ms / opt.scale : Math.min(ms, 5));
  const win = {
    localStorage: ls, sessionStorage, location: loc,
    addEventListener(t, f) { (winOn[t] = winOn[t] || []).push(f); },
    removeEventListener(t, f) { winOn[t] = (winOn[t] || []).filter((x) => x !== f); },
    caches: { open: async () => ({}), delete: async () => true, keys: async () => [] },
    document: { set cookie(v) { /* 記號另外測 */ }, body, head: { appendChild() {} }, visibilityState: 'visible', addEventListener() {},
      getElementById: (id) => bars.filter((b) => !b.removed && b.attrs.id === id)[0] || null, createElement: node },
    navigator: { userAgent: opt.ua || UA_PC, platform: /iPhone/.test(opt.ua || '') ? 'iPhone' : 'Win32', maxTouchPoints: 0, standalone: !!opt.standalone,
      userActivation: { hasBeenActive: !!opt.activated, isActive: false } },
    matchMedia: () => ({ matches: !!opt.standalone }),
    fetch: async () => {
      if (opt.ping === 'fail') throw new TypeError('fail');
      if (opt.ping === 'slow') await new Promise((r) => setTimeout(r, 60));   // 手機網路慢:ping 還沒回來的這段時間,使用者已經在頁面上動作
      return { ok: true, text: async () => 'rushup-move-ping 1' };
    },
    stop() { win.stopped = (win.stopped || 0) + 1; },
    setTimeout: timer, clearTimeout, AbortController, MOVE_OUT_NO_AUTO: true,
    crypto: globalThis.crypto, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream, btoa, atob,
    MOVE: { from: [OLD], to: NEW, onOld: true, onNew: false, newName: 'www.rushuplanguage.com', oldName: 'shuashualanguage.com' },
  };
  if (opt.cloud) win.CLOUD = opt.cloud;
  win.window = win;
  vm.createContext(win);
  const asWin = (src) => src.replace(/typeof globalThis !== 'undefined' \? globalThis : this/g, 'window');
  ['js/move-rules.js', 'js/move-merge.js', 'js/move-pack.js', 'js/move-link.js'].forEach((f) => vm.runInContext(asWin(read(f)), win));
  vm.runInContext(read('js/move-out.js'), win);
  const live = () => bars.filter((b) => !b.removed);
  const buttons = () => { const out = []; const walk = (n) => { if (n.tag === 'button' || n.tag === 'a') out.push(n); n.children.forEach(walk); }; live().forEach(walk); return out; };
  /* 使用者的動作:送到 window 上聽的(捕獲階段);target 預設是頁面上的東西(不是搬家提示) */
  const fire = (type, target) => (winOn[type] || []).slice().forEach((f) => f({ type, target: target || { parentNode: body } }));
  const click = (label) => {
    const b = buttons().find((x) => x.textContent === label);
    if (!b) throw new Error('找不到按鈕「' + label + '」:' + live().map(textOf).join(' | '));
    fire('click', b);
    (b.on.click || []).forEach((f) => f({ currentTarget: b, target: b }));
  };
  return { win, ls, store, writes, sess, loc, bars, body, fire, click, buttons, barText: () => live().map(textOf).join(' | '),
    O: win.MOVE_OUT, L: win.MOVE_LINK, P: win.MOVE_PACK };
}
const bank = (id, name, words) => ({ id, name, words: words.map((w) => ({ en: w, zh: '中' + w })) });
const HIST = J([{ t: Date.now() - 60000, m: 'p5', id: 'q1', c: 1, ok: true }]);
const BANKS = J([bank('b1', '我的單字', ['apple', 'banana'])]);
/* 壓不小的資料:隨機字(gzip 之後還是很大) */
function noise(n) { let s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }
/* 第一站記下的一次性號碼(js/move-out.js 的 memo n):新網址照原樣帶回 #key=,寄出頁核對 */
const N0 = '0123456789abcdef0123456789abcdef';
const KEY_MEMO = () => ({ tr_move_auto: J({ step: 'key', at: Date.now(), n: N0 }) });
const hashOfUrl = (u) => u.slice(u.indexOf('#'));
/* 第一站網址裡的一次性號碼 */
const nOf = (u) => { const w = loadLink().parseWant(hashOfUrl(String(u))); return w ? w.n : null; };

/* ---------- 網址格式(js/move-link.js) ---------- */
T['上限:整個網址 48 KB(Safari 約 8 萬字、Firefox 網址列 65536 字都放得下)'] = () => {
  const L = loadLink();
  assert.equal(L.AUTO_MAX, 48 * 1024);
};
T['autoLen:不用加密就算得出帶著密文的網址有多長(寄出頁先判斷能不能一鍵搬),跟真的加密出來的一樣長'] = async () => {
  const L = loadLink();
  const k = await L.newKey();
  for (const code of ['RU1Z:H4sIAAAAAAAAAwMAAAAAAAAAAAA=', 'RU1:eyJwYWNrIjp7fX0=', 'RU1:eyJwYWNrIjp7fX0', 'RU1Z:' + Buffer.from(noise(5000)).toString('base64')]) {
    for (const back of ['/', '/vocab.html?x=1']) {
      assert.equal(L.autoLen(NEW, code, back), L.autoUrl(NEW, await L.seal(k.pub, code), back).length, code.slice(0, 12) + ' ' + back);
    }
  }
  assert.equal(L.autoLen(NEW, 'not a code', '/'), Infinity);
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
T['#want、#key=、#auto=、#ack= 的格式:組出來的解得回去;格式不對回 null;明文的搬家碼(RU1Z:、RU1:)放在 #auto= 一律不收'] = async () => {
  const L = loadLink();
  const w = L.wantUrl(NEW, '/vocab.html?x=1', N0);
  assert.equal(w, NEW + '/move-in.html#want&n=' + N0 + '&back=' + encodeURIComponent('/vocab.html?x=1'));
  assert.deepEqual(JSON.parse(J(L.parseWant(hashOfUrl(w)))), { back: '/vocab.html?x=1', n: N0 });
  assert.equal(L.parseWant('#want').back, '/');
  assert.equal(L.parseWant('#want').n, null, '沒有號碼:新網址不給金鑰,直接回原頁面');
  assert.equal(L.parseWant('#want&n=xyz&back=%2F'), null, '號碼格式不對');
  assert.equal(L.parseWant('#want&back=' + encodeURIComponent('//evil.example')).back, '/');
  assert.equal(L.parseWant('#wantx'), null);
  const k = await L.newKey();
  assert.match(k.pub, /^[A-Za-z0-9_-]{87}$/);
  const ku = L.keyUrl(OLD, k.pub, '/grammar.html', N0);
  assert.equal(ku, OLD + '/move-out.html#key=' + k.pub + '&n=' + N0 + '&back=' + encodeURIComponent('/grammar.html'));
  assert.deepEqual(JSON.parse(J(L.parseKey(hashOfUrl(ku)))), { pub: k.pub, n: N0, back: '/grammar.html' });
  assert.equal(L.parseKey('#key=abc'), null);
  assert.equal(L.parseKey('#key=' + k.pub + '&n=ZZ&back=%2F'), null, '號碼格式不對');
  assert.equal(L.parseKey('#key=' + k.pub + '&back=%2F').n, null, '沒有號碼:寄出頁一定對不上');
  const sealed = await L.seal(k.pub, 'RU1Z:H4sIAAAAAAAAAwMAAAAAAAAAAAA=');
  const u = L.autoUrl(NEW, sealed, '/vocab.html?x=1');
  assert.equal(u.indexOf(NEW + '/move-in.html#auto=RU1E:'), 0);
  assert.deepEqual(JSON.parse(J(L.parseAuto(hashOfUrl(u)))), { code: sealed, back: '/vocab.html?x=1' });
  assert.equal(L.parseAuto('#auto=' + sealed).back, '/');
  assert.equal(L.parseAuto('#auto=RU1Z:H4sIAAAAAAAAA+3/AAAA=='), null, '明文的搬家碼不收');
  assert.equal(L.parseAuto('#auto=RU1:eyJwYWNrIjp7fX0='), null, '明文的搬家碼不收');
  assert.throws(() => L.autoUrl(NEW, 'RU1Z:H4sIAAAA', '/'), /明文/);
  assert.equal(L.parseAuto('#auto=<script>'), null);
  assert.equal(L.parseAuto('#foo'), null);
  assert.equal(L.parseAuto(''), null);
  const h = 'a'.repeat(64);
  const a = L.ackUrl(OLD, h, '/grammar.html');
  assert.equal(a, OLD + '/move-out.html#ack=' + h + '&back=' + encodeURIComponent('/grammar.html'));
  assert.deepEqual(JSON.parse(J(L.parseAck(hashOfUrl(a)))), { hash: h, back: '/grammar.html' });
  assert.equal(L.parseAck('#ack=xyz'), null);
  assert.equal(L.parseAck('#ack=' + h + '&back=%E0%A4%A'), null, '解不開的 back');
};
T['加密:用新網址的公鑰封起來,只有那把私鑰解得開;密文裡看不到搬家碼;改一個字就解不開'] = async () => {
  const L = loadLink();
  const P = loadOld({}).P;
  const pack = { app: 'rushup-move', v: 1, keys: [['tr_vgame_banks', J([bank('s1', '私房題庫', ['secretword'])])]], accounts: {} };
  for (const noGzip of [false, true]) {
    const code = await P.toCode(pack, await P.hashOf(pack), noGzip);
    const k = await L.newKey(), other = await L.newKey();
    const sealed = await L.seal(k.pub, code);
    assert.match(sealed, /^RU1E:[A-Za-z0-9_-]{87}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    assert.equal(sealed.indexOf(code.slice(5, 40)), -1, '密文裡不能有搬家碼的明文');
    assert.equal(await L.open(k.jwk, sealed), code);
    await assert.rejects(L.open(other.jwk, sealed));   // 別的金鑰解不開
    const bad = sealed.slice(0, -3) + (sealed.slice(-3, -2) === 'A' ? 'B' : 'A') + sealed.slice(-2);
    await assert.rejects(L.open(k.jwk, bad));   // 被改過的解不開
  }
  await assert.rejects(L.seal('x'.repeat(10), 'RU1Z:AAAA'), /公鑰/);
  await assert.rejects(L.seal((await L.newKey()).pub, 'not a code'), /不是搬家碼/);
};

/* ---------- 舊網址每一頁:要不要自動 ---------- */
T['判斷:只有 bar、ask 才自動;付款結果頁、主畫面 App、這個分頁試過、按過等一下再搬的都不自動;LINE/FB/IG 內建瀏覽器、登入著也自動'] = () => {
  const { O } = loadOld({});
  const base = { kind: 'bar', page: 'grammar.html', inApp: false, standalone: false, tried: false, later: false };
  const b = (o) => O.autoBlock(Object.assign({}, base, o));
  assert.equal(b({}), '');
  assert.equal(b({ kind: 'ask', page: 'pricing.html' }), '');
  for (const k of ['go', 'login', 'offline', 'stay']) assert.notEqual(b({ kind: k }), '', k);
  assert.notEqual(b({ kind: 'ask', page: 'pay-result.html' }), '');
  assert.equal(b({ inApp: true }), '', 'LINE 內建瀏覽器也自動(同一個分頁換頁,不用開新視窗)');
  assert.notEqual(b({ standalone: true }), '');
  assert.notEqual(b({ tried: true }), '');
  assert.notEqual(b({ later: true }), '');
  assert.equal(b({ loggedIn: true }), '', '登入著也自動:寄出頁(move-out.html)一定有 cloud.js 可以對帳');
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

/* ---------- 舊網址每一頁:第一站只帶到新網址拿金鑰,網址裡沒有任何資料 ---------- */
T['有題庫的訪客:先顯示「正在把你的進度帶過去」與「等一下再搬」,再帶到新網址 move-in.html#want&back=<原路徑>;網址裡沒有資料,舊網址一筆都沒寫'] = async () => {
  const o = loadOld({ ls: { tr_vgame_banks: BANKS, tr_hist: HIST }, path: '/vocab.html', search: '?x=1', scale: 50 });
  const before = new Map(o.store);
  assert.equal(await o.O.start(), 'bar');
  assert.match(o.barText(), /拍謝！我們換網址了，因為名字跟別人重疊！正在把你的進度帶過去…/);
  assert.deepEqual(o.buttons().map((b) => b.textContent), ['等一下再搬']);
  assert.equal(o.sess.has('tr_move_auto'), false, '倒數中還沒記「這個分頁試過」(中途重新整理還會再試)');
  assert.equal(o.loc.replaced, null, '要等一下,讓人有時間按「等一下再搬」');
  assert.equal(await o.O.autoRun(), 'auto');
  assert.equal(o.loc.replaced, NEW + '/move-in.html#want&n=' + nOf(o.loc.replaced) + '&back=' + encodeURIComponent('/vocab.html?x=1'));
  assert.match(nOf(o.loc.replaced) || '', /^[0-9a-f]{32}$/);
  assert.equal(/RU1|auto=|apple|%E6/.test(o.loc.replaced), false, '網址裡不能有資料');
  assert.deepEqual(o.writes, []);
  for (const [k, v] of before) assert.equal(o.store.get(k), v, k);
  assert.equal(JSON.parse(o.sess.get('tr_move_auto')).step, 'key');
};
T['按「等一下再搬」:不帶走,這個分頁不再提示也不再自動'] = async () => {
  const o = loadOld({ ls: { tr_vgame_banks: BANKS }, scale: 50 });
  assert.equal(await o.O.start(), 'bar');
  o.click('等一下再搬');
  assert.equal(await o.O.autoRun(), 'later');
  await sleep(120);
  assert.equal(o.loc.replaced, null);
  assert.equal(o.sess.get('tr_move_later'), '1');
  assert.equal(o.barText(), '', '提示拿掉,也不畫按鈕');
};
T['自動搬家的提示蓋在「你是哪位？」建檔視窗(.modal-mask,z-index 200)上面、捲動也看得到:「等一下再搬」一定按得到'] = async () => {
  const o = loadOld({ ls: { tr_vgame_banks: BANKS }, scale: 50 });
  assert.equal(await o.O.start(), 'bar');
  const style = o.bars[0].attrs.style;
  const z = Number((/z-index:\s*(\d+)/.exec(style) || [])[1]);
  assert.ok(z > 200, '提示的 z-index 要大於建檔視窗的 200:' + style);
  assert.match(style, /position:\s*sticky/, '自動搬家倒數時黏在頁面頂端');
  assert.match(style, /top:\s*0/);
  o.click('等一下再搬');
  await o.O.autoRun();
  /* 沒有自動時的按鈕提示也要在建檔視窗上面(有資料、還沒選學生的訪客,一打開就是建檔視窗) */
  const p = loadOld({ ls: { tr_vgame_banks: BANKS }, session: { tr_move_auto: J({ step: 'busy' }) } });
  await p.O.start();
  await p.O.autoRun();
  const z2 = Number((/z-index:\s*(\d+)/.exec(p.bars[0].attrs.style) || [])[1]);
  assert.ok(z2 > 200, '按鈕提示的 z-index 也要大於 200');
};
T['使用者在頁面上有動作(點、按鍵、手指碰到、按下滑鼠):不帶走,改顯示按鈕(作答到一半不會被整頁帶走)'] = async () => {
  for (const type of ['click', 'keydown', 'pointerdown', 'touchstart']) {
    const o = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/mock.html', scale: 50 });
    assert.equal(await o.O.start(), 'bar');
    o.fire(type);
    assert.equal(await o.O.autoRun(), 'busy', type);
    await sleep(120);
    assert.equal(o.loc.replaced, null, type);
    assert.match(o.barText(), /帶我過去（進度一起搬）/, type);
    assert.doesNotMatch(o.barText(), /正在把你的進度帶過去/, type);
    assert.equal(JSON.parse(o.sess.get('tr_move_auto')).step, 'busy', '這個分頁不再自動');
  }
};
T['模擬考進行中(body 的 data-leave-confirm):時間到也不帶走,改顯示按鈕'] = async () => {
  const o = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/mock.html', scale: 50 });
  assert.equal(await o.O.start(), 'bar');
  o.body.dataset.leaveConfirm = '模擬考還沒交卷';
  assert.equal(await o.O.autoRun(), 'busy');
  assert.equal(o.loc.replaced, null);
  assert.match(o.barText(), /帶我過去（進度一起搬）/);
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
  assert.doesNotMatch(o.barText(), /正在把你的進度帶過去/, '記不住就不倒數(不會每一頁倒數完才變成按鈕)');
  assert.notEqual(await o.O.autoRun(), 'auto');
  assert.equal(o.loc.replaced, null);
  assert.match(o.barText(), /帶我過去（進度一起搬）/);
};
T['LINE 內建瀏覽器也自動(同一個分頁換頁);iPhone 主畫面 App 照舊顯示按鈕'] = async () => {
  const l = loadOld({ ls: { tr_vgame_banks: BANKS }, ua: UA_IPHONE + ' Line/13.0.0' });
  await l.O.start();
  assert.equal(await l.O.autoRun(), 'auto');
  assert.equal(l.loc.replaced.indexOf(NEW + '/move-in.html#want'), 0);
  const a = loadOld({ ls: { tr_vgame_banks: BANKS }, ua: UA_IPHONE, standalone: true });
  await a.O.start();
  assert.equal(await a.O.autoRun(), 'app');
  assert.equal(a.loc.replaced, null);
  assert.equal(a.sess.has('tr_move_auto'), false, '沒試就不記');
};
T['LINE 內建瀏覽器沒有自動(這個分頁試過、作答中):提示的主按鈕一鍵在同一個分頁搬(不開新視窗);太大才說用搬家碼'] = async () => {
  /* 試過但不是太大(作答中、出錯):按一下就走自動搬家同一條路(第一站 #want,網址裡沒有資料) */
  const l = loadOld({ ls: { tr_vgame_banks: BANKS }, ua: UA_IPHONE + ' Line/13.0.0', path: '/vocab.html', search: '?x=1', session: { tr_move_auto: J({ step: 'busy' }) } });
  await l.O.start();
  assert.equal(await l.O.autoRun(), 'tried');
  assert.match(l.barText(), /我幫你一起帶過去/);
  const btn = l.buttons().find((b) => b.textContent === '帶我過去（進度一起搬）');
  assert.ok(btn && !btn.attrs.href, 'LINE 裡的主按鈕不是去寄出頁的連結(寄出頁的「送到新網址」要開新視窗)');
  l.click('帶我過去（進度一起搬）');
  assert.equal(l.loc.replaced, NEW + '/move-in.html#want&n=' + nOf(l.loc.replaced) + '&back=' + encodeURIComponent('/vocab.html?x=1'));
  assert.equal(JSON.parse(l.sess.get('tr_move_auto')).step, 'key', '寄出頁那一站認得是這個分頁開始的');
  /* 太大:網址裝不下,只能用搬家碼 */
  const b = loadOld({ ls: { tr_vgame_banks: BANKS }, ua: UA_IPHONE + ' Line/13.0.0', session: { tr_move_auto: J({ step: 'big' }) } });
  await b.O.start();
  await b.O.autoRun();
  assert.doesNotMatch(b.barText(), /我幫你一起帶過去/);
  assert.match(b.barText(), /搬家碼/);
  assert.equal(b.buttons().find((x) => x.textContent === '帶我過去（進度一起搬）').attrs.href, 'move-out.html');
  /* LINE 裡記不住這個分頁開始了(sessionStorage 不給寫):改去寄出頁 */
  const n = loadOld({ ls: { tr_vgame_banks: BANKS }, ua: UA_IPHONE + ' Line/13.0.0', session: 'none' });
  await n.O.start();
  await n.O.autoRun();
  n.click('帶我過去（進度一起搬）');
  assert.equal(n.loc.replaced, null);
  assert.equal(n.loc.assigned, 'move-out.html');
  /* 一般瀏覽器照舊:去寄出頁(有「送到新網址」) */
  const p = loadOld({ ls: { tr_vgame_banks: BANKS }, session: { tr_move_auto: J({ step: 'big' }) } });
  await p.O.start();
  await p.O.autoRun();
  assert.match(p.barText(), /我幫你一起帶過去/, '一般瀏覽器照舊(寄出頁有「送到新網址」)');
  assert.equal(p.buttons().find((x) => x.textContent === '帶我過去（進度一起搬）').attrs.href, 'move-out.html');
};
T['跟雲端對帳(flushForMove)一直不回:flushAccounts 有逾時,回 {}(改用這台的帳本),寄出頁的「準備搬家」不會一直掛著'] = async () => {
  const U = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
  const cloud = { enabled: true, ready: Promise.resolve(), user: { id: U }, flushForMove: () => new Promise(() => {}) };
  const o = loadOld({ ls: { 'sb-abc-auth-token': '{}', tr_hist: HIST }, cloud, scale: 100 });
  const r = await Promise.race([o.O.flushAccounts(), sleep(1500).then(() => 'hang')]);
  assert.deepEqual(J(r), J({}));
};
T['登入著、沒有要搬的:按「前往新網址」對帳卡住,逾時就去搬家頁,不會一直停在「正在確認進度…」'] = async () => {
  const U = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
  const cloud = { enabled: true, ready: Promise.resolve(), user: { id: U }, flushForMove: () => new Promise(() => {}) };
  const o = loadOld({ ls: { 'sb-abc-auth-token': '{}' }, cloud, scale: 100 });
  assert.equal(await o.O.start(), 'login');
  o.click('前往新網址');
  for (let i = 0; i < 30 && !o.loc.assigned; i++) await sleep(50);
  assert.equal(o.loc.assigned, 'move-out.html');
  assert.equal(o.loc.replaced, null);
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

/* ---------- 舊網址寄出頁 move-out.html#key=:組包、加密、帶到新網址 ---------- */
async function keyed(opt) {
  const o = loadOld(Object.assign({ path: '/move-out.html', session: KEY_MEMO(), scale: 20 }, opt));
  const k = await o.L.newKey();
  return { o, k };
}
T['寄出頁拿到公鑰:組好跟「複製搬家碼」同一包、加密,帶到新網址 move-in.html#auto=RU1E:<密文>&back=;網址裡沒有明文;舊網址只多裝置編號'] = async () => {
  const { o, k } = await keyed({ ls: { tr_vgame_banks: BANKS, tr_hist: HIST } });
  const before = new Map(o.store);
  assert.equal(await o.O.autoSend({ pub: k.pub, n: N0, back: '/vocab.html?x=1', cancelled: () => false }), 'auto');
  assert.ok(/^https:\/\/www\.rushuplanguage\.com\/move-in\.html#auto=RU1E:/.test(o.loc.replaced), o.loc.replaced);
  assert.equal(/RU1Z?:|apple|banana/.test(o.loc.replaced.replace('#auto=RU1E:', '')), false, '網址裡不能有明文');
  const a = o.L.parseAuto(hashOfUrl(o.loc.replaced));
  assert.equal(a.back, '/vocab.html?x=1');
  const r = await o.P.fromText(await o.L.open(k.jwk, a.code));
  assert.ok(r.ok);
  const same = o.P.collect(o.ls, { from: OLD, device: o.store.get('tr_move_device') });
  assert.equal(r.hash, await o.P.hashOf(same.pack));
  assert.equal(J(r.pack.keys), J(same.pack.keys));
  assert.deepEqual(o.writes, ['tr_move_device']);
  for (const [kk, v] of before) assert.equal(o.store.get(kk), v, kk);
  const memo = JSON.parse(o.sess.get('tr_move_auto'));
  assert.equal(memo.step, 'sent');
  assert.equal(memo.hash, r.hash);
  assert.equal(typeof memo.fp, 'string');
};
T['寄出頁拿到公鑰,但這個分頁沒有開始過自動搬家(別人做的連結、過太久):什麼都不組、不帶走'] = async () => {
  for (const session of [{}, { tr_move_auto: J({ step: 'key', at: Date.now() - 3600e3 }) }, { tr_move_auto: J({ step: 'sent', at: Date.now() }) }]) {
    const { o, k } = await keyed({ ls: { tr_vgame_banks: BANKS }, session });
    assert.equal(await o.O.autoSend({ pub: k.pub, n: N0, back: '/', cancelled: () => false }), 'memo');
    assert.equal(o.loc.replaced, null);
    assert.deepEqual(o.writes, []);
  }
};
T['寄出頁:搬家碼加密後超過 48 KB 不帶走,這個分頁記下太大'] = async () => {
  const { o, k } = await keyed({ ls: { tr_vgame_banks: BANKS, 'tr_read_q_art-1': J({ note: noise(80 * 1024) }) } });
  assert.equal(await o.O.autoSend({ pub: k.pub, n: N0, back: '/', cancelled: () => false }), 'big');
  assert.equal(o.loc.replaced, null);
  assert.equal(JSON.parse(o.sess.get('tr_move_auto')).step, 'big');
};
T['寄出頁:登入著先 flushForMove 跟雲端對帳,帳號剩下的放進包'] = async () => {
  const U = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
  let flushed = 0;
  const cloud = { enabled: true, ready: Promise.resolve(), user: { id: U }, flushForMove: async () => { flushed++; return { left: 1, accounts: { [U]: [['vgame_banks', BANKS, 5]] } }; } };
  const { o, k } = await keyed({ ls: { 'sb-abc-auth-token': '{}', tr_hist: HIST }, cloud });
  assert.equal(await o.O.autoSend({ pub: k.pub, n: N0, back: '/', cancelled: () => false }), 'auto');
  assert.equal(flushed, 1);
  const r = await o.P.fromText(await o.L.open(k.jwk, o.L.parseAuto(hashOfUrl(o.loc.replaced)).code));
  assert.deepEqual(Object.keys(r.pack.accounts), [U]);
};
T['寄出頁:跟雲端對帳卡住(請求一直不回)有總逾時,不會一直掛著;晚到的結果也不會再把頁面帶走'] = async () => {
  const U = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
  let release = null;
  const stuck = new Promise((r) => { release = r; });
  /* 一:CLOUD.ready 早就好了,flushForMove 的請求卡住 */
  const cloud = { enabled: true, ready: Promise.resolve(), user: { id: U }, flushForMove: () => stuck };
  const { o, k } = await keyed({ ls: { 'sb-abc-auth-token': '{}', tr_hist: HIST }, cloud, scale: 100 });
  const t0 = Date.now();
  assert.equal(await o.O.autoSend({ pub: k.pub, n: N0, back: '/', cancelled: () => false }), 'timeout');
  assert.ok(Date.now() - t0 < 2000, '總逾時(縮小 100 倍)');
  assert.equal(JSON.parse(o.sess.get('tr_move_auto')).step, 'timeout');
  release({ left: 0, accounts: {} });
  await sleep(100);
  assert.equal(o.loc.replaced, null, '晚到的結果不能把頁面帶走');
  /* 二:CLOUD.ready 永遠不好(登入著、雲端一開始就卡住) */
  const never = { enabled: true, ready: new Promise(() => {}), user: { id: U }, flushForMove: () => new Promise(() => {}) };
  const b = await keyed({ ls: { 'sb-abc-auth-token': '{}', tr_hist: HIST }, cloud: never, scale: 100 });
  assert.equal(await b.o.O.autoSend({ pub: b.k.pub, n: N0, back: '/', cancelled: () => false }), 'timeout');
  assert.equal(b.o.loc.replaced, null);
};
T['寄出頁:按了「等一下再搬」就不帶走'] = async () => {
  const { o, k } = await keyed({ ls: { tr_vgame_banks: BANKS } });
  assert.equal(await o.O.autoSend({ pub: k.pub, n: N0, back: '/', cancelled: () => true }), 'later');
  assert.equal(o.loc.replaced, null);
  o.O.skipAuto();
  assert.equal(o.sess.get('tr_move_later'), '1');
  assert.equal(JSON.parse(o.sess.get('tr_move_auto')).step, 'later');
};

/* 雲端帳號的資料夾(cloud.js 的 tr_u<pid>_):帳本沒記的題庫只有 flushForMove 的對帳會帶走 */
const UID = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
const CPID = 'c' + UID.replace(/-/g, '');
T['寄出頁(自動搬家):登入著、雲端超過 8 秒還沒好(CLOUD.user 還是 null):不改用帳本組包,記下逾時、回原頁面給按鈕;晚好的雲端也不帶走'] = async () => {
  let flushed = 0, ready = null;
  const cloud = { enabled: true, user: null, ready: new Promise((r) => { ready = r; }),
    flushForMove: async () => { flushed++; return { left: 1, accounts: { [UID]: [['vgame_banks', BANKS, 5]] } }; } };
  const ls = { 'sb-abc-auth-token': '{}', tr_current_profile: J(CPID), tr_hist: HIST, ['tr_u' + CPID + '_vgame_banks']: BANKS };
  const { o, k } = await keyed({ ls, cloud, scale: 100 });
  /* 手機網路慢:supabase-js 加換登入憑證 9 秒(縮小 100 倍:90 毫秒)才好;等雲端最多 8 秒(80 毫秒) */
  setTimeout(() => { cloud.user = { id: UID }; ready(cloud.user); }, 90);
  assert.equal(await o.O.autoSend({ pub: k.pub, n: N0, back: '/', cancelled: () => false }), 'timeout');
  assert.equal(flushed, 0, '沒跟雲端對帳');
  assert.equal(o.loc.replaced, null, '沒對帳就不帶走');
  assert.equal(JSON.parse(o.sess.get('tr_move_auto')).step, 'timeout');
  await sleep(300);
  assert.equal(o.loc.replaced, null, '晚好的雲端也不帶走');
  /* 雲端好了、但沒有登入的帳號(這台有登入資料,卻確認不了):一樣不改用帳本 */
  const none = { enabled: true, user: null, ready: Promise.resolve(null), flushForMove: async () => { flushed++; return { left: 0, accounts: {} }; } };
  const b = await keyed({ ls, cloud: none, scale: 100 });
  assert.equal(await b.o.O.autoSend({ pub: b.k.pub, n: N0, back: '/', cancelled: () => false }), 'timeout');
  assert.equal(b.o.loc.replaced, null);
  /* 沒登入的訪客:雲端慢不影響,照常用這台的資料搬 */
  const slow = { enabled: true, user: null, ready: new Promise(() => {}), flushForMove: async () => ({ left: 0, accounts: {} }) };
  const g = await keyed({ ls: { tr_hist: HIST, tr_vgame_banks: BANKS }, cloud: slow, scale: 100 });
  assert.equal(await g.o.O.autoSend({ pub: g.k.pub, n: N0, back: '/', cancelled: () => false }), 'auto');
  /* 按鈕搬家(寄出頁的「準備搬家」)照舊:對帳不了就用這台的帳本 */
  const p = loadOld({ ls, cloud: { enabled: true, user: null, ready: new Promise(() => {}) }, path: '/move-out.html', scale: 100 });
  assert.deepEqual(J(await p.O.flushAccounts()), J({}));
};
T['寄出頁(自動搬家):雲端在 8 秒內好了就照常對帳,帳號只在這台的題庫放進包'] = async () => {
  let flushed = 0, ready = null;
  const cloud = { enabled: true, user: null, ready: new Promise((r) => { ready = r; }),
    flushForMove: async () => { flushed++; return { left: 1, accounts: { [UID]: [['vgame_banks', BANKS, 5]] } }; } };
  const ls = { 'sb-abc-auth-token': '{}', tr_current_profile: J(CPID), tr_hist: HIST, ['tr_u' + CPID + '_vgame_banks']: BANKS };
  const { o, k } = await keyed({ ls, cloud, scale: 100 });
  setTimeout(() => { cloud.user = { id: UID }; ready(cloud.user); }, 20);
  assert.equal(await o.O.autoSend({ pub: k.pub, n: N0, back: '/', cancelled: () => false }), 'auto');
  assert.equal(flushed, 1);
  const r = await o.P.fromText(await o.L.open(k.jwk, o.L.parseAuto(hashOfUrl(o.loc.replaced)).code));
  assert.deepEqual(Object.keys(r.pack.accounts), [UID]);
};
T['登入著(新分頁):倒數到期時 cloud.js 還在第一次灌雲端資料,等它好了才帶走;灌完要重載就不帶走、不記試過(重載之後照樣自動)'] = async () => {
  let ready = null;
  const cloud = { enabled: true, user: null, reloading: false, ready: new Promise((r) => { ready = r; }) };
  const ls = { 'sb-abc-auth-token': '{}', tr_current_profile: J(CPID), tr_hist: HIST };
  const o = loadOld({ ls, path: '/vocab.html', cloud, scale: 50 });
  assert.equal(await o.O.start(), 'bar');
  await sleep(120);   // 倒數 2.5 秒(縮小 50 倍:50 毫秒)已經到期
  assert.equal(o.loc.replaced, null, '灌資料還沒好,不帶走(它最後的重載會把換頁取消掉)');
  assert.equal(o.sess.has('tr_move_auto'), false);
  assert.match(o.barText(), /正在把你的進度帶過去/, '還在等,提示與「等一下再搬」照樣在');
  cloud.user = { id: UID }; cloud.reloading = true; ready(cloud.user);
  const r = await o.O.autoRun();
  assert.notEqual(r, 'auto');
  assert.equal(o.loc.replaced, null, '要重載了:不帶走');
  assert.equal(o.sess.has('tr_move_auto'), false, '不記試過:重載之後照樣自動');
  /* 重載之後(這個分頁灌過資料,cloud.js 很快就好、不再重載):照常帶走 */
  const again = { enabled: true, user: { id: UID }, reloading: false, ready: Promise.resolve({ id: UID }) };
  const p = loadOld({ ls, path: '/vocab.html', cloud: again, session: o.sess, scale: 50 });
  assert.equal(await p.O.start(), 'bar');
  assert.equal(await p.O.autoRun(), 'auto');
  assert.equal(p.loc.replaced.indexOf(NEW + '/move-in.html#want&n='), 0);
  /* 灌資料晚一點好了、不用重載:等到才帶走 */
  let ready2 = null;
  const late = { enabled: true, user: null, reloading: false, ready: new Promise((r) => { ready2 = r; }) };
  const q = loadOld({ ls, path: '/vocab.html', cloud: late, scale: 50 });
  await q.O.start();
  await sleep(100);
  assert.equal(q.loc.replaced, null);
  ready2(null);
  assert.equal(await q.O.autoRun(), 'auto');
  /* 雲端一直沒好(超過 8 秒):不帶走,改顯示按鈕 */
  const never = { enabled: true, user: null, reloading: false, ready: new Promise(() => {}) };
  const s = loadOld({ ls, path: '/vocab.html', cloud: never, scale: 50 });
  await s.O.start();
  assert.notEqual(await s.O.autoRun(), 'auto');
  assert.equal(s.loc.replaced, null);
  assert.match(s.barText(), /帶我過去（進度一起搬）/);
  /* 訪客(沒有登入資料、不是雲端帳號的資料夾):不等雲端,照常帶走 */
  const g = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/vocab.html', cloud: { enabled: true, user: null, reloading: false, ready: new Promise(() => {}) }, scale: 50 });
  await g.O.start();
  assert.equal(await g.O.autoRun(), 'auto');
};
T['倒數到期、正在換到新網址時在頁面上有動作(作答、按鍵、捲動):照樣停下來、不帶走,改顯示按鈕;停不下來的話寄出頁那一站也不組包、回原頁面'] = async () => {
  for (const type of ['click', 'keydown', 'pointerdown', 'touchstart', 'wheel']) {
    const sess = new Map();
    const o = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/writing.html', session: sess, scale: 20 });
    await o.O.start();
    assert.equal(await o.O.autoRun(), 'auto', type);
    const n = nOf(o.loc.replaced);
    o.fire(type);
    assert.equal(o.win.stopped, 1, type + ':停止換頁(window.stop)');
    assert.equal(JSON.parse(sess.get('tr_move_auto')).step, 'busy', type);
    assert.doesNotMatch(o.barText(), /正在把你的進度帶過去/, type);
    assert.match(o.barText(), /帶我過去（進度一起搬）/, type + ':改顯示按鈕');
    o.fire(type);
    assert.equal(o.win.stopped, 1, type + ':只停一次');
    /* 新網址已經回應、停不下來:寄出頁不組包、不帶到 #auto= */
    const k = await o.L.newKey();
    const out = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/move-out.html', session: sess, scale: 20 });
    assert.equal(await out.O.autoSend({ pub: k.pub, n, back: '/writing.html', cancelled: () => false }), 'cancel', type);
    assert.equal(out.loc.replaced, null, type);
    assert.deepEqual(out.writes, [], type);
  }
};
T['寄出頁收到 #ack= 時等雲端有上限(CLOUD.ready 一直不好也不會卡在「正在檢查這台的資料…」)'] = async () => {
  const o = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/move-out.html', cloud: { enabled: true, user: null, ready: new Promise(() => {}) }, scale: 100 });
  assert.equal(typeof o.O.waitCloud, 'function');
  const t0 = Date.now();
  assert.equal(await o.O.waitCloud(), false, '逾時回 false');
  assert.ok(Date.now() - t0 < 1000);
  const ok = loadOld({ ls: {}, path: '/move-out.html', cloud: { enabled: true, user: null, ready: Promise.resolve(null) }, scale: 100 });
  assert.equal(await ok.O.waitCloud(), true);
  const src = read('js/move-out-page.js');
  const ack = src.indexOf('await takeAck()');
  assert.ok(ack > -1);
  const before = src.slice(src.indexOf('async function start()'), ack);
  assert.match(before, /OUT\.waitCloud\(/, '核對 ack 之前等雲端要有上限');
  assert.doesNotMatch(before, /await CLOUD\.ready/, '核對 ack 之前不能沒有上限地等 CLOUD.ready');
};
T['新網址收件頁:自動搬家對時(move-ping.txt)有逾時,不會停在「正在把舊網址的進度搬進來…」'] = () => {
  const src = read('js/move-in-page.js');
  const fn = src.slice(src.indexOf('async function clockOk()'), src.indexOf('/* ---------- 進來的那一包'));
  assert.match(fn, /AbortController/, '對時要能中止');
  assert.match(fn, /setTimeout\(/, '對時要有逾時');
};

/* ---------- 舊網址:新網址搬好帶回來(#ack=) ---------- */
async function sentOld(ls) {
  const { o, k } = await keyed({ ls });
  assert.equal(await o.O.autoSend({ pub: k.pub, n: N0, back: '/', cancelled: () => false }), 'auto');
  const hash = (await o.P.fromText(await o.L.open(k.jwk, o.L.parseAuto(hashOfUrl(o.loc.replaced)).code))).hash;
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


/* ---------- 審查第二輪(10/28):公鑰綁這個分頁、倒數中重新整理、ping 之前的動作、換頁中的取消、LINE 裡沒搬成 ---------- */
T['第一站:帶到新網址時附上這個分頁的一次性號碼 n(32 位十六進位),同一個號碼記在這個分頁的 tr_move_auto;每次都不一樣;LINE 一鍵也一樣'] = async () => {
  const a = loadOld({ ls: { tr_vgame_banks: BANKS }, scale: 50 });
  await a.O.start();
  assert.equal(await a.O.autoRun(), 'auto');
  const n = nOf(a.loc.replaced);
  assert.match(n || '', /^[0-9a-f]{32}$/);
  assert.equal(JSON.parse(a.sess.get('tr_move_auto')).n, n);
  const b = loadOld({ ls: { tr_vgame_banks: BANKS }, scale: 50 });
  await b.O.start();
  await b.O.autoRun();
  assert.notEqual(nOf(b.loc.replaced), n);
  const l = loadOld({ ls: { tr_vgame_banks: BANKS }, ua: UA_IPHONE + ' Line/13.0.0', session: { tr_move_auto: J({ step: 'busy' }) } });
  await l.O.start();
  await l.O.autoRun();
  l.click('帶我過去（進度一起搬）');
  assert.match(nOf(l.loc.replaced) || '', /^[0-9a-f]{32}$/);
  assert.equal(JSON.parse(l.sess.get('tr_move_auto')).n, nOf(l.loc.replaced));
};
T['別的網站先開舊網址一頁、再把那個視窗導到 move-out.html#key=<自己的公鑰>:號碼對不上就不組包、不加密、不帶走(歷史紀錄裡不會有它解得開的密文);號碼只能用一次'] = async () => {
  const sess = new Map();
  const ls = { tr_vgame_banks: J([bank('s1', '私房題庫', ['secretword'])]), tr_hist: HIST };
  const page = loadOld({ ls, session: sess, scale: 50 });
  await page.O.start();
  assert.equal(await page.O.autoRun(), 'auto');   // 第一站已經記下 key 與號碼
  const n = nOf(page.loc.replaced);
  assert.match(n || '', /^[0-9a-f]{32}$/);
  const attacker = await page.L.newKey();
  for (const bad of [undefined, null, '', 'f'.repeat(32), n.toUpperCase(), n + '0']) {
    const out = loadOld({ ls, path: '/move-out.html', session: sess, scale: 20 });
    assert.equal(await out.O.autoSend({ pub: attacker.pub, n: bad, back: '/', cancelled: () => false }), 'memo', String(bad));
    assert.equal(out.loc.replaced, null, String(bad));
    assert.deepEqual(out.writes, [], String(bad));
    assert.equal(JSON.parse(sess.get('tr_move_auto')).step, 'key', '對不上不動這個分頁的紀錄');
  }
  /* 新網址照原樣帶回號碼:照常加密、帶走 */
  const k = await page.L.newKey();
  const ok = loadOld({ ls, path: '/move-out.html', session: sess, scale: 20 });
  assert.equal(await ok.O.autoSend({ pub: k.pub, n, back: '/', cancelled: () => false }), 'auto');
  assert.ok(/#auto=RU1E:/.test(ok.loc.replaced));
  const again = loadOld({ ls, path: '/move-out.html', session: sess, scale: 20 });
  assert.equal(await again.O.autoSend({ pub: attacker.pub, n, back: '/', cancelled: () => false }), 'memo', '同一個號碼不能再用');
  assert.equal(again.loc.replaced, null);
};
T['倒數中重新整理(登入著 cloud.js 第一次灌完雲端資料會重載):重載之後照樣自動;真的帶走那一刻才記「這個分頁試過」'] = async () => {
  const sess = new Map();
  const a = loadOld({ ls: { tr_vgame_banks: BANKS, tr_hist: HIST }, session: sess, scale: 20 });
  assert.equal(await a.O.start(), 'bar');
  assert.match(a.barText(), /正在把你的進度帶過去/);
  assert.equal(sess.has('tr_move_auto'), false, '倒數中還沒寫');
  /* 重新整理:同一個分頁(sessionStorage 還在)、新的一頁 */
  const b = loadOld({ ls: { tr_vgame_banks: BANKS, tr_hist: HIST }, session: sess, scale: 20 });
  assert.equal(await b.O.start(), 'bar');
  assert.match(b.barText(), /正在把你的進度帶過去/, '重載之後照樣倒數');
  assert.doesNotMatch(b.barText(), /帶我過去（進度一起搬）/);
  assert.equal(await b.O.autoRun(), 'auto');
  assert.equal(b.loc.replaced.indexOf(NEW + '/move-in.html#want&n='), 0);
  await a.O.autoRun();
};
T['ping 還沒回來就在頁面上有動作(手機網路慢,先按了開始、作答、捲動):一樣不帶走,改顯示按鈕'] = async () => {
  for (const type of ['click', 'keydown', 'pointerdown', 'touchstart', 'wheel']) {
    const o = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/vocab.html', ping: 'slow', scale: 20 });
    const run = o.O.start();
    await sleep(5);
    assert.equal(o.barText(), '', 'ping 還沒回來,還沒有提示');
    o.fire(type);
    assert.equal(await run, 'bar');
    assert.equal(await o.O.autoRun(), 'busy', type);
    await sleep(300);
    assert.equal(o.loc.replaced, null, type);
    assert.match(o.barText(), /帶我過去（進度一起搬）/, type);
    assert.equal(JSON.parse(o.sess.get('tr_move_auto')).step, 'busy', type);
  }
};
T['move-out.js 載入之前就點過(navigator.userActivation.hasBeenActive):不帶走;沒點過照常自動'] = async () => {
  const o = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/reading.html', activated: true, scale: 20 });
  assert.equal(await o.O.start(), 'bar');
  assert.equal(await o.O.autoRun(), 'busy');
  await sleep(300);
  assert.equal(o.loc.replaced, null);
  assert.match(o.barText(), /帶我過去（進度一起搬）/);
  const q = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/reading.html', activated: false, scale: 20 });
  await q.O.start();
  assert.equal(await q.O.autoRun(), 'auto');
};
T['倒數時用滑鼠滾輪、觸控板捲動(讀題目、文章):算有動作,不帶走'] = async () => {
  const o = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/reading.html', scale: 20 });
  assert.equal(await o.O.start(), 'bar');
  o.fire('wheel');
  assert.equal(await o.O.autoRun(), 'busy');
  await sleep(300);
  assert.equal(o.loc.replaced, null);
};
T['倒數到期、正在換到新網址時按「等一下再搬」:照樣算數:停止換頁、這個分頁記下 later、提示拿掉;停不下來的話寄出頁那一站看到 later 不組包、回原頁面'] = async () => {
  const sess = new Map();
  const o = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/vocab.html', session: sess, scale: 20 });
  await o.O.start();
  assert.equal(await o.O.autoRun(), 'auto');
  const n = nOf(o.loc.replaced);
  const btn = o.buttons().find((b) => b.textContent === '等一下再搬');
  assert.ok(btn && !btn.disabled, '換頁中「等一下再搬」還在、按得到');
  o.click('等一下再搬');
  assert.equal(o.win.stopped, 1, '停止換頁(window.stop)');
  assert.equal(sess.get('tr_move_later'), '1');
  assert.equal(JSON.parse(sess.get('tr_move_auto')).step, 'later');
  assert.equal(o.barText(), '', '提示拿掉');
  /* 新網址已經回應、停不下來:第二站照常帶回 #key=,寄出頁不組包、不帶到 #auto= */
  const k = await o.L.newKey();
  const out = loadOld({ ls: { tr_vgame_banks: BANKS }, path: '/move-out.html', session: sess, scale: 20 });
  assert.equal(await out.O.autoSend({ pub: k.pub, n, back: '/vocab.html', cancelled: () => false }), 'cancel');
  assert.equal(out.loc.replaced, null);
  assert.deepEqual(out.writes, []);
  const src = read('js/move-out-page.js');
  assert.match(src, /r !== 'auto' && r !== 'later'\) location\.replace\(k\.back\)/, '寄出頁:不是 auto、later 都回原頁面(cancel 也是)');
};
T['LINE 內建瀏覽器,自動搬家在寄出頁沒搬成(有項目超過上限、對帳逾時、出錯、組包到一半就斷):主按鈕去搬家頁、說這次沒辦法自動,不會一按就默默回原頁面'] = async () => {
  for (const step of ['skip', 'timeout', 'error', 'build']) {
    const l = loadOld({ ls: { tr_vgame_banks: BANKS }, ua: UA_IPHONE + ' Line/13.0.0', session: { tr_move_auto: J({ step, at: Date.now() }) } });
    await l.O.start();
    assert.equal(await l.O.autoRun(), 'tried', step);
    assert.doesNotMatch(l.barText(), /我幫你一起帶過去/, step);
    assert.match(l.barText(), /沒辦法自動/, step);
    assert.equal(l.buttons().find((x) => x.textContent === '帶我過去（進度一起搬）').attrs.href, 'move-out.html', step);
  }
  /* 整條路:LINE、有一項超過上限 → 第一站 → 寄出頁 skip → 回原頁面:主按鈕去搬家頁(那裡說是哪一項超過) */
  const sess = new Map();
  const ls = { tr_vgame_banks: BANKS, 'tr_read_q_art-1': J({ note: 'x'.repeat(8 * 1024 * 1024 + 16) }) };
  const ua = UA_IPHONE + ' Line/13.0.0';
  const p1 = loadOld({ ls, ua, path: '/vocab.html', session: sess, scale: 20 });
  await p1.O.start();
  assert.equal(await p1.O.autoRun(), 'auto');
  const k = await p1.L.newKey();
  const p3 = loadOld({ ls, ua, path: '/move-out.html', session: sess, scale: 2 });   // 8 MB 的一項組包要一點時間,逾時不縮太小
  assert.equal(await p3.O.autoSend({ pub: k.pub, n: nOf(p1.loc.replaced), back: '/vocab.html', cancelled: () => false }), 'skip');
  const back = loadOld({ ls, ua, path: '/vocab.html', session: sess, scale: 20 });
  await back.O.start();
  assert.equal(await back.O.autoRun(), 'tried');
  assert.equal(back.buttons().find((x) => x.textContent === '帶我過去（進度一起搬）').attrs.href, 'move-out.html');
  assert.match(back.barText(), /沒辦法自動/);
};
T['寄出頁(LINE):這個分頁上次自動搬家沒搬成(逾時、出錯),除了「搬到新網址」也給搬家碼的路,並說上次沒搬成'] = () => {
  const src = read('js/move-out-page.js');
  assert.match(src, /OUT\.autoStuck\(/, '寄出頁要知道這個分頁上次自動搬家沒搬成');
};

/* ---------- 頁面上的接法(靜態檢查) ---------- */
function runHead(file, hash) {
  const html = read(file);
  const head = html.slice(0, html.indexOf('</script>'));
  const calls = [];
  const loc = { hash, pathname: '/' + file, search: '' };
  const ctx = { window: null, location: loc, history: { replaceState: (s, t, u) => { calls.push(u); loc.hash = ''; } }, document: { documentElement: { style: {}, classList: { add() {} } } },
    navigator: {}, matchMedia: () => ({ matches: false }) };
  ctx.window = ctx; ctx.window.top = ctx; ctx.window.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(head.slice(head.lastIndexOf('<script>') + 8), ctx);
  return { calls, ctx, html };
}
T['新網址收件頁:第一件事拿掉 #auto= 與 #want(在任何外部 script 之前 replaceState),解密後走跟貼上搬家碼同一條路'] = () => {
  const a = runHead('move-in.html', '#auto=RU1E:AAAA.BBBB.CCCC&back=%2Fvocab.html');
  assert.ok(a.html.indexOf('history.replaceState') < a.html.indexOf('<script src='), 'replaceState 要在所有外部 script 之前');
  assert.deepEqual(a.calls, ['/move-in.html']);
  assert.equal(a.ctx.MOVE_AUTO_IN, '#auto=RU1E:AAAA.BBBB.CCCC&back=%2Fvocab.html');
  const w = runHead('move-in.html', '#want&back=%2Fvocab.html');
  assert.deepEqual(w.calls, ['/move-in.html']);
  assert.equal(w.ctx.MOVE_AUTO_IN, '#want&back=%2Fvocab.html');
  const src = read('js/move-in-page.js');
  assert.ok(/MOVE_AUTO_IN/.test(src));
  assert.ok(/L\.open\(/.test(src) && /L\.newKey\(/.test(src), '收件頁要產生金鑰、解密');
  assert.ok(/fromText\(code\)/.test(src), '自動搬家要走 fromText(跟貼上搬家碼同一條)');
  assert.ok(/removeItem\(KEY\)/.test(src), '私鑰用過就刪');
  assert.ok(/L\.keyUrl\(from, pub, w\.back, w\.n\)/.test(src), '第二站把第一站的號碼照原樣帶回寄出頁');
};
T['舊網址寄出頁:開頭拿掉 #ack= 與 #key=;組包跟按鈕搬家共用 MOVE_OUT.buildPack'] = () => {
  const a = runHead('move-out.html', '#ack=' + 'a'.repeat(64));
  assert.ok(a.html.indexOf('history.replaceState') < a.html.indexOf('<script src='));
  assert.equal(a.ctx.MOVE_ACK_IN, '#ack=' + 'a'.repeat(64));
  const k = runHead('move-out.html', '#key=' + 'k'.repeat(87) + '&back=%2F');
  assert.deepEqual(k.calls, ['/move-out.html']);
  assert.equal(k.ctx.MOVE_KEY_IN, '#key=' + 'k'.repeat(87) + '&back=%2F');
  assert.equal(k.ctx.MOVE_ACK_IN, undefined);
  const src = read('js/move-out-page.js');
  assert.ok(/OUT\.buildPack\(/.test(src), '寄出頁要用 MOVE_OUT.buildPack');
  assert.ok(/OUT\.ackCheck\(/.test(src));
  assert.ok(/OUT\.autoSend\(/.test(src));
  assert.ok(/OUT\.startHere\(/.test(src) && /L\.autoLen\(/.test(src), 'LINE 等內建瀏覽器:寄出頁有一鍵在同一個分頁搬(放得下才給)');
  assert.doesNotMatch(src, /再用你以後要用的瀏覽器打開新網址貼上/, 'LINE 裡的進度搬進 LINE 裡的新網址');
};
T['說明與實作一致:不再有「搬家碼放進網址、replaceState 就不留紀錄」的說法'] = () => {
  for (const f of ['js/move-link.js', 'js/move-out.js', 'js/move-in-page.js', 'move-in.html']) {
    assert.doesNotMatch(read(f), /不留在網址列與上一頁的紀錄裡/, f);
  }
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
