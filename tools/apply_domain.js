/* 網站現在掛在哪個網域,只看 tools/domain.json 這一個開關(搬家計畫 1.4、7.1 第 2 項、7.2 第 3 項)。
   live 是 'old' 時,整個網站照舊部署在 www.shuashualanguage.com;切換那一個 commit 只做兩件事:
   把 live 改成 'new'(switchDate 填切換日),再跑 node tools/apply_domain.js,一起改掉:
     CNAME、每一頁的 canonical、og:url、og:image、首頁結構化資料的網址、頁面文字裡的「www.<網域>」、sitemap.xml 的網址、
     robots.txt 的 Sitemap、supabase/functions/_shared/site.ts 的 LIVE。
   mail 是客服信箱:改了它再跑一次,js/checkout.js 的 MAIL 與每一頁的信箱一起換(新信箱定了才改)。
   sitemap.xml 的 lastmod 不在這裡改(以前會一律蓋成 switchDate,Google 看到日期不準會整份不採用);
   切換後跑 node tools/build_sitemap.js,日期照各頁實際改動。
   不會改:js/move-config.js、sw.js、js/app-shell.js、tools/move-worker/worker.js 裡的兩個網域清單(兩邊都要在),
   以及文字裡不帶 www 的「舊網址 shuashualanguage.com」說明。
   用法:
     node tools/apply_domain.js           照 domain.json 改檔案,列出改了哪些
     node tools/apply_domain.js --check   只檢查,有不一致就 exit 1(check_release.js 會跑)
     node tools/apply_domain.js --root <資料夾>  改別的資料夾(測試用) */
'use strict';
const fs = require('fs');
const path = require('path');

const host = (u) => new URL(u).host;

function read(root, rel) { const f = path.join(root, rel); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; }

/* 純函式:{ 相對路徑: 內容 } → 改過的 { 相對路徑: 內容 }(沒變的不回) */
function transform(files, cfg) {
  if (cfg.live !== 'old' && cfg.live !== 'new') throw new Error('domain.json 的 live 只能是 old 或 new');
  const live = cfg.live === 'new' ? cfg.new : cfg.old;
  const other = cfg.live === 'new' ? cfg.old : cfg.new;
  const liveHost = host(live), otherHost = host(other);
  const checkout = files['js/checkout.js'];
  const curMail = checkout ? (/const MAIL = '([^']+)';/.exec(checkout) || [])[1] : null;
  const out = {};
  const put = (rel, s) => { if (s !== files[rel]) out[rel] = s; };
  const swapMail = (s) => (curMail && cfg.mail && curMail !== cfg.mail ? s.split(curMail).join(cfg.mail) : s);
  Object.keys(files).forEach((rel) => {
    const src = files[rel];
    if (src === null || src === undefined) return;
    if (rel === 'CNAME') return put(rel, src.trim() ? src.replace(src.trim(), liveHost) : liveHost + '\n');   // 原本的換行照留
    if (/\.html$/.test(rel) && rel.indexOf('/') < 0) return put(rel, swapMail(src.split('https://' + otherHost).join('https://' + liveHost).split('www.' + otherHost.replace(/^www\./, '')).join(liveHost)));
    if (rel === 'sitemap.xml') return put(rel, src.split(other).join(live));   // lastmod 不動,交給 tools/build_sitemap.js
    if (rel === 'robots.txt') return put(rel, src.split(other).join(live));
    if (rel === 'supabase/functions/_shared/site.ts') return put(rel, src.replace(/export const LIVE: 'old' \| 'new' = '(old|new)';/, "export const LIVE: 'old' | 'new' = '" + cfg.live + "';"));
    if (rel === 'js/checkout.js') return put(rel, swapMail(src));
  });
  return out;
}

function listFiles(root) {
  const top = fs.readdirSync(root).filter((f) => /\.html$/.test(f));
  return top.concat(['CNAME', 'sitemap.xml', 'robots.txt', 'supabase/functions/_shared/site.ts', 'js/checkout.js']);
}

function run(root, check) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'domain.json'), 'utf8'));
  const files = {};
  listFiles(root).forEach((rel) => { files[rel] = read(root, rel); });
  const changed = transform(files, cfg);
  if (!check) Object.keys(changed).forEach((rel) => fs.writeFileSync(path.join(root, rel), changed[rel]));
  return { cfg, changed: Object.keys(changed) };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--root');
  const root = path.resolve(i > -1 ? args[i + 1] : path.join(__dirname, '..'));
  const check = args.includes('--check');
  const r = run(root, check);
  const where = r.cfg.live === 'new' ? r.cfg.new : r.cfg.old;
  if (check) {
    if (r.changed.length) { console.log('網域設定是 ' + r.cfg.live + '(' + where + '),這些檔案還沒跟上:' + r.changed.join('、') + '。執行 node tools/apply_domain.js'); process.exit(1); }
    console.log('網域一致:' + where);
  } else console.log(r.changed.length ? '改了 ' + r.changed.length + ' 個檔案(' + where + '):' + r.changed.join('、') : '不用改,已經是 ' + where);
}

module.exports = { transform, run, listFiles };
