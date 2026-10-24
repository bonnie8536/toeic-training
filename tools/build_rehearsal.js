/* 真機演練用的網站(搬家計畫 7.4 最後一項):把網站複製一份,網域清單換成兩個演練用的網址,
   放到 Cloudflare Pages 的兩個專案(一個當舊網址、一個當新網址,上傳同一個資料夾)。不動正式網域。
   用法:node tools/build_rehearsal.js --old https://<舊>.pages.dev --new https://<新>.pages.dev --out <資料夾>
   會改的:js/move-config.js 的 PROD、js/app-shell.js 的 MOVE_OLD 與 MOVE_NEW 第一個網址;加 _headers 讓 move-ping.txt 可以跨網域讀。
   不改 sw.js:Cloudflare Pages 會把 /grammar.html 轉到 /grammar,service worker 的轉址期邏輯在演練網址上會誤觸,所以演練網址上它是關的
   (那一段由 tools/test_sw.js 測)。不複製 tools/、supabase/、說明文件、CNAME;音檔只放 audio/ 排序後的前 20 個(Cloudflare 後台拖曳上傳最多 1000 個檔案)。步驟在 D:/claudecode/刷刷英文開發/搬家/步驟_真機演練.md。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : ''; };
const OLD = arg('--old').replace(/\/+$/, ''), NEW = arg('--new').replace(/\/+$/, ''), OUT = arg('--out');
if (!/^https:\/\/[a-z0-9.-]+$/.test(OLD) || !/^https:\/\/[a-z0-9.-]+$/.test(NEW) || OLD === NEW || !OUT) {
  console.error('用法:node tools/build_rehearsal.js --old https://<舊>.pages.dev --new https://<新>.pages.dev --out <資料夾>');
  process.exit(2);
}
const files = execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean)
  .concat(execFileSync('git', ['-C', REPO, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean))
  .filter((f) => !/^(tools|supabase|\.github|\.claude)\//.test(f) && !/\.md$/i.test(f) && f !== 'CNAME' && !/^\./.test(f));
const extraAudio = new Set(files.filter((f) => /^audio\//.test(f)).sort().slice(20));
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const f of [...new Set(files)]) {
  const src = path.join(REPO, f);
  if (extraAudio.has(f) || !fs.existsSync(src)) continue;
  const dst = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  n++;
}
function edit(rel, re, to) {
  const p = path.join(OUT, rel);
  const s = fs.readFileSync(p, 'utf8');
  if (!re.test(s)) throw new Error(rel + ' 找不到要換的地方');
  fs.writeFileSync(p, s.replace(re, to));
}
edit('js/move-config.js', /const PROD = \{ from: \['[^']+'\], to: '[^']+' \};/, "const PROD = { from: ['" + OLD + "'], to: '" + NEW + "' };");
edit('js/move-config.js', /oldName: '[^']+'/, "oldName: '" + new URL(OLD).host + "'");
edit('js/move-config.js', /newName: '[^']+'/, "newName: '" + new URL(NEW).host + "'");
edit('js/app-shell.js', /const MOVE_OLD = \['[^']+'/, "const MOVE_OLD = ['" + OLD + "'");
edit('js/app-shell.js', /const MOVE_NEW = \['[^']+'/, "const MOVE_NEW = ['" + NEW + "'");
fs.writeFileSync(path.join(OUT, '_headers'), '/move-ping.txt\n  Access-Control-Allow-Origin: *\n  Cache-Control: no-store\n');
if (n > 1000) console.log('注意:檔案超過 1000 個,Cloudflare 後台拖曳上傳會失敗。');
console.log('複製了 ' + n + ' 個檔案到 ' + OUT + '。舊 ' + OLD + ',新 ' + NEW + '。兩個 Pages 專案都上傳這整個資料夾。');
