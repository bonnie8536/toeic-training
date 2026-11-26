/* start.html?step=listen 的三個畫面:聽力短測 8 題(專心模式)、自評(2 題以上音檔載不到才出)、中場(短測做完、接著做閱讀 28 題)。
   作答畫面用課程前測的元件:題目 LESSON_ITEMS.testView、只播一次的播放鈕 LESSON_ITEMS.oncePlayer、沒選就按的確認 UI.confirm,字在 LESSON_CORE.TEXT.test。
   畫短測時才依序載入 js/lesson-core.js、js/lesson-items.js、data/listening.js 與 css/lesson.css、css/lesson-test.css(其他步驟不載)。
   不讀寫儲存:每題存、答完、自評都交給呼叫的一方(js/onboard.js 經過 js/onboard-data.js)。不顯示對錯與答對數。
   window.ONBOARD_LISTEN = {
     test(root, o):o = { listen(onboard.listen), save(i, c, failed) → 'ok'…, finish(self) → 'ok'…, onDone(), onExit(), onFail() }。
       從第一個還沒答的題接著做;第 8 題交卷寫完成後叫 onDone(要自評時不寫完成,呼叫的一方再叫 test 就是自評頁,選了寫完成再叫 onDone);
       作答列的關閉鈕叫 onExit(答案已存);檔案載不到、存不進去叫 onFail
     middle(root, o):中場,o = { onGo(btn), onLater() }
     answers() → Promise<(id) → 正解選項 | null>(題庫載不到回 null)
     stop():換畫面前收掉專心模式與播放 } */
(function () {
  'use strict';
  const LOADS = [
    ['js/lesson-core.js', () => !!window.LESSON_CORE],
    ['js/lesson-items.js', () => !!window.LESSON_ITEMS],
    ['data/listening.js', () => !!(window.TOEIC && TOEIC.listening)],
  ];
  const STYLES = ['css/lesson.css', 'css/lesson-test.css'];
  const SELF = [
    ['entry', '聽得懂問時間、地點的簡單問句'], ['threshold', '聽得懂簡短電話留言的重點'],
    ['advanced', '聽得懂會議或公告裡的數字與細節'], ['high', '一般語速的討論也跟得上，聽得出言外之意'],
  ];
  const TEXT = Object.freeze({ selfH: '聽英文時，你最接近哪一種', doneH: '聽力完成', reading: '閱讀 28 題', min: '約 20 分鐘', go: '開始閱讀', later: '稍後再做' });
  let loading = null, live = null;

  /* ---------- 載入 ---------- */
  function script(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('載入失敗：' + src));
      document.head.append(s);
    });
  }
  function style(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.append(l);
  }
  function ready() {
    STYLES.forEach(style);
    if (!loading) {
      loading = LOADS.reduce((p, f) => p.then(() => (f[1]() ? null : script(f[0]))), Promise.resolve())
        .catch((e) => { loading = null; throw e; });
    }
    return loading;
  }
  function itemOf(id) {
    const L = (window.TOEIC && TOEIC.listening) || {}, list = L['p' + String(id).charAt(1)] || [];
    return list.filter((x) => x.id === id)[0] || null;
  }
  async function answers() {
    try { await ready(); } catch (e) { console.error(e); return null; }
    return (id) => { const it = itemOf(id); return it && Number.isInteger(it.answer) ? it.answer : null; };
  }

  /* ---------- 短測 ---------- */
  function stop() {
    const S = live;
    live = null;
    if (!S || S.over) return;
    S.over = true;
    if (S.asking && typeof S.asking.cancel === 'function') S.asking.cancel();
    S.playerOf.forEach((p) => p && p.stop());
    if (S.f) S.f.leave();
  }
  async function test(root, o) {
    stop();
    try { await ready(); } catch (e) { console.error(e); o.onFail(); return; }
    const ids = o.listen.ids, cur = ids.findIndex((id, i) => o.listen.a[i] === null);
    const S = { root, o, ids, cur, X: LESSON_CORE.TEXT.test, I: LESSON_ITEMS, sel: null, asking: null, over: false,
      players: ids.map(() => ({})), playerOf: [], f: null };
    if (cur < 0) { selfScreen(root, o); return; }   // 8 題都答了還沒做完:音檔載不到 2 題以上,要自評
    if (ids.some((id) => !itemOf(id))) { console.error('短測的題目找不到'); o.onFail(); return; }
    live = S;
    S.f = UI.focus.enter({ total: ids.length, confirmExit: false, onExit: () => { S.f = null; stop(); o.onExit(); } });
    draw(S);
    S.f.focusMain();
  }
  const unitOf = (S, i) => ({ p: String(S.ids[i]).charAt(1), item: itemOf(S.ids[i]) });
  function playerOf(S, i) {
    if (!S.playerOf[i]) S.playerOf[i] = S.I.oncePlayer(S.ids[i], S.players[i]);
    return S.playerOf[i].el;
  }
  function draw(S) {
    const pick = (sub, c) => { if (S.over) return; S.sel = c; S.f.keep(() => draw(S)); S.f.say(S.X.picked(S.I.LETTERS[c])); };
    S.root.replaceChildren(S.I.testView(unitOf(S, S.cur), S.sel === null ? {} : { 0: S.sel }, pick, { player: playerOf(S, S.cur) }));
    S.f.progress(S.cur + 1);
    const last = S.cur === S.ids.length - 1;
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.type = 'button';
    b.textContent = last ? S.X.submit : S.X.next;
    b.addEventListener('click', () => next(S));
    S.f.foot([b]);
  }
  function next(S) {
    if (S.over || S.asking) return;
    if (S.sel !== null) { advance(S); return; }
    const X = S.X, last = S.cur === S.ids.length - 1;
    S.asking = UI.confirm({ title: X.blankOne, body: X.blankBody, ok: last ? X.submit : X.next, cancel: X.keepGoing });
    S.asking.then((yes) => { S.asking = null; if (yes && !S.over) advance(S); });
  }
  /* 這一題存起來(找不到音檔的題記進 fail),換下一題;第 8 題之後收掉專心模式 */
  function advance(S) {
    if (S.o.save(S.cur, S.sel === null ? -1 : S.sel, !!S.players[S.cur].failed) !== 'ok') { stop(); S.o.onFail(); return; }
    if (S.playerOf[S.cur]) S.playerOf[S.cur].stop();
    if (S.cur === S.ids.length - 1) { stop(); afterLast(S); return; }
    S.cur += 1;
    S.sel = null;
    draw(S);
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    S.f.focusMain();
  }
  /* 答完:寫完成(要自評時不寫),交給呼叫的一方重畫(要自評時再進來就是自評頁) */
  function afterLast(S) {
    if (S.o.finish() !== 'ok') S.o.onFail();
    else S.o.onDone();
  }

  /* ---------- 自評:選了就前進(同引導流程的單選卡片) ---------- */
  function selfScreen(root, o) {
    const items = SELF.map((s) => h('button', { class: 'ob-choice', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1',
      onclick: () => { if (o.finish(s[0]) === 'ok') o.onDone(); else o.onFail(); } }, s[1]));
    items[0].setAttribute('tabindex', '0');
    const box = h('div', { class: 'ob-choices', role: 'radiogroup', 'aria-labelledby': 'ob-title' }, items);
    box.addEventListener('keydown', (e) => {
      const i = items.indexOf(document.activeElement), d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (i < 0 || !d) return;
      e.preventDefault();
      const n = items[(i + d + items.length) % items.length];
      items.forEach((x) => x.setAttribute('tabindex', x === n ? '0' : '-1'));
      n.focus();
    });
    const title = h('h1', { id: 'ob-title', tabindex: '-1' }, TEXT.selfH);
    root.replaceChildren(h('div', { class: 'page-head' }, title), box);
    try { title.focus({ preventScroll: true }); window.scrollTo(0, 0); } catch (e) { /* 焦點放不上去不影響作答 */ }
  }

  /* ---------- 中場 ---------- */
  function middle(root, o) {
    stop();
    const go = h('button', { class: 'btn primary', type: 'button', onclick: (e) => o.onGo(e.currentTarget) }, TEXT.go);
    root.replaceChildren(
      h('div', { class: 'page-head ob-mid-head' }, h('canvas', { class: 'hub-art', 'data-mascot': 'happy', 'data-size': '56', 'aria-hidden': 'true' }),
        h('h1', { id: 'ob-title' }, TEXT.doneH)),
      h('div', { class: 'diag-intro ob-intro' },
        h('p', { class: 'mock-tags' }, h('span', { class: 'mock-tag' }, TEXT.reading), h('span', { class: 'mock-tag' }, TEXT.min)), go,
        h('div', { class: 'ob-intro-more' }, h('button', { class: 'btn-text', type: 'button', onclick: () => o.onLater() }, TEXT.later))));
  }

  window.ONBOARD_LISTEN = Object.freeze({ TEXT, SELF, test, middle, answers, stop });
})();
