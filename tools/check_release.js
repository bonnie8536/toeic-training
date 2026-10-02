/* 上線前檢查:這次改到網頁會用到的檔案(html、js、css、json、data),sw.js 的 V 就要換新。
   service worker 的快取以檔名為準,共用的 JS、CSS 只留最後抓到的那一版;V 不換,離線或慢網路時
   可能拿新版共用檔配舊版頁面。V 一換,舊快取整批作廢。
   用法(跟 origin/main 比,先 git pull 或 git fetch):
     node tools/check_release.js        只檢查,需要換 V 就 exit 1
     node tools/check_release.js --fix  需要的話自動把 V 換成新的版本號 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SW = path.join(REPO, 'sw.js');
const FIX = process.argv.includes('--fix');
const git = (cmd) => execSync('git ' + cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const vOf = (src) => { const m = /const V = '([^']+)';/.exec(src || ''); return m ? m[1] : null; };

let baseSw = null;
try { baseSw = git('show origin/main:sw.js'); } catch (e) { /* 線上還沒有 service worker */ }
const changed = new Set([
  ...git('diff --name-only origin/main').split('\n'),
  ...git('ls-files --others --exclude-standard').split('\n'),
].map((s) => s.trim()).filter(Boolean));
const web = [...changed].filter((f) => /\.(html|js|css|json|webmanifest)$/i.test(f) && !/^tools\//.test(f) && f !== 'sw.js');

const oldV = vOf(baseSw);
const newV = vOf(fs.readFileSync(SW, 'utf8'));
if (!newV) { console.error('sw.js 裡找不到 const V'); process.exit(2); }

if (!oldV) { console.log('線上還沒有 sw.js,不用換 V(目前 ' + newV + ')'); process.exit(0); }
if (!web.length) { console.log('這次沒有改到網頁檔案,V 不用換(' + newV + ')'); process.exit(0); }
if (newV !== oldV) { console.log('改到 ' + web.length + ' 個網頁檔案,V 已換新:' + oldV + ' → ' + newV); process.exit(0); }

if (!FIX) {
  console.log('改到 ' + web.length + ' 個網頁檔案(' + web.slice(0, 5).join('、') + (web.length > 5 ? '…' : '') + '),但 sw.js 的 V 還是 ' + oldV + '。');
  console.log('執行 node tools/check_release.js --fix 換新。');
  process.exit(1);
}
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const next = 'v' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
const src = fs.readFileSync(SW, 'utf8');
fs.writeFileSync(SW, src.replace("const V = '" + oldV + "';", "const V = '" + next + "';"));
console.log('V 已換新:' + oldV + ' → ' + next);
