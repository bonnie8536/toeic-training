/* 課程頁的開關。要放在 js/cloud.js 前面載入(同 js/plans-config.js)。
   PACKS_UI:'off' 課程入口全部不出現;'pilot' 只給 PACKS_PILOT_CLASSES 裡的班;'on' 給所有登入的學生(之後全站開放才用)。
   PACKS_PILOT_CLASSES:試行班的班級 id(classes 表的 uuid)。只放 id,不放邀請碼(repo 是公開的)。
   名單是空的時候 'pilot' 等於沒有人看得到課程。 */
window.PACKS_UI = 'pilot';
window.PACKS_PILOT_CLASSES = ['bac28d3a-b2ff-4c2a-ae1c-ab168a0998bf'];
