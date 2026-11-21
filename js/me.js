/* 「我的」頁:內容由 PROFILE.renderAccount 畫(js/profile.js)。雲端模式等登入狀態確認之後再畫;本機模式直接畫 */
document.addEventListener('DOMContentLoaded', async () => {
  const root = $('#me-root');
  if (!root || !window.PROFILE || typeof PROFILE.renderAccount !== 'function') return;
  if (window.CLOUD && CLOUD.enabled) await CLOUD.ready;
  PROFILE.renderAccount(root);
});
