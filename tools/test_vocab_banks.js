/* 單字頁的自訂題庫寫入(同步合併設計 3.6、3.7.4、2.2 C):真的 js/common.js、js/sync-merge.js、js/vocab.js 在很小的假 DOM 裡跑。
   用法:node tools/test_vocab_banks.js
   - 編輯頁開著時別的分頁存入文章題庫,這一頁改名、加字、勾選、刪字都不會把它蓋掉(每次寫入前重讀)。
   - 刪字、刪題庫:雲端帳號先存刪除標記(sync_del)再存題庫;本機學生檔案、訪客不寫標記。
   - 新版寫入蓋戳記(_r、_t、_p);兩台同時改中文留下的 alt 顯示「另一台寫的」,可以換或刪。
   - 開頁呼叫一次 CLOUD.syncKey('vgame_banks'),有變就重畫;cloud:merged、別的分頁(storage)改了題庫:首頁、編輯頁重畫,遊戲中不打斷。
   - 閱讀頁「單字存入題庫」(js/reading.js):每次重讀本機題庫、蓋戳記;同一篇再按一次沒有變就不存(不多上傳一次)。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const SRC = { common: read('js/common.js'), sm: read('js/sync-merge.js'), vocab: read('js/vocab.js'), reading: read('js/reading.js') };
const J = x => JSON.stringify(x);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + detail : ''));
}

/* ---------- 很小的假 DOM:只做 common.js 的 h() 與 vocab.js 首頁、編輯頁用到的 ---------- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.listeners = {};
    this.className = ''; this.parentNode = null; this._text = ''; this._value = ''; this.checked = false; this.selected = false; this.disabled = false;
    const self = this;
    this.classList = {
      add: c => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); s.add(c); self.className = [...s].join(' '); },
      remove: c => { self.className = self.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
      contains: c => self.className.split(/\s+/).indexOf(c) >= 0,
      toggle: (c, on) => { if (on === undefined ? !self.classList.contains(c) : on) self.classList.add(c); else self.classList.remove(c); },
    };
  }
  get nodeType() { return 1; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this._value = String(v); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...cs) { cs.forEach(c => { if (c === null || c === undefined) return; if (typeof c === 'string') c = new Text(c); c.parentNode = this; this.children.push(c); }); }
  appendChild(c) { this.append(c); return c; }
  prepend(c) { c.parentNode = this; this.children.unshift(c); }
  after(c) { const p = this.parentNode; if (!p) return; const i = p.children.indexOf(this); c.parentNode = p; p.children.splice(i + 1, 0, c); }
  remove() { const p = this.parentNode; if (p) p.children = p.children.filter(x => x !== this); }
  get nextElementSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children.slice(i + 1).find(x => x instanceof El) || null; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  removeEventListener() {}
  fire(ev, extra) { const e = Object.assign({ type: ev, target: this, preventDefault() {}, stopPropagation() {} }, extra || {}); (this.listeners[ev] || []).forEach(f => f(e)); }
  click() { this.fire('click'); }
  focus() {} blur() {} scrollIntoView() {}
  set innerHTML(v) { this.children = []; this._html = String(v); }
  get innerHTML() { return this._html || ''; }
  set textContent(v) { this.children = [new Text(String(v))]; }
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  get options() { return this.all().filter(c => c.tagName === 'OPTION'); }
  get value() {
    if (this.tagName === 'SELECT') { const o = this.options; const s = o.find(x => x.selected) || o[0]; return s ? s._value : ''; }
    return this._value;
  }
  set value(v) {
    if (this.tagName === 'SELECT') { this.options.forEach(o => { o.selected = o._value === String(v); }); return; }
    this._value = String(v);
  }
  get dataset() { return {}; }
  all() { const out = []; const walk = n => n.children.forEach(c => { if (c instanceof El) { out.push(c); walk(c); } }); walk(this); return out; }
  matches(sel) {
    let m;
    if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel))) return this.attrs[m[1]] === m[2];
    if ((m = /^#([\w-]+)$/.exec(sel))) return this.attrs.id === m[1];
    if ((m = /^\.([\w-]+)$/.exec(sel))) return this.classList.contains(m[1]);
    return this.tagName === sel.toUpperCase();
  }
  querySelector(sel) { return this.all().find(e => e.matches(sel)) || null; }
  querySelectorAll(sel) { return this.all().filter(e => e.matches(sel)); }
}
class Text { constructor(t) { this.text = t; this.parentNode = null; } get nodeType() { return 3; } get textContent() { return this.text; } }
const textOf = el => el.textContent;
const findText = (root, re) => root.all().filter(e => re.test(textOf(e)) && !e.children.some(c => c instanceof El && re.test(textOf(c))));
const button = (root, label) => root.all().find(e => e.tagName === 'BUTTON' && textOf(e) === label);

function makeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); },
    key: i => Array.from(m.keys())[i] || null, get length() { return m.size; }, dump: () => Object.fromEntries(m) };
}

/* 開一頁 vocab.html。pid:目前資料夾('c…' 雲端帳號、'p…' 本機學生檔案、null 訪客);local:共用的 localStorage(同一台另一個分頁) */
function openVocab(pid, local, opt) {
  opt = opt || {};
  const root = new El('div'); root.setAttribute('id', opt.reading ? 'reading-root' : 'vocab-root');
  const body = new El('body'); body.append(root);
  const winListeners = {};
  const pushes = [];
  const syncCalls = [];
  let resolveSync;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: local, sessionStorage: makeStorage(),
    location: { hash: '', search: opt.reading ? '?id=' + opt.reading.id : '', pathname: '/vocab.html', href: 'https://x/vocab.html' },
    history: { replaceState() {} },
    confirm: () => true, alert() {},
    scrollTo() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    performance: { now: () => 0 }, URLSearchParams,
    document: {
      title: '', body, documentElement: new El('html'),
      createElement: t => new El(t), createTextNode: t => new Text(t),
      querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s), getElementById: id => body.querySelector('#' + id),
      addEventListener() {},
    },
    TOEIC: { articles: opt.reading ? [opt.reading] : [], phrases: [] },
  };
  ctx.window = ctx;
  ctx.addEventListener = (ev, fn) => { (winListeners[ev] = winListeners[ev] || []).push(fn); };
  ctx.removeEventListener = () => {};
  ctx.CLOUD = {
    enabled: true,
    push: k => pushes.push(k),
    syncKey: k => { syncCalls.push(k); return new Promise(r => { resolveSync = r; }); },
  };
  if (pid) local.setItem('tr_current_profile', JSON.stringify(pid)); else local.removeItem('tr_current_profile');
  vm.createContext(ctx);
  vm.runInContext(SRC.common + '\n;globalThis.__store = store; globalThis.__storageKey = storageKey;', ctx);
  if (!opt.noSm) vm.runInContext(SRC.sm, ctx);
  vm.runInContext(opt.reading ? SRC.reading : SRC.vocab, ctx);
  const key = k => ctx.__storageKey(k);
  return {
    ctx, root, pushes, syncCalls,
    banks: () => JSON.parse(local.getItem(key('vgame_banks')) || '[]'),
    tombs: () => JSON.parse(local.getItem(key('sync_del')) || 'null'),
    setBanks: v => local.setItem(key('vgame_banks'), JSON.stringify(v)),
    fire: (ev, e) => (winListeners[ev] || []).forEach(f => f(e)),
    resolveSync: r => resolveSync(r),
    key,
  };
}
const tick = () => new Promise(r => setImmediate(r));
const SM = (() => { const c = {}; c.window = c; vm.createContext(c); vm.runInContext(SRC.sm, c); return c.SYNC_MERGE; })();
const CID = 'c3f2b8c1e7d4a4b9e9c215a6e8f0d1b72';
const legacy = () => [{ id: 'b1', name: '第一課', words: [{ en: 'apple', zh: '蘋果', on: true }, { en: 'pear', zh: '梨', on: true }, { en: 'kiwi', zh: '奇異果', on: true }] }];

(async () => {
  /* 1. 同一台兩個分頁 */
  {
    const local = makeStorage();
    const pg = openVocab(CID, local);
    pg.setBanks(legacy());
    pg.ctx.document.title = '';
    const home = openVocab(CID, local);          // 分頁一:重新開(題庫已存在)
    button(home.root, '編輯').click();           // 進編輯頁
    const editing = !!home.root.querySelector('[data-vview="edit"]');
    /* 分頁二:閱讀頁按「單字存入題庫」(直接用 SYNC_MERGE 寫本機,跟 js/reading.js 一樣) */
    const other = SM.editBank(home.banks(), 'art_9', Date.now(), b => SM.addWords(Object.assign({}, b, { name: '文章：九' }), [{ en: 'refund', zh: '退款' }], Date.now()));
    home.setBanks(other);
    /* 分頁一:改名、批次加字、勾選、刪字 */
    const nameInput = home.root.all().find(e => e.tagName === 'INPUT' && e.attrs.type === 'text');
    nameInput.value = '第一課改名'; nameInput.fire('change');
    const area = home.root.all().find(e => e.tagName === 'TEXTAREA');
    area.value = 'banana 香蕉\nApple 紅蘋果'; button(home.root, '加入單字').click();
    const cbs = home.root.all().filter(e => e.tagName === 'INPUT' && e.attrs.type === 'checkbox');
    cbs[1].checked = false; cbs[1].fire('change');
    const dels = home.root.all().filter(e => e.tagName === 'BUTTON' && e.attrs.title === '刪除這個字');
    dels[2].click();                                           // 刪 kiwi
    const b = home.banks();
    const b1 = b.find(x => x.id === 'b1');
    const words = b1.words.map(w => w.en + ':' + w.zh + (w.on === false ? ':off' : ''));
    check('同一台兩個分頁:編輯頁開著時另一個分頁存入文章題庫,這一頁改名、加字、勾選、刪字都不會把它蓋掉', editing && !!b.find(x => x.id === 'art_9') && b1.name === '第一課改名'
      && J(words) === J(['apple:紅蘋果', 'pear:梨:off', 'banana:香蕉']), J(b.map(x => x.id)) + ' / ' + J(words));
    check('新版寫入蓋戳記:新字有 _r、改過的字和題庫有 _p 與 _t', !!b1.words[2]._r && b1.words[0]._p && b1.words[0]._p.length === 1 && b1.words[1]._p && b1._p && b1._p.length >= 1 && typeof b1._t === 'number', J(b1).slice(0, 240));
    const t = home.tombs();
    check('雲端帳號刪字:先存刪除標記再存題庫,標記記刪的那個字的雜湊', !!t && !!t.vgame_banks.w.b1.kiwi && home.pushes.lastIndexOf('sync_del') === home.pushes.length - 2 && home.pushes[home.pushes.length - 1] === 'vgame_banks',
      J(home.pushes.slice(-3)) + ' / ' + J(t && t.vgame_banks.w));
  }
  /* 2. 刪題庫 */
  {
    for (const [pid, wantTomb] of [[CID, true], ['pabc123', false], [null, false]]) {
      const local = makeStorage();
      const pg = openVocab(pid, local);
      pg.setBanks(legacy());
      const home = openVocab(pid, local);
      const before = home.pushes.length;
      button(home.root, '刪除').click();
      const pushes = home.pushes.slice(before);
      const ok = home.banks().length === 0 && (wantTomb ? (J(pushes) === J(['sync_del', 'vgame_banks']) && !!home.tombs().vgame_banks.b.b1) : (J(pushes) === J(['vgame_banks']) && home.tombs() === null));
      check('刪題庫(' + (pid ? pid.charAt(0) === 'c' ? '雲端帳號' : '本機學生檔案' : '訪客') + '):' + (wantTomb ? '先存刪除標記再存題庫' : '不寫刪除標記'), ok, J(pushes) + ' / 剩 ' + home.banks().length);
    }
  }
  /* 3. alt:另一台寫的中文 */
  {
    const local = makeStorage();
    const pg = openVocab(CID, local);
    const w = SM.newWord('apple', '大蘋果', Date.now() - 1000);
    pg.setBanks([{ id: 'b1', name: 'x', words: [Object.assign({}, w, { alt: ['蘋果樹'] })], _r: 'abcdef', _t: 1 }]);
    const home = openVocab(CID, local);
    button(home.root, '編輯').click();
    const shown = findText(home.root, /另一台寫的：蘋果樹/).length > 0;
    button(home.root, '換成這個').click();
    const after = home.banks()[0].words[0];
    check('兩台同時改中文留下的 alt:編輯頁顯示「另一台寫的」,按「換成這個」中文換掉、alt 拿掉、蓋戳記', shown && after.zh === '蘋果樹' && !after.alt && after._p && after._p.length === 1, J(after));
    pg.setBanks([{ id: 'b1', name: 'x', words: [Object.assign({}, w, { alt: ['蘋果樹'] })] }]);
    const h2 = openVocab(CID, local);
    button(h2.root, '編輯').click();
    button(h2.root, '刪掉').click();
    const after2 = h2.banks()[0].words[0];
    check('alt 按「刪掉」:主要的中文不變、alt 拿掉', after2.zh === '大蘋果' && !after2.alt, J(after2));
  }
  /* 4. syncKey 與重畫 */
  {
    const local = makeStorage();
    const pg = openVocab(CID, local);
    pg.setBanks(legacy());
    const home = openVocab(CID, local);
    const called = J(home.syncCalls) === J(['vgame_banks']);
    home.setBanks(legacy().concat([{ id: 'b2', name: '手機的題庫', words: [] }]));
    home.resolveSync({ ok: true, changed: true }); await tick();
    const redrawn = findText(home.root, /^手機的題庫$/).length > 0;
    home.setBanks(legacy().concat([{ id: 'b2', name: '手機的題庫', words: [] }, { id: 'b3', name: '合併進來的', words: [] }]));
    home.fire('cloud:merged', { detail: { key: 'vgame_banks' } });
    const merged = findText(home.root, /^合併進來的$/).length > 0;
    home.setBanks(legacy().concat([{ id: 'b4', name: '別的分頁', words: [] }]));
    home.fire('storage', { key: home.key('vgame_banks') });
    const storageRedraw = findText(home.root, /^別的分頁$/).length > 0;
    /* 遊戲中(首頁、編輯頁的記號都不在):不重畫 */
    home.root.innerHTML = ''; home.root.append(new El('canvas'));
    home.fire('cloud:merged', { detail: { key: 'vgame_banks' } });
    const notInGame = home.root.children.length === 1 && home.root.children[0].tagName === 'CANVAS';
    check('開頁呼叫一次 CLOUD.syncKey(vgame_banks),有變就重畫;cloud:merged、別的分頁改了題庫也重畫;遊戲中不打斷',
      called && redrawn && merged && storageRedraw && notInGame, J({ called, redrawn, merged, storageRedraw, notInGame }));
  }
  /* 5. 頁面沒載到 sync-merge.js(不該發生):照舊能改,不蓋戳記 */
  {
    const local = makeStorage();
    const pg = openVocab(CID, local, { noSm: true });
    pg.setBanks(legacy());
    const home = openVocab(CID, local, { noSm: true });
    button(home.root, '編輯').click();
    const area = home.root.all().find(e => e.tagName === 'TEXTAREA');
    area.value = 'banana 香蕉'; button(home.root, '加入單字').click();
    const b1 = home.banks()[0];
    check('頁面沒有 sync-merge.js:照舊加字(不蓋戳記),不會壞', b1.words.length === 4 && !b1.words[3]._r, J(b1.words.map(w => w.en)));
  }
  /* 6. 閱讀頁:單字存入題庫 */
  {
    const art = { id: 'r1', title: 'Title', titleZh: '退款的文章', category: '商業', level: '初級', readTime: 3, image: 'x.svg',
      paragraphs: [{ en: 'Ask for a [[refund]] today.', zh: '今天要求退款。' }], vocab: [{ word: 'refund', zh: '退款' }, { word: 'invoices', base: 'invoice', zh: '發票' }], questions: [] };
    const local = makeStorage();
    const first = openVocab(CID, local, { reading: art });
    first.setBanks(legacy());
    const pg = openVocab(CID, local, { reading: art });
    const synced = J(pg.syncCalls) === J(['vgame_banks']);
    const btn = button(pg.root, '單字存入題庫');
    btn.click();
    const b = pg.banks().find(x => x.id === 'art_r1');
    const before = pg.pushes.length;
    const btn2 = pg.root.all().find(e => e.tagName === 'BUTTON' && /^已存入題庫/.test(textOf(e)));
    btn2.click();
    check('閱讀頁單字存入題庫:原本的題庫留著、新題庫和字有戳記;再按一次沒變就不存', synced && !!b && b.name === '文章：退款的文章' && !!b._r && b.words.length === 2 && b.words.every(w => !!w._r)
      && pg.banks().length === 2 && pg.pushes.length === before, J(b) + ' / 再按一次多存 ' + (pg.pushes.length - before) + ' 次');
  }
  console.log(pass + ' / ' + (pass + fail) + ' 通過');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL 例外 ' + e.stack); process.exit(1); });
