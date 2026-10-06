/* 註冊頁:把登入視窗那張卡(PROFILE.buildAuthCard)直接畫在頁面上,方便當連結分享。
   網址帶 ?mode=login 就開在登入分頁。已登入的人進來只看到身分與登出。 */
(function () {
  const TITLE = { signup: '註冊帳號', login: '登入', forgot: '重設密碼', sent: '驗證信已寄出' };

  document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('auth-root');
    const titleEl = document.getElementById('auth-title');
    if (!root) return;

    if (!window.CLOUD || !CLOUD.enabled) {
      root.append(h('p', null, '這個站目前沒開雲端帳號，練習進度只存在你自己的裝置上，不用註冊就能用。'),
        h('p', { style: 'margin-top:14px' }, h('a', { href: 'index.html' }, '回首頁開始練習')));
      return;
    }

    await CLOUD.ready;

    if (CLOUD.user) {
      titleEl.textContent = '已經登入';
      document.title = '已經登入|刷刷英文';
      root.append(h('div', { class: 'auth-signed' },
        h('div', null, CLOUD.nameOf(CLOUD.user), h('span', { style: 'color:var(--ink-light)' }, ' ' + (CLOUD.user.email || ''))),
        h('div', { class: 'auth-row' },
          h('a', { class: 'btn primary', href: 'index.html' }, '回首頁'),
          h('button', { class: 'btn', type: 'button', onclick: () => CLOUD.logout() }, '登出'))));
      return;
    }

    const start = getParam('mode') === 'login' ? 'login' : 'signup';
    root.append(PROFILE.buildAuthCard({
      mode: start,
      autofocus: false,
      backTo: 'index.html',
      onMode(m) {
        titleEl.textContent = TITLE[m] || TITLE.signup;
        document.title = titleEl.textContent + '|刷刷英文';
      },
    }));
  });
})();
