/* 搬家的視窗之間怎麼傳(js/move-link.js)、舊網址每一頁的判斷與記號(js/move-out.js)、新網址的提示(js/move-in-boot.js)。
   用假的視窗:postMessage 只有對象網域對才送得到,event.source 是真的那個視窗。用法:node tools/test_move_link.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const OLD = 'https://www.shuashualanguage.com', NEW = 'https://www.rushuplanguage.com', EVIL = 'https://evil.example';
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

function loadLink() {
  const ctx = { crypto: globalThis.crypto, Uint8Array, Array, Object, JSON };
  vm.createContext(ctx);
  vm.runInContext(read('js/move-link.js'), ctx);
  return ctx.MOVE_LINK;
}
const L = loadLink();

/* 一個視窗(realm):收訊息的監聽器;ref(對方看到的那個視窗物件)由 pair 建 */
function realm(origin) {
  const ls = new Set();
  return { origin, ls, addEventListener(t, f) { if (t === 'message') ls.add(f); }, removeEventListener(t, f) { ls.delete(f); }, got: [] };
}
/* to 這個視窗在 from 的眼中:postMessage 時對象網域要等於 to.origin(或 '*')才送得到,source 是 from 在 to 眼中的那個物件 */
function refTo(to, from, net) {
  const ref = {
    posts: [],
    postMessage(data, targetOrigin) {
      ref.posts.push({ data, targetOrigin });
      if (targetOrigin !== '*' && targetOrigin !== to.origin) return;
      const ev = { origin: from.origin, source: net.refOf(from, to), data: structuredClone(data) };
      setImmediate(() => to.ls.forEach((f) => f(ev)));
    },
  };
  return ref;
}
function pairUp() {
  const oldW = realm(OLD), newW = realm(NEW), evilW = realm(EVIL);
  const refs = new Map();
  const net = { refOf: (w, viewer) => { const k = w.origin + '>' + viewer.origin; if (!refs.has(k)) refs.set(k, refTo(w, viewer, net)); return refs.get(k); } };
  return { oldW, newW, evilW, child: net.refOf(newW, oldW), opener: net.refOf(oldW, newW), evilToOld: net.refOf(oldW, evilW), evilToNew: net.refOf(newW, evilW), net };
}
function fakeTimers() {
  const list = new Map(); let id = 0;
  return { setInterval: (f) => { list.set(++id, f); return id; }, clearInterval: (i) => list.delete(i), fire: () => [...list.values()].forEach((f) => f()), get size() { return list.size; } };
}
const HASH = 'a'.repeat(64);
const PACK = { app: 'rushup-move', v: 1, keys: [['tr_hist', '[]']], accounts: {} };

const T = {};
T['整個流程:收件頁送 hello,寄出頁一次送出整包(對象網域寫新網址,不用 *);收件頁收到;寫完回 done,寄出頁才記下搬好了'] = async () => {
  const p = pairUp(), tm = fakeTimers();
  let got = null, done = 0;
  const s = L.sender({ win: p.oldW, to: NEW, child: () => p.child, pack: PACK, hash: HASH, onDone: () => { done++; } });
  const r = L.receiver({ win: p.newW, opener: p.opener, from: [OLD], nonce: L.newNonce(crypto), every: 2000, setInterval: tm.setInterval, clearInterval: tm.clearInterval, onPack: (pk, h, o) => { got = { pk, h, o }; } });
  await tick();
  assert.ok(got && got.h === HASH && got.o === OLD && JSON.stringify(got.pk) === JSON.stringify(PACK));
  assert.ok(p.child.posts.every((x) => x.targetOrigin === NEW));
  assert.ok(p.opener.posts.every((x) => x.targetOrigin === OLD));
  assert.equal(tm.size, 0, '收到就不再送 hello');
  assert.equal(done, 0);
  r.done(HASH); await tick();
  assert.equal(done, 1);
  s.stop();
};
T['hello 每 2 秒重送,寄出頁晚回(iPhone 背景分頁)也收得到;hello 只送得到對的網域'] = async () => {
  const p = pairUp(), tm = fakeTimers();
  let got = 0;
  const r = L.receiver({ win: p.newW, opener: p.opener, from: [OLD, 'https://other.example'], nonce: L.newNonce(crypto), setInterval: tm.setInterval, clearInterval: tm.clearInterval, onPack: () => { got++; } });
  tm.fire(); tm.fire(); await tick();
  assert.equal(p.opener.posts.length, 6);
  assert.deepEqual([...new Set(p.opener.posts.map((x) => x.targetOrigin))].sort(), [OLD, 'https://other.example'].sort());
  L.sender({ win: p.oldW, to: NEW, child: () => p.child, pack: PACK, hash: HASH });
  tm.fire(); await tick();
  assert.equal(got, 1);
  assert.ok(r.accepted === OLD);
};
T['寄出頁不理:別的網域的 hello、不是自己開的那個視窗的 hello、格式不對的 hello'] = async () => {
  const p = pairUp();
  const s = L.sender({ win: p.oldW, to: NEW, child: () => p.child, pack: PACK, hash: HASH });
  p.evilToOld.postMessage({ type: 'hello', v: 1, nonce: 'b'.repeat(32) }, OLD);
  await tick();
  assert.equal(p.child.posts.length, 0);
  p.oldW.ls.forEach((f) => f({ origin: NEW, source: {}, data: { type: 'hello', v: 1, nonce: 'b'.repeat(32) } }));
  p.oldW.ls.forEach((f) => f({ origin: NEW, source: p.child, data: { type: 'hello', v: 1, nonce: 'short' } }));
  p.oldW.ls.forEach((f) => f({ origin: NEW, source: p.child, data: 'hello' }));
  await tick();
  assert.equal(p.child.posts.length, 0);
  s.stop();
};
T['收件頁不理:別的網域的包、不是 opener 的包、nonce 不對、雜湊格式不對、pack 不是物件;改用備案(stop)之後也不收'] = async () => {
  const p = pairUp(), tm = fakeTimers();
  let got = 0;
  const nonce = L.newNonce(crypto);
  const r = L.receiver({ win: p.newW, opener: p.opener, from: [OLD], nonce, setInterval: tm.setInterval, clearInterval: tm.clearInterval, onPack: () => { got++; } });
  p.evilToNew.postMessage({ type: 'pack', nonce, hash: HASH, pack: PACK }, NEW);
  const fire = (ev) => p.newW.ls.forEach((f) => f(ev));
  fire({ origin: OLD, source: {}, data: { type: 'pack', nonce, hash: HASH, pack: PACK } });
  fire({ origin: OLD, source: p.opener, data: { type: 'pack', nonce: 'c'.repeat(32), hash: HASH, pack: PACK } });
  fire({ origin: OLD, source: p.opener, data: { type: 'pack', nonce, hash: 'xyz', pack: PACK } });
  fire({ origin: OLD, source: p.opener, data: { type: 'pack', nonce, hash: HASH, pack: [] } });
  await tick();
  assert.equal(got, 0);
  r.stop();
  fire({ origin: OLD, source: p.opener, data: { type: 'pack', nonce, hash: HASH, pack: PACK } });
  assert.equal(got, 0);
  assert.equal(tm.size, 0);
};
T['done 要 nonce 與雜湊都對才算;別的網域送的 done 不算'] = async () => {
  const p = pairUp(), tm = fakeTimers();
  let done = 0;
  L.sender({ win: p.oldW, to: NEW, child: () => p.child, pack: PACK, hash: HASH, onDone: () => { done++; } });
  const nonce = L.newNonce(crypto);
  L.receiver({ win: p.newW, opener: p.opener, from: [OLD], nonce, setInterval: tm.setInterval, clearInterval: tm.clearInterval, onPack: () => {} });
  await tick();
  p.opener.postMessage({ type: 'done', nonce, hash: 'f'.repeat(64) }, OLD);
  p.opener.postMessage({ type: 'done', nonce: 'd'.repeat(32), hash: HASH }, OLD);
  p.evilToOld.postMessage({ type: 'done', nonce, hash: HASH }, OLD);
  await tick();
  assert.equal(done, 0);
  p.opener.postMessage({ type: 'done', nonce, hash: HASH }, OLD);
  await tick();
  assert.equal(done, 1);
};
T['大包:5 MB 的字串一次送,不切塊'] = async () => {
  const p = pairUp(), tm = fakeTimers();
  const big = { app: 'rushup-move', v: 1, keys: [['tr_hist', JSON.stringify('x'.repeat(5 * 1024 * 1024))]], accounts: {} };
  let len = 0;
  L.sender({ win: p.oldW, to: NEW, child: () => p.child, pack: big, hash: HASH });
  L.receiver({ win: p.newW, opener: p.opener, from: [OLD], nonce: L.newNonce(crypto), setInterval: tm.setInterval, clearInterval: tm.clearInterval, onPack: (pk) => { len = pk.keys[0][1].length; } });
  await tick();
  assert.equal(len, big.keys[0][1].length);
  assert.equal(p.child.posts.filter((x) => x.data.type === 'pack').length, 1);
};

/* ---------- js/move-out.js ---------- */
function loadOut(opt) {
  const writes = [];
  const store = new Map(Object.entries(opt.ls || {}));
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), key: (i) => [...store.keys()][i] || null, get length() { return store.size; },
    setItem: (k, v) => { writes.push(k); store.set(k, String(v)); }, removeItem: (k) => { writes.push('-' + k); store.delete(k); },
  };
  const cookies = [], caches = { opened: [], deleted: [], open: async (n) => { caches.opened.push(n); return {}; }, delete: async (n) => { caches.deleted.push(n); return true; }, keys: async () => ['ss-pages-v1', 'ss-move-flag', 'other'] };
  const loc = { protocol: 'https:', origin: OLD, pathname: opt.path || '/grammar.html', search: opt.search || '', hash: opt.hash || '', replaced: null, replace(u) { loc.replaced = u; }, assign() {} };
  const unreg = [];
  const on = {};
  const listen = (pre) => (ev, fn) => { (on[pre + ev] = on[pre + ev] || []).push(fn); };
  const win = {
    localStorage: ls, sessionStorage: { getItem: () => null, setItem() {} }, location: loc, caches, addEventListener: listen('win:'),
    document: { set cookie(v) { cookies.push(v); }, body: null, visibilityState: 'visible', addEventListener: listen('doc:'), getElementById: () => null, createElement() { return {}; } },
    navigator: { serviceWorker: { getRegistrations: async () => [{ unregister: async () => { unreg.push(1); return true; } }] } },
    fetch: async () => { if (opt.ping === 'ok') return { ok: true, text: async () => 'rushup-move-ping 1' }; throw new TypeError('fail'); },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)), clearTimeout, AbortController, MOVE_OUT_NO_AUTO: true, Promise, JSON, RegExp, Object, Date,
    MOVE: { from: [OLD], to: NEW, onOld: true, onNew: false, newName: 'www.rushuplanguage.com', oldName: 'shuashualanguage.com' },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(read('js/move-rules.js').replace('typeof globalThis !== \'undefined\' ? globalThis : this', 'window'), win);
  vm.runInContext(read('js/move-out.js'), win);
  const fire = (name) => (on[name] || []).forEach((f) => f());
  return { win, writes, cookies, caches, loc, unreg, store, fire, O: win.MOVE_OUT, R: win.MOVE_RULES };
}
const lastCookie = (cs, name) => cs.filter((c) => c.indexOf(name + '=') === 0).pop() || '';
T['move-out 判斷:登入回來的網址不動;新網址不通不動;搬過了帶走;沒資料沒登入帶走;有資料提示;註冊付款頁先問;只登入提示重新登入'] = () => {
  const { O } = loadOut({});
  const base = { search: '', hash: '', page: 'grammar.html', moved: false, hasData: true, loggedIn: false, pingOk: true };
  const d = (o) => O.decide(Object.assign({}, base, o));
  assert.equal(d({ search: '?code=abc' }), 'stay');
  assert.equal(d({ hash: '#access_token=x&type=signup' }), 'stay');
  assert.equal(d({ hash: '#type=recovery' }), 'stay');
  assert.equal(d({ hash: '#error=access_denied' }), 'stay');
  assert.equal(d({ pingOk: false }), 'stay');
  assert.equal(d({ pingOk: false, moved: true, done: true }), 'offline');   // 搬過了但新網址連不上:提示在這裡練習的不會自動過去
  assert.equal(d({ pingOk: false, moved: false, done: true }), 'offline');
  assert.equal(d({ moved: false, done: true }), 'bar');   // 搬過之後又有新的進度:再搬一次,不帶走
  assert.equal(d({ moved: false, done: true, page: 'pricing.html' }), 'ask');
  assert.equal(d({ page: 'move-out.html', moved: true }), 'stay');
  assert.equal(d({ moved: true }), 'go');
  assert.equal(d({ hasData: false }), 'go');
  assert.equal(d({}), 'bar');
  assert.equal(d({ hash: '#phrase' }), 'bar');
  for (const pg of ['signup.html', 'pricing.html', 'pay-result.html']) assert.equal(d({ page: pg }), 'ask');
  assert.equal(d({ hasData: false, loggedIn: true }), 'login');
};
T['move-out 記號:有資料寫 tr_hd 與 ss-move-flag;搬過了寫 tr_moved、刪記號;沒資料兩個都拿掉;一筆 localStorage 都不寫'] = async () => {
  const a = loadOut({ ls: { tr_hist: JSON.stringify([{ t: 1, m: 'p5', id: 'q' }]) } });
  await a.O.start();
  assert.ok(a.cookies.some((c) => /^tr_hd=1; Max-Age=34560000; Path=\/; Secure; SameSite=Lax$/.test(c)));
  assert.deepEqual(a.caches.opened, ['ss-move-flag']);
  assert.deepEqual(a.writes, []);
  const b = loadOut({ ls: { tr_hist: '[1]', tr_move_done: '{}' } });
  await b.O.start();
  assert.ok(b.cookies.some((c) => /^tr_moved=1/.test(c)) && b.cookies.some((c) => /^tr_hd=; Max-Age=0/.test(c)));
  assert.deepEqual(b.caches.deleted, ['ss-move-flag']);
  const c = loadOut({ ls: { tr_pet: JSON.stringify({ v: 1, days: {} }), tr_pet_hint: '2' } });
  await c.O.start();
  assert.ok(c.cookies.some((x) => /^tr_hd=; Max-Age=0/.test(x)));
  assert.deepEqual(c.writes, []);
};
T['move-out 帶走:新網址不通時什麼都不做;通了而且搬過,帶到新網址同一路徑、查詢字串與 #,先刪 ss- 快取、註銷 service worker'] = async () => {
  const a = loadOut({ ls: { tr_move_done: '{}' }, ping: 'fail', path: '/vocab.html', search: '?x=1', hash: '#phrase' });
  assert.equal(await a.O.start(), 'offline');
  assert.equal(a.loc.replaced, null);
  const b = loadOut({ ls: { tr_move_done: '{}' }, ping: 'ok', path: '/vocab.html', search: '?x=1', hash: '#phrase' });
  assert.equal(await b.O.start(), 'go');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(b.loc.replaced, NEW + '/vocab.html?x=1#phrase');
  assert.deepEqual([...new Set(b.caches.deleted)].sort(), ['ss-move-flag', 'ss-pages-v1']);   // 別人的快取(other)不動
  assert.equal(b.unreg.length, 1);
  const c = loadOut({ ls: { tr_move_done: '{}' }, ping: 'ok', hash: '#access_token=abc' });
  assert.equal(await c.O.start(), 'stay');
};
T['指紋:練習紀錄、題庫、本機學生、帳本變了就不同;登入資料、目前學生、搬家紀錄、提示次數、雲端帳號資料夾變了不算'] = () => {
  const { R } = loadOut({});
  const mk = (o) => { const m = new Map(Object.entries(o)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), key: (i) => [...m.keys()][i] || null, get length() { return m.size; } }; };
  const U = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72', CP = 'c' + U.replace(/-/g, '');
  const base = { tr_hist: '[{"id":"a"}]', tr_vgame_banks: '[]', tr_diag: '{"s":1}' };
  const f0 = R.fingerprint(mk(base));
  assert.equal(typeof f0, 'string');
  assert.equal(R.fingerprint(mk(Object.assign({}, base))), f0);
  assert.equal(R.fingerprint(mk(Object.assign({ tr_x: '1' }, base))), f0, '認不得的鍵不算');
  for (const k of ['tr_current_profile', 'tr_move_done', 'tr_move_log', 'tr_pet_hint', 'sb-abc-auth-token', 'tr_access_' + U, 'tr_u' + CP + '_hist', 'tr_cloud_hydrated_' + U]) {
    assert.equal(R.fingerprint(mk(Object.assign({ [k]: '"x' + k + '"' }, base))), f0, k + ' 不該算');
  }
  assert.notEqual(R.fingerprint(mk(Object.assign({}, base, { tr_hist: '[{"id":"b"}]' }))), f0, '同長度的改動也要看得出來');
  assert.notEqual(R.fingerprint(mk(Object.assign({}, base, { tr_diag: '{"s":2}' }))), f0);
  assert.notEqual(R.fingerprint(mk(Object.assign({ ['tr_unsynced_' + U]: '{"hist":1}' }, base))), f0, '帳本變了要算');
  assert.notEqual(R.fingerprint(mk(Object.assign({ ['tr_localonly_' + U]: '{"pet":1}' }, base))), f0);
  assert.notEqual(R.fingerprint(mk(Object.assign({ tr_profiles: '[{"id":"pabcd1","name":"a"}]' }, base))), f0);
  assert.notEqual(R.fingerprint(mk({ tr_hist: '[{"id":"a"}]', tr_vgame_banks: '[]' })), f0, '少一個鍵要看得出來');
};
T['搬過之後又在舊網址練習(指紋不一樣):不帶走,改提示再搬一次,cookie 改回 tr_hd;指紋一樣照常帶走'] = async () => {
  const hist1 = JSON.stringify([{ t: 1, m: 'p5', id: 'q' }]);
  const pre = loadOut({ ls: { tr_hist: hist1 } });
  const fp = pre.R.fingerprint(pre.win.localStorage);
  const same = loadOut({ ls: { tr_hist: hist1, tr_move_done: JSON.stringify({ hash: 'h', fp, at: 1 }) }, ping: 'ok' });
  assert.equal(await same.O.start(), 'go');
  const hist2 = JSON.stringify([{ t: 1, m: 'p5', id: 'q' }, { t: 2, m: 'p5', id: 'r' }]);
  const stale = loadOut({ ls: { tr_hist: hist2, tr_move_done: JSON.stringify({ hash: 'h', fp, at: 1 }) }, ping: 'ok' });
  assert.equal(await stale.O.start(), 'bar');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(stale.loc.replaced, null);
  assert.match(lastCookie(stale.cookies, 'tr_hd'), /^tr_hd=1;/);
  assert.match(lastCookie(stale.cookies, 'tr_moved'), /^tr_moved=; Max-Age=0/);
  assert.equal(stale.O.stateOf(stale.win.localStorage).done, true);
  assert.equal(stale.O.stateOf(stale.win.localStorage).moved, false);
  assert.deepEqual(stale.writes, []);
  /* 指紋一樣但這台已經沒有要搬的(例如帳本傳完了):照常帶走 */
  const gone = loadOut({ ls: { tr_move_done: JSON.stringify({ hash: 'h', fp: 'other', at: 1 }) }, ping: 'ok' });
  assert.equal(await gone.O.start(), 'go');
};
T['搬過了、新網址連不上:提示這裡練習的不會自動過去;離開這一頁時重算記號,在這一頁練習的下次 Worker 也看得到'] = async () => {
  const hist1 = JSON.stringify([{ t: 1, m: 'p5', id: 'q' }]);
  const pre = loadOut({ ls: { tr_hist: hist1 } });
  const fp = pre.R.fingerprint(pre.win.localStorage);
  const a = loadOut({ ls: { tr_hist: hist1, tr_move_done: JSON.stringify({ hash: 'h', fp, at: 1 }) }, ping: 'fail' });
  assert.equal(await a.O.start(), 'offline');
  assert.match(lastCookie(a.cookies, 'tr_moved'), /^tr_moved=1;/);
  a.store.set('tr_hist', JSON.stringify([{ t: 1, m: 'p5', id: 'q' }, { t: 5, m: 'p5', id: 'z' }]));
  a.fire('win:pagehide');
  assert.match(lastCookie(a.cookies, 'tr_hd'), /^tr_hd=1;/);
  assert.match(lastCookie(a.cookies, 'tr_moved'), /^tr_moved=; Max-Age=0/);
  const src = read('js/move-out.js');
  assert.match(src, /拍謝！我們換網址了，因為名字跟別人重疊！/);
  assert.match(src, /visibilitychange/);
};
T['寄出頁:準備時記下指紋,搬好時存進 tr_move_done;按「我已經在新網址搬好了」也記'] = () => {
  const src = read('js/move-out-page.js');
  assert.ok(src.indexOf('MOVE_RULES.fingerprint(localStorage)') > -1, '準備時要算指紋');
  assert.ok(src.indexOf("'tr_move_done', JSON.stringify({ to: M.to, hash: hash || null, fp") > -1, 'tr_move_done 要存指紋');
};
T['舊網址不會被改:寄出頁與每一頁的程式只新增 tr_move_done 與 tr_move_device(裝置編號),不刪任何鍵'] = () => {
  for (const f of ['js/move-out.js', 'js/move-out-page.js', 'js/move-pack.js', 'js/move-link.js', 'js/move-rules.js']) {
    const src = read(f);
    const sets = [...src.matchAll(/(?:localStorage|ls)\.setItem\(\s*'([^']+)'/g)].map((m) => m[1]);
    assert.ok(sets.every((k) => k === 'tr_move_done' || k === 'tr_move_device'), f + ' 寫了 ' + sets.join(','));
    assert.equal(/localStorage\.(removeItem|clear)\(/.test(src), false, f + ' 刪了鍵');
    assert.equal(/\.setItem\(\s*[^'"]/.test(src.replace(/sessionStorage\.setItem\('tr_move_later'/g, '')), false, f + ' 用變數當鍵寫入');
  }
};
T['move-in-boot:一次一條,依序是還原過、還沒合併的帳號進度(沒登入那個帳號)、以前在舊網址練習過'] = () => {
  const ctx = { window: null, MOVE: { onNew: true, from: [OLD], to: NEW, oldName: 'shuashualanguage.com' }, document: { body: null, addEventListener() {} }, localStorage: { getItem: () => null, key: () => null, length: 0 }, location: { pathname: '/index.html' } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/move-in-boot.js'), ctx);
  const w = ctx.MOVE_IN_BOOT.which;
  const U = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
  assert.equal(w({ restored: true, pending: [U], uid: '', log: false, hintOff: false }), 'restored');
  assert.equal(w({ restored: false, pending: [U], uid: '', log: true, hintOff: true }), 'pending');
  assert.equal(w({ restored: false, pending: [U], uid: U, log: true, hintOff: true }), '');
  assert.equal(w({ restored: false, pending: [], uid: '', log: false, hintOff: false }), 'hint');
  assert.equal(w({ restored: false, pending: [], uid: '', log: false, hintOff: true }), '');
  assert.equal(w({ restored: false, pending: [], uid: '', log: true, hintOff: false }), '');
};
T['兩頁都拒絕被框住;收件頁不載 cloud.js、pet-store.js;寄出頁要等 cloud.js 灌完資料才讓人按'] = () => {
  for (const f of ['move-in.html', 'move-out.html']) assert.match(read(f), /window\.top !== window\.self/);
  for (const f of ['js/move-in-page.js', 'js/move-out-page.js']) assert.match(read(f), /window\.top !== window\.self/);
  const inHtml = read('move-in.html');
  assert.equal(/cloud\.js|pet-store\.js|app-shell\.js/.test(inHtml), false);
  assert.match(read('js/move-out-page.js'), /await CLOUD\.ready/);
  assert.match(read('js/move-out-page.js'), /window\.open\(M\.to \+ '\/move-in\.html', '_blank'\)/);
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
