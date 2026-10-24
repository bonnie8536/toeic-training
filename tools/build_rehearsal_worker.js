/* 真機演練用的 Worker(搬家計畫 7.4 最後一項、步驟_真機演練.md 第七節):把 tools/move-worker/worker.js 的三個網域常數換成演練用的,
   讓 PHASE A 的代理在真的 Cloudflare 上先跑一次(代理網頁與檔案、伺服器寫的 tr_hd 與 tr_moved cookie、iPhone 音檔的 Range、
   轉址改寫、新網址憑證不對時的 503 維護頁),不動正式網域。
   用法:node tools/build_rehearsal_worker.js --old <Worker 的 workers.dev 主機名稱> --new https://<新的演練網址> --out <檔案>
   例:--old rushup-move-worker.example.workers.dev --new https://rushup-move-new.pages.dev
   憑證不對的演練:--new https://wrong.host.badssl.com(這個公開測試網站故意用不對的憑證),打開 Worker 網址應該看到「網站正在搬家」。 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'move-worker', 'worker.js');

/* 換掉 NEW、NEW_HOST、OLD_WWW 三行;其他一個字都不改。找不到要換的地方就丟錯(正式程式改了格式時不會默默做出錯的演練版) */
function build(src, opt) {
  const old = String(opt.old || ''), neu = String(opt.new || '').replace(/\/+$/, '');
  if (!/^[a-z0-9.-]+$/.test(old) || !/^https:\/\/[a-z0-9.-]+$/.test(neu)) throw new Error('--old 要是主機名稱(不帶 https://),--new 要是 https:// 開頭的網址');
  const host = neu.slice('https://'.length);
  if (host === old) throw new Error('--old 與 --new 不能一樣');
  let out = src;
  const swap = (re, line) => { if (!re.test(out)) throw new Error('worker.js 找不到:' + re); out = out.replace(re, () => line); };
  swap(/^const NEW = '[^']+';$/m, "const NEW = '" + neu + "';");
  swap(/^const NEW_HOST = '[^']+';$/m, "const NEW_HOST = '" + host + "';");
  swap(/^const OLD_WWW = '[^']+';$/m, "const OLD_WWW = '" + old + "';");
  swap(/^const PHASE = '[AB]';$/m, "const PHASE = 'A';");
  return '/* 演練用,不要貼到正式的 Worker。由 tools/build_rehearsal_worker.js 產生。 */\n' + out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : ''; };
  const out = arg('--out');
  if (!out) { console.error('用法:node tools/build_rehearsal_worker.js --old <workers.dev 主機名稱> --new https://<新的演練網址> --out <檔案>'); process.exit(2); }
  try {
    fs.writeFileSync(out, build(fs.readFileSync(SRC, 'utf8'), { old: arg('--old'), new: arg('--new') }));
    console.log('寫好了:' + out);
  } catch (e) { console.error(e.message); process.exit(2); }
}

module.exports = { build };
