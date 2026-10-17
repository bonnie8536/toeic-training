/* 付款結果頁(pay-result.html)。藍新付款完把買方帶回來(newebpay-notify/return 驗過簽章才帶 ?o=訂單編號),
   或買方在藍新按「返回商店」(帶 ?back=1、不帶編號,改用這個分頁剛建的那一筆)。
   這一頁只讀:用 CHECKOUT.poll 每 3 秒查一次自己的單,最多 60 秒;付款狀態一律以伺服器為準,網址參數不算數。
   ?back=1 只查一次:還在處理中就寫「付款沒有完成」,不輪詢。
   朗讀:role=status 在不會被換掉的 #pay-root(pay-result.html);狀態沒變就不重畫,有最後結果時焦點移到標題。
   PAID_UI 沒開也能用(站長的 NT$10 測試在收費開始前)。 */
(function () {
  document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('pay-root');
    const K = window.CHECKOUT, C = window.CLOUD;
    if (!root || !K) return;
    let order = null;
    let shown = '';

    function render(st) {
      const v = K.stateView(st);
      const key = JSON.stringify([v, order]);
      if (key === shown) return;
      shown = key;
      const hadFocus = root.contains(document.activeElement);
      const head = h('h2', { class: 'pay-h', tabindex: '-1' }, v.title);
      const card = h('section', { class: 'pay-result' + (v.tone ? ' is-' + v.tone : '') },
        head,
        v.lines.map(t => h('p', { class: 'pay-line' }, t)));
      if (v.actions.length) {
        card.append(h('div', { class: 'pay-actions' }, v.actions.map(a => {
          const cls = 'btn' + (a.primary ? ' primary' : '') + ' pay-btn';
          if (a.retry) return h('button', { class: cls, type: 'button', onclick: () => run() }, a.text);
          if (a.login) return h('button', { class: cls, type: 'button', onclick: login }, a.text);
          return h('a', { class: cls, href: a.href }, a.text);
        })));
      }
      if (order) card.append(h('p', { class: 'pay-order' }, '訂單編號 ' + order));
      root.innerHTML = '';
      root.append(card);
      /* 按「再查一次」時那顆按鈕被換掉了,焦點跟著移到標題,不掉回頁面開頭 */
      if (hadFocus || K.isFinal(st && st.state)) head.focus();
    }

    function login() {
      if (window.PROFILE && typeof PROFILE.showLogin === 'function') PROFILE.showLogin('login');
      else location.href = 'signup.html?mode=login';
    }

    let round = 0;
    function run() {
      const my = ++round;
      render({ state: 'checking' });
      return K.poll(order, { onState: st => { if (my === round) render(st); } });
    }

    if (!C || !C.enabled) { render({ state: 'error' }); return; }
    render({ state: 'checking' });
    try { await C.ready; } catch (e) { /* 照沒登入處理 */ }
    if (!C.user) { render({ state: 'login' }); return; }
    const back = K.backFlag(location.search);
    order = K.orderFromPage(location.search, Date.now());
    if (!order) { render({ state: back ? 'cancelled' : 'noorder' }); return; }
    if (back) { render(await K.checkOnce(order)); return; }
    /* 網址上的訂單編號留著沒關係(只是查詢用),重新整理會再查一次 */
    run();
  });
})();
