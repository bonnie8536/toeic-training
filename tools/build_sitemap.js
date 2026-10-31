/* 產生 sitemap.xml:要給 Google 收錄的頁面,加上文法、自然發音、閱讀、對話的每一個單元網址。
   - 哪些頁收錄:根目錄的 .html,沒有 <meta name="robots" content="noindex"> 的(404.html 除外)。
   - 單元網址:從 data/ 的資料檔讀 id,網址格式跟頁面上的連結一樣(grammar.html?u=ga-01 這類),
     頁面上的 canonical 由 js/common.js 的 setPageMeta 寫成同一個網址。
   - lastmod:這一頁的 HTML、它載入的資料檔(data/*.js)、它自己的 js/<頁名>.js 裡最後一次 commit 的日期;
     這些檔案還沒 commit 就用今天。共用的程式(common.js、cloud.js、寵物……)改了不算內容改變,不更新日期。
     Google 只在 lastmod 一直準確時才採用,所以不要手改、也不要一次全蓋成同一天。
   - 網域照 tools/domain.json 的 live。
   用法:
     node tools/build_sitemap.js          重新產生 sitemap.xml
     node tools/build_sitemap.js --check  只檢查,跟現在的 sitemap.xml 不一樣就 exit 1(check_release.js 會跑) */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const NOINDEX = /<meta name="robots" content="noindex">/;

/* 單元頁:頁面 → 資料檔、資料在 window 上的位置、網址參數 */
const UNIT_PAGES = {
  'grammar.html': { data: 'data/grammar.js', pick: (w) => w.TOEIC.grammar, param: 'u', extra: ['ref=verbs', 'ref=tenses'] },
  'phonics.html': { data: 'data/phonics.js', pick: (w) => w.TOEIC.phonics, param: 'u', extra: ['ref=chart'] },
  'reading.html': { data: 'data/articles.js', pick: (w) => w.TOEIC.articles, param: 'id', extra: [] },
  'dialogue.html': { data: 'data/dialogues.js', pick: (w) => w.TOEIC_DIALOGUES, param: 'id', extra: [] },
};

/* 首頁排第一,其他照網站導覽的順序;沒列到的頁照檔名排在後面 */
const ORDER = ['index.html', 'diagnostic.html', 'grammar.html', 'phonics.html', 'vocab.html', 'listening.html', 'reading.html',
  'dialogue.html', 'writing.html', 'practice.html', 'mock.html', 'daily.html', 'signup.html', 'pricing.html', 'terms.html', 'privacy.html', 'refund.html'];

function indexablePages(root) {
  return fs.readdirSync(root).filter((f) => /\.html$/.test(f) && f !== '404.html' && !NOINDEX.test(read(root, f)))
    .sort((a, b) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || (a < b ? -1 : a > b ? 1 : 0);
    });
}

function unitIds(root, page) {
  const u = UNIT_PAGES[page];
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(root, u.data), ctx);
  const ids = (u.pick(ctx) || []).map((x) => x.id);
  if (!ids.length) throw new Error(u.data + ' 讀不到任何單元');
  return ids.map((id) => u.param + '=' + encodeURIComponent(id)).concat(u.extra);
}

/* 決定這一頁內容的檔案:HTML、它載入的 data/*.js、js/<頁名>.js(聽力頁的程式叫 ear.js,也照 data/ 的檔名找) */
function contentFiles(root, page) {
  const html = read(root, page);
  const data = Array.from(html.matchAll(/<script src="(data\/[^"]+\.js)"/g)).map((m) => m[1]);
  const own = [page.replace(/\.html$/, '')].concat(data.map((d) => path.basename(d, '.js')))
    .map((n) => 'js/' + n + '.js').filter((f) => fs.existsSync(path.join(root, f)));
  return [page].concat(data, own).filter((f, i, a) => a.indexOf(f) === i);
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* 這些檔案的內容最後一次改動的日期:有沒 commit 的改動就是今天,否則是最後一次 commit 的日期 */
function lastmodOf(root, files, now) {
  const git = (args) => execFileSync('git', ['-C', root].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (git(['status', '--porcelain', '--'].concat(files))) return now;
  const d = git(['log', '-1', '--format=%cs', '--'].concat(files));
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : now;
}

function build(root, opts) {
  const o = opts || {};
  const cfg = JSON.parse(read(root, 'tools/domain.json'));
  const live = cfg.live === 'new' ? cfg.new : cfg.old;
  const now = o.today || today();
  const dateOf = o.lastmod || ((files) => lastmodOf(root, files, now));
  const rows = [];
  indexablePages(root).forEach((page) => {
    const mod = dateOf(contentFiles(root, page));
    const loc = live + '/' + (page === 'index.html' ? '' : page);
    rows.push({ loc, mod });
    if (UNIT_PAGES[page]) unitIds(root, page).forEach((q) => rows.push({ loc: live + '/' + page + '?' + q, mod }));
  });
  const esc = (s) => s.replace(/&/g, '&amp;');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows.map((r) => '  <url><loc>' + esc(r.loc) + '</loc><lastmod>' + r.mod + '</lastmod></url>\n').join('') + '</urlset>\n';
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = path.join(REPO, 'sitemap.xml');
  const next = build(REPO);
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const n = (next.match(/<url>/g) || []).length;
  if (args.includes('--check')) {
    if (cur.replace(/\r\n/g, '\n') !== next) { console.log('sitemap.xml 跟頁面、資料或改動日期對不上。執行 node tools/build_sitemap.js'); process.exit(1); }
    console.log('sitemap.xml 是最新的(' + n + ' 個網址)');
  } else {
    if (cur.replace(/\r\n/g, '\n') === next) console.log('sitemap.xml 不用改(' + n + ' 個網址)');
    else { fs.writeFileSync(file, next); console.log('sitemap.xml 已更新:' + n + ' 個網址'); }
  }
}

module.exports = { build, indexablePages, unitIds, contentFiles, UNIT_PAGES };
