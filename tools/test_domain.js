/* 網域開關(tools/domain.json + tools/apply_domain.js)與網址結構(js/courses.js)的測試(搬家計畫第一節、7.1、7.2)。
   - 現在的檔案跟 domain.json 一致(live 是 old 時整站照舊能部署在舊網址)。
   - 在記憶體裡切到 new:CNAME、canonical、og:url、結構化資料、sitemap、robots、Edge Function 的 LIVE 全部換成新網址,
     舊網域只剩「舊網址 shuashualanguage.com」的說明與兩邊都要在的網域清單;再切回 old 一個位元組都不差;重跑一次不再變。
   - 網頁與 js/ 裡新網域的絕對網址,只准出現在 canonical、og、結構化資料與網域清單(站內連結必須是相對路徑)。
   - courses.js:只有根目錄這門課是開的;保留的資料夾名稱沒被用掉;新課程的鍵有前綴,不會跟現在的鍵撞。
   用法:node tools/test_domain.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { transform, listFiles } = require('./apply_domain.js');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const CFG = JSON.parse(read('tools/domain.json'));
const files = {};
listFiles(REPO).forEach((rel) => { const f = path.join(REPO, rel); files[rel] = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; });
const apply = (fs0, cfg) => Object.assign({}, fs0, transform(fs0, cfg));

const T = {};
T['現在的檔案跟 domain.json 一致(live = ' + CFG.live + ')'] = () => {
  assert.deepEqual(Object.keys(transform(files, CFG)), []);
  assert.equal(files.CNAME.trim(), new URL(CFG.live === 'new' ? CFG.new : CFG.old).host);
};
/* 不管現在 domain.json 是 old 還是 new(切換的 commit 之後也要過):切到 new 再切回現在的設定,一個位元組都不差 */
T['切到 new:該換的全換成新網址,舊網域只剩說明文字;切回現在的設定一個位元組都不差;重跑不再變'] = () => {
  const toNew = apply(files, Object.assign({}, CFG, { live: 'new', switchDate: '2026-11-04' }));
  assert.equal(toNew.CNAME.trim(), 'www.rushuplanguage.com');
  assert.match(toNew['index.html'], /<link rel="canonical" href="https:\/\/www\.rushuplanguage\.com\/">/);
  assert.match(toNew['index.html'], /<meta property="og:url" content="https:\/\/www\.rushuplanguage\.com\/">/);
  assert.match(toNew['index.html'], /"url":"https:\/\/www\.rushuplanguage\.com\/"/);
  assert.match(toNew['robots.txt'], /Sitemap: https:\/\/www\.rushuplanguage\.com\/sitemap\.xml/);
  assert.equal((toNew['sitemap.xml'].match(/<loc>https:\/\/www\.rushuplanguage\.com\//g) || []).length, (files['sitemap.xml'].match(/<loc>/g) || []).length);
  assert.ok(toNew['sitemap.xml'].match(/<lastmod>[^<]+<\/lastmod>/g).every((x) => x === '<lastmod>2026-11-04</lastmod>'));
  assert.match(toNew['supabase/functions/_shared/site.ts'], /export const LIVE: 'old' \| 'new' = 'new';/);
  Object.keys(toNew).forEach((rel) => {
    const s = toNew[rel] || '';
    assert.equal(/https?:\/\/(www\.)?shuashualanguage\.com|www\.shuashualanguage\.com/.test(s.replace(/export const OLD_SITE = '[^']+';/, '')), false, rel + ' 還有舊網域');
  });
  assert.equal(transform(toNew, Object.assign({}, CFG, { live: 'new', switchDate: '2026-11-04' })).CNAME, undefined);
  const back = apply(toNew, CFG);
  Object.keys(files).filter((r) => r !== 'sitemap.xml' || CFG.live === 'new').forEach((rel) => assert.equal(back[rel], files[rel], rel + ' 切回去不一樣'));
  const toOld = apply(files, Object.assign({}, CFG, { live: 'old' }));
  assert.equal(toOld.CNAME.trim(), 'www.shuashualanguage.com');
  assert.match(toOld['supabase/functions/_shared/site.ts'], /export const LIVE: 'old' \| 'new' = 'old';/);
};
T['客服信箱:改 domain.json 的 mail 再跑一次,js/checkout.js 與每一頁的信箱一起換'] = () => {
  const out = apply(files, Object.assign({}, CFG, { mail: 'help@example.test' }));
  assert.match(out['js/checkout.js'], /const MAIL = 'help@example\.test';/);
  Object.keys(out).forEach((rel) => assert.equal((out[rel] || '').indexOf(CFG.mail), -1, rel));
  assert.match(out['privacy.html'], /mailto:help@example\.test/);
};
T['站內連結是相對路徑:網頁與 js/ 裡新網域的絕對網址只在 canonical、og、結構化資料與網域清單'] = () => {
  const bad = [];
  const allowJs = ['js/move-config.js', 'js/app-shell.js'];
  const scan = (rel, src) => {
    src.split(/\r?\n/).forEach((line, i) => {
      if (!/https?:\/\/(www\.)?rushuplanguage\.com/.test(line)) return;   // 文字裡寫網域名稱可以,絕對網址才算
      if (/rel="canonical"|property="og:url"|"@type":"WebSite"/.test(line)) return;
      if (allowJs.indexOf(rel) > -1) return;
      bad.push(rel + ':' + (i + 1));
    });
  };
  const toNew = apply(files, Object.assign({}, CFG, { live: 'new' }));
  Object.keys(toNew).filter((r) => /\.html$/.test(r)).forEach((rel) => scan(rel, toNew[rel] || ''));
  fs.readdirSync(path.join(REPO, 'js')).filter((f) => /\.js$/.test(f)).forEach((f) => scan('js/' + f, read('js/' + f)));
  assert.deepEqual(bad, []);
  const rel = [];
  Object.keys(files).filter((r) => /\.html$/.test(r)).forEach((r) => {
    for (const m of (files[r] || '').matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/g)) if (/shuashualanguage|rushuplanguage/.test(m[1])) rel.push(r + ' ' + m[1]);
  });
  assert.deepEqual(rel, []);
};
T['四份網域清單一樣:js/move-config.js、sw.js、js/app-shell.js、tools/move-worker/worker.js,也跟 domain.json 一樣'] = () => {
  const cfg = read('js/move-config.js');
  const m = /PROD = \{ from: \['([^']+)'\], to: '([^']+)' \}/.exec(cfg);
  const local = /LOCAL = \{ from: \['([^']+)'\], to: '([^']+)' \}/.exec(cfg);
  assert.deepEqual([m[1], m[2]], [CFG.old, CFG.new]);
  assert.ok(read('sw.js').indexOf("const MOVE_FROM = ['" + CFG.old + "', '" + local[1] + "'];") > -1);
  const shell = read('js/app-shell.js');
  assert.ok(shell.indexOf("const MOVE_OLD = ['" + CFG.old + "', '" + local[1] + "'];") > -1);
  assert.ok(shell.indexOf("const MOVE_NEW = ['" + CFG.new + "', '" + local[2] + "'];") > -1);
  const wk = read('tools/move-worker/worker.js');
  assert.ok(wk.indexOf("const NEW = '" + CFG.new + "';") > -1 && wk.indexOf("const OLD_WWW = '" + new URL(CFG.old).host + "';") > -1);
  const site = read('supabase/functions/_shared/site.ts');
  assert.ok(site.indexOf("OLD_SITE = '" + CFG.old + "'") > -1 && site.indexOf("NEW_SITE = '" + CFG.new + "'") > -1);
};
T['manifest:id、scope、start_url 不帶網域,換網域不用改(以後的課程都在 / 底下,同一個 App)'] = () => {
  const mf = JSON.parse(read('manifest.json'));
  assert.equal(mf.id, '/index.html');
  assert.equal(mf.scope, '/');
  assert.equal(mf.start_url, './index.html');
  assert.equal(/shuashualanguage|rushuplanguage/.test(read('manifest.json')), false);
};

/* ---------- js/courses.js ---------- */
const C = (() => { const ctx = {}; ctx.window = ctx; vm.createContext(ctx); vm.runInContext(read('js/courses.js'), ctx); return ctx; })();
T['課程設定:只有根目錄這門課是開的;保留的資料夾名稱在根目錄沒被用掉'] = () => {
  const list = C.COURSES;
  assert.deepEqual(list.filter((c) => c.open).map((c) => c.id), ['zh-tw/english']);
  assert.equal(list[0].base, '/');
  assert.equal(list[0].keyPrefix, '');
  const reserved = C.COURSE_RULES.reservedRoots;
  const used = fs.readdirSync(REPO).filter((f) => reserved.indexOf(f.toLowerCase()) > -1);
  assert.deepEqual(used, []);
  list.slice(1).forEach((c) => assert.ok(reserved.indexOf(c.base.split('/')[1]) > -1, c.id));
};
T['課程設定:新課程的鍵有前綴、互不重複、加上最長的模組鍵還在雲端 100 字以內;不會被現在的搬家規則誤認'] = () => {
  const ctx = {}; vm.createContext(ctx); vm.runInContext(read('js/move-rules.js'), ctx);
  const prefixes = C.COURSES.map((c) => c.keyPrefix);
  assert.equal(new Set(prefixes).size, prefixes.length);
  C.COURSES.slice(1).forEach((c) => {
    assert.match(c.keyPrefix, /^[a-z-]+\.[a-z]+\.$/);
    assert.ok((c.keyPrefix + 'read_tq_art-100b').length <= 100);
    assert.equal(ctx.MOVE_RULES.classify('tr_' + c.keyPrefix + 'hist', new Set()).kind, 'unknown');
  });
  assert.equal(C.courseFor('/grammar.html').id, 'zh-tw/english');
  assert.equal(C.courseFor('/ja/english/grammar.html').id, 'ja/english');
  assert.equal(C.courseFor('/zh-tw/japanese/').id, 'zh-tw/japanese');
};
T['hreflang:現在只有一個介面語言開著,不產生任何 hreflang;頁面上也沒有'] = () => {
  assert.deepEqual(Array.from(C.hreflangFor('/grammar.html', 'https://www.rushuplanguage.com')), []);
  const pages = fs.readdirSync(REPO).filter((f) => /\.html$/.test(f));
  assert.deepEqual(pages.filter((f) => /hreflang/.test(read(f))), []);
  const fake = [{ id: 'zh-tw/english', base: '/', ui: 'zh-Hant-TW', target: 'en', keyPrefix: '', open: true },
    { id: 'ja/english', base: '/ja/english/', ui: 'ja', target: 'en', keyPrefix: 'ja.english.', open: true },
    { id: 'zh-tw/japanese', base: '/zh-tw/japanese/', ui: 'zh-Hant-TW', target: 'ja', keyPrefix: 'zh-tw.japanese.', open: true }];
  const links = Array.from(C.hreflangFor('/grammar.html', 'https://www.rushuplanguage.com', fake)).map((l) => l.lang + ' ' + l.href);
  assert.deepEqual(links, ['zh-Hant-TW https://www.rushuplanguage.com/grammar.html', 'ja https://www.rushuplanguage.com/ja/english/grammar.html', 'x-default https://www.rushuplanguage.com/grammar.html']);
};
T['原名:Bonnie 說原名不用加(2026-10-23)——頁尾只寫「衝衝英文由個人經營」,JSON-LD 只列 Rushup;舊網址的搬家提示才說改名'] = () => {
  const pages = Object.keys(files).filter((rel) => /^[^/]+[.]html$/.test(rel) && files[rel] && /由個人經營/.test(files[rel]));
  assert.ok(pages.length >= 25, '有頁尾的頁面太少:' + pages.length);
  pages.forEach((rel) => {
    assert.equal(files[rel].indexOf('原名'), -1, rel + ' 寫了原名');
    assert.ok(files[rel].split('<footer').slice(1).join('<footer').indexOf('衝衝英文由個人經營') > -1, rel + ' 的頁尾沒寫站名');
  });
  assert.ok(files['index.html'].indexOf('"alternateName":"Rushup"') > -1, 'index.html 的 JSON-LD 只列 Rushup');
  assert.equal(files['index.html'].indexOf('"alternateName":["Rushup","刷刷英文"]'), -1);
  assert.ok(read('js/move-out.js').indexOf('拍謝！我們換網址了，因為名字跟別人重疊！') > -1);
  assert.ok(read('js/move-out-page.js').indexOf('拍謝！我們換網址了，因為名字跟別人重疊！') > -1);
};

let pass = 0;
const names = Object.keys(T);
for (const n of names) {
  try { T[n](); pass++; console.log('PASS ' + n); }
  catch (e) { console.log('FAIL ' + n + '  →  ' + (e && e.message)); }
}
console.log(pass + ' / ' + names.length + ' 通過');
process.exit(pass === names.length ? 0 : 1);
