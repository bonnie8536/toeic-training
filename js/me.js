/* 「我的」頁:雲端模式交給 PROFILE.renderAccount;本機模式只放連結與切換學生 */
document.addEventListener('DOMContentLoaded', async () => {
  const root = $('#me-root');
  if (!root || !window.PROFILE) return;
  if (window.CLOUD && CLOUD.enabled) {
    await CLOUD.ready;
    if (PROFILE.renderAccount) PROFILE.renderAccount(root);
    return;
  }
  const cur = PROFILE.current();
  root.append(h('ul', { class: 'me-list' },
    cur ? h('li', null, h('a', { class: 'me-row', href: 'analysis.html' }, '能力分析')) : null,
    cur ? h('li', null, h('a', { class: 'me-row', href: 'history.html' }, '學習記錄')) : null,
    h('li', null, h('button', { class: 'me-row', type: 'button', onclick: () => PROFILE.showGate(true) }, '切換學生'))));
});
