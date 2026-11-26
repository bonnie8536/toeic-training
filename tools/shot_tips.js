/* 技巧卡在上課頁的截圖(tools/lesson_e2e_kit.js:真的頁面、假雲端、假時鐘,不連外網、不用真的帳號)。
   門檻試行生上到第 5 堂、第 7 堂的第一張技巧卡照頁面走到再截;--ids 給的卡放進第 5 堂技巧卡的位置各截一張(還沒開放的堂先看長相)。
   每張存 375 與 1280 兩張,檔名「技巧卡_<id>_<寬>.png」;卡片不在 data/tips.js 時停下來、exit 1。
   用法:node tools/shot_tips.js --shots <截圖資料夾> [--ids <卡片 id,幾張用逗號分開>] [--port <起始埠,用三個>] [--tmp <放 Chrome 使用者資料的資料夾>]
   Chrome 使用者資料每次一個新的資料夾,跑完刪掉。 */
'use strict';
const os = require('os');
const path = require('path');
const X = require('./lesson_e2e_kit.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const PORT = Number(opt('--port')) || 8991;
const SHOTS = opt('--shots');
const IDS = (opt('--ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
const LV = { listening: 'threshold', reading: 'threshold' };

/* 門檻試行生:前 done 堂上完,開第 no 堂走到第一張技巧卡 */
async function toTip(n, done, no) {
  const c = X.freshCloud();
  const u = X.user(n, '試行生');
  X.pilotUser(c, u, LV);
  await X.seedDone(c, u, LV, done);
  const p = await X.tab(u, { mobile: true, url: 'lesson.html?no=' + no });
  await p.wait("document.querySelector('.lsn-steps')", '第 ' + no + ' 堂總覽');
  await X.drive(p, { goOn: true, until: (s) => s === 'tip' });
  await p.eval('window.scrollTo(0, 0); true');   // 走到這裡時頁面捲過,截圖從頁首開始
  return p;
}
const shownId = (p) => p.eval("(() => { const h = document.querySelector('.lsn-tip-h'); const c = h && window.TIP_CARDS.cards.filter((x) => x.title === h.textContent.trim())[0]; return c ? c.id : null; })()");

/* 把畫面上的技巧卡換成指定的卡(用上課頁自己的畫法) */
async function swapTo(p, id) {
  const ok = await p.eval('(() => { const old = document.querySelector(".lsn-tip"); const n = window.LESSON_VIEWS.tip(' + X.J(id) + ', { no: 5 });'
    + ' if (!old || !n) return false; old.replaceWith(n); window.scrollTo(0, 0); return true; })()');
  if (!ok) throw new Error('畫不出技巧卡 ' + id + '(data/tips.js 沒有這張?)');
}

async function main() {
  if (!SHOTS) throw new Error('要給 --shots <截圖資料夾>');
  X.configure({ port: PORT, debug: PORT + 2, tmp: path.resolve(opt('--tmp') || os.tmpdir()), shots: path.resolve(SHOTS) });
  await X.start();
  try {
    const p5 = await toTip(901, 4, 5);
    await X.shot(p5, '技巧卡_' + (await shownId(p5)));
    for (const id of IDS) { await swapTo(p5, id); await X.shot(p5, '技巧卡_' + id); }
    X.noErrors(p5, '第 5 堂');
    const p7 = await toTip(902, 6, 7);
    await X.shot(p7, '技巧卡_' + (await shownId(p7)));
    X.noErrors(p7, '第 7 堂');
    console.log('截了 ' + Object.keys(X.NAMES).length + ' 張卡:' + Object.keys(X.NAMES).join('、'));
  } finally {
    await X.closeAll();
    await X.stop();
  }
}
main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
