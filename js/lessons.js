/* 課程總覽(lessons.html):整期 24 堂上到哪裡。頂端是今天的課卡(js/lesson-home.js 的 renderCard),下面一條 24 堂的清單。
   每堂只有三種狀態:完成、可上(有進度寫段數,沒有寫未開始)、不能上(右側寫未開放,不連結);今天不能上的原因只寫在頂端的卡。
   判定試行班、讀學習包與進度都經過 js/lesson-data.js(LESSON_DATA),畫面不寫任何資料。字串在 LESSON_CORE.TEXT。
   空狀態(課程尚未開放、讀不到班級資料、還沒設定起始程度、載入失敗)用 UI.empty,鵜鶘 sleep。這一頁只有一個畫面,不寫瀏覽歷史。 */
(function () {
  'use strict';
  const root = document.getElementById('lsn-root');
  if (!root || !window.LESSON_CORE || !window.LESSON_DATA || !window.LESSON_HOME) return;
  const C = LESSON_CORE, T = C.TEXT;
  let seq = 0, drawn = '';

  /* 換掉整個畫面;使用者按了按鈕(重試)才把焦點放到新畫面(空狀態的那一行字或頁標題) */
  function put(nodes, focus) {
    root.replaceChildren(...nodes);
    if (window.UI && typeof UI.mount === 'function') UI.mount(root);
    if (!focus) return;
    const t = root.querySelector('.ui-empty-text') || document.querySelector('main h1');
    if (t) { if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1'); t.focus(); }
  }
  function loading() { put([h('p', { class: 'result-note', role: 'status' }, T.home.loading)]); }
  function empty(text, action, links, focus) {
    drawn = '';
    if (!uiReady()) return;
    const box = UI.empty({ text, action, links: links || [], pose: 'sleep' });
    const t = box.querySelector('.ui-empty-text');
    if (t) t.setAttribute('tabindex', '-1');
    put([box], focus);
  }
  const daily = (primary) => ({ label: T.empty.daily, href: 'daily.html', primary: !!primary });
  const retry = () => ({ label: T.empty.retry, onClick: () => open(true) });

  /* 完成的勾(線條圖示,同 js/ui.js 的 icon 屬性) */
  function check() {
    if (typeof document.createElementNS !== 'function') return null;
    const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg');
    [['viewBox', '0 0 24 24'], ['width', '16'], ['height', '16'], ['aria-hidden', 'true'], ['focusable', 'false'], ['fill', 'none'],
      ['stroke', 'currentColor'], ['stroke-width', '2.4'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']].forEach((a) => s.setAttribute(a[0], a[1]));
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'm5 12 5 5 9-10');
    s.append(p);
    return s;
  }
  /* 一列:可讀名稱是「第 n 堂 堂名 狀態」;不能上的列是純文字(Tab 不停) */
  function row(item, c, current) {
    let lesson = null;
    try { lesson = c.lessonOf(item.no); } catch (e) { console.error('第 ' + item.no + ' 堂拼不出來：', e); }
    const st = C.rowStatus(item.status, c.states[item.no] || null, lesson);
    const kids = [
      h('span', { class: 'lsn-mark' + (st.mark ? ' is-' + st.mark : ''), 'aria-hidden': 'true' }, st.mark === 'done' ? check() : null),
      h('span', { class: 'lsn-row-no' }, T.home.kicker(item.no)), ' ',
      h('span', { class: 'lsn-row-name' }, lesson ? C.lessonTitle(lesson) : ''), ' ',
      h('span', { class: 'me-row-val lsn-row-st' }, st.text),
    ];
    const at = current ? { 'aria-current': 'step' } : {};
    const el = st.link
      ? h('a', Object.assign({ class: 'me-row lsn-row', href: 'lesson.html?no=' + item.no }, at), kids)
      : h('div', Object.assign({ class: 'lsn-row is-off' }, at), kids);
    return h('li', null, el);
  }
  function draw(c, focus) {
    const model = C.homeModel({ unlock: c.unlock, states: c.states, lessonOf: c.lessonOf, onLessons: true });
    const sig = JSON.stringify([model, c.unlock, c.states]);
    if (!focus && sig === drawn && root.querySelector('.lsn-list')) return;
    drawn = sig;
    const card = LESSON_HOME.renderCard(model, { onLessons: true });
    const list = h('ol', { class: 'me-list lsn-list', 'aria-label': T.list.label },
      c.unlock.lessons.map((x) => row(x, c, x.no === c.unlock.next)));
    put([h('p', { class: 'mock-tags lsn-tags' }, h('span', { class: 'mock-tag' }, T.list.done(model.done))), card, list], focus);
  }

  /* 開頁、重試、雲端資料到了:判定 → 讀學習包 → 先用本機進度畫,再跟雲端合併後重畫(有變才換) */
  async function open(focus) {
    const my = ++seq;
    if (!root.querySelector('.lsn-list')) loading();
    let p;
    try { p = await LESSON_DATA.pilot(); } catch (e) { console.error('判定課程的資格失敗：', e); p = { state: 'unknown' }; }
    if (my !== seq) return;
    if (p.state === 'guest') { drawn = ''; root.replaceChildren(); return; }   // 登入卡由 js/profile.js 出(body 帶 data-require-profile)
    if (p.state === 'checking') return;                                     // 正要灌雲端資料重載
    if (p.state === 'unknown') { empty(T.empty.unknown, retry(), [daily(false)], focus); return; }
    if (p.state !== 'pilot') { empty(T.empty.off, daily(true), null, focus); return; }
    if (!LESSON_DATA.levels()) { empty(T.empty.noLevels, { label: T.empty.setLevels, href: 'start.html' }, null, focus); return; }
    try {
      for (const local of [true, false]) {
        const c = await LESSON_HOME.course({ local });
        if (my !== seq) return;
        if (!c) { empty(T.empty.noLevels, { label: T.empty.setLevels, href: 'start.html' }, null, focus); return; }
        draw(c, focus && local);
      }
    } catch (e) {
      if (my !== seq) return;
      console.error('課程總覽畫不出來：', e);
      empty(T.empty.failed, retry(), [daily(false)], focus);
    }
  }

  open(false);
  Promise.resolve(window.CLOUD ? CLOUD.ready : null).catch(() => null).then(() => {
    if (window.CLOUD && CLOUD.reloading) return;
    if (root.querySelector('.lsn-list')) open(false);
  });
  window.addEventListener('cloud:merged', (e) => { if (e && e.detail && /^(les_t|plan$|levels$)/.test(String(e.detail.key)) && root.querySelector('.lsn-list')) open(false); });
  window.addEventListener('pageshow', (e) => { if (e && e.persisted) open(false); });
})();
