/* 搜尋引擎相關的檢查(2026-10-31 SEO 稽核):每一頁的標題、說明、canonical、分享預覽、首頁結構化資料、sitemap、404。
   - 每頁:有 lang、title 帶站名;noindex 的頁不寫 canonical(轉址用的 tenses、verbs 除外)。
   - 要收錄的頁:說明 80 字內;og 一組(title/description/url/site_name/locale/image)＋twitter:card;
     canonical 跟 og:url 一樣。文法、自然發音、閱讀、對話四頁的 canonical 由 js/common.js 的 setPageMeta 依網址寫,HTML 不寫死。
   - setPageMeta:網域取 og:url(所以舊網址代理時也指新網址),單元網址只留決定內容的參數,重複呼叫不會疊加。
   - 首頁:WebSite 與 Organization 結構化資料,alternateName 只有 Rushup;h1 有站名;沒有過期的日期公告。
   - sitemap.xml 跟 tools/build_sitemap.js 產生的一樣:每個要收錄的頁加上每個單元,沒有 noindex 的頁。
   - 404.html:noindex、連結與樣式用 / 開頭(網址可能在任何一層)、不含 GitHub 的「Site not found」字樣(Worker 靠它判斷新網址掛了)。
   用法:node tools/test_seo.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const SM = require('./build_sitemap.js');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const CFG = JSON.parse(read('tools/domain.json'));
const LIVE = CFG.live === 'new' ? CFG.new : CFG.old;
const PAGES = fs.readdirSync(REPO).filter((f) => /\.html$/.test(f));
const NOINDEX = /<meta name="robots" content="noindex">/;
const JS_CANONICAL = ['grammar.html', 'phonics.html', 'reading.html', 'dialogue.html'];
const REDIRECT_STUBS = ['tenses.html', 'verbs.html'];
const head = (f) => read(f).split('</head>')[0];
const meta = (src, attr, name) => { const m = new RegExp('<meta ' + attr + '="' + name + '" content="([^"]*)">').exec(src); return m ? m[1] : null; };
const canonicalOf = (src) => { const m = /<link rel="canonical" href="([^"]+)">/.exec(src); return m ? m[1] : null; };
const indexable = PAGES.filter((f) => f !== '404.html' && !NOINDEX.test(read(f)));

const T = {};
T['每一頁:lang 是 zh-Hant、title 帶站名「衝衝英文」'] = () => {
  PAGES.forEach((f) => {
    assert.match(read(f), /<html lang="zh-Hant">/, f);
    assert.match(head(f), /<title>[^<]*衝衝英文[^<]*<\/title>/, f);
  });
};
T['noindex 的頁不寫 canonical(訊號互相矛盾);轉址用的 tenses、verbs 指向文法頁裡的同一張表'] = () => {
  PAGES.filter((f) => NOINDEX.test(read(f))).forEach((f) => {
    if (REDIRECT_STUBS.indexOf(f) > -1) assert.equal(canonicalOf(head(f)), LIVE + '/grammar.html?ref=' + f.replace('.html', ''), f);
    else assert.equal(canonicalOf(head(f)), null, f + ' 是 noindex 又寫了 canonical');
  });
  assert.ok(NOINDEX.test(read('analysis.html')), 'analysis.html 是個人分析頁,不收錄');
};
T['要收錄的頁:說明 80 字內;og 一組與 twitter:card 都有;canonical 跟 og:url 一樣(四個單元頁由 JS 寫)'] = () => {
  assert.ok(indexable.length >= 17, '要收錄的頁太少:' + indexable.length);
  indexable.forEach((f) => {
    const s = head(f);
    const desc = meta(s, 'name', 'description');
    assert.ok(desc && desc.length <= 80, f + ' 說明 ' + (desc || '').length + ' 字');
    ['og:type', 'og:title', 'og:description', 'og:url', 'og:site_name', 'og:locale', 'og:image'].forEach((p) => assert.ok(meta(s, 'property', p), f + ' 沒有 ' + p));
    assert.equal(meta(s, 'property', 'og:site_name'), '衝衝英文', f);
    assert.equal(meta(s, 'property', 'og:locale'), 'zh_TW', f);
    assert.equal(meta(s, 'property', 'og:description'), desc, f + ' og:description 跟 description 不一樣');
    assert.equal(meta(s, 'property', 'og:image'), LIVE + '/img/icon-512.png', f);
    assert.equal(meta(s, 'name', 'twitter:card'), 'summary', f);
    const url = meta(s, 'property', 'og:url');
    assert.equal(url, LIVE + '/' + (f === 'index.html' ? '' : f), f + ' og:url');
    if (JS_CANONICAL.indexOf(f) > -1) {
      assert.equal(canonicalOf(s), null, f + ' 的 canonical 要由 JS 依網址寫,HTML 不能寫死');
      assert.match(read(f), /<script src="js\/common\.js"><\/script>/, f);
      assert.match(read('js/' + (f === 'reading.html' ? 'reading' : f.replace('.html', '')) + '.js'), /setPageMeta\(/, f);
    } else assert.equal(canonicalOf(s), url, f + ' canonical');
  });
  assert.ok(fs.existsSync(path.join(REPO, 'img/icon-512.png')));
};

/* 在假的 document 上跑 js/common.js 的 setPageMeta */
function fakeDoc(ogUrl, desc) {
  const els = [];
  const mk = (tag, attrs) => {
    const e = { tagName: tag, attrs: Object.assign({}, attrs), dataset: {},
      getAttribute: (k) => (k in e.attrs ? e.attrs[k] : null), setAttribute: (k, v) => { e.attrs[k] = String(v); } };
    Object.defineProperty(e, 'rel', { get: () => e.attrs.rel, set: (v) => { e.attrs.rel = v; } });
    Object.defineProperty(e, 'href', { get: () => e.attrs.href, set: (v) => { e.attrs.href = v; } });
    return e;
  };
  els.push(mk('meta', { property: 'og:url', content: ogUrl }), mk('meta', { name: 'description', content: desc }), mk('meta', { property: 'og:description', content: desc }));
  const match = (e, sel) => {
    const m = /^(\w+)\[(\w+)="([^"]+)"\]$/.exec(sel);
    return m && e.tagName === m[1] && e.attrs[m[2]] === m[3];
  };
  const doc = {
    els,
    querySelector: (sel) => els.find((e) => match(e, sel)) || null,
    querySelectorAll: (sel) => els.filter((e) => match(e, sel)),
    createElement: (tag) => mk(tag, {}),
    head: { append: (e) => els.push(e) },
  };
  return doc;
}
/* common.js 開頭會掛事件、讀 localStorage;這裡只取出 setPageMeta 這一個函式來跑 */
function runCommon(doc) {
  const m = /\r?\nfunction setPageMeta\([\s\S]*?\r?\n\}\r?\n/.exec(read('js/common.js'));
  assert.ok(m, 'js/common.js 裡找不到 setPageMeta');
  const ctx = { document: doc };
  vm.createContext(ctx);
  vm.runInContext(m[0] + ';this.setPageMeta = setPageMeta;', ctx);
  return ctx;
}
T['setPageMeta:canonical 與 og:url 用 og:url 的網域;單元只留參數;重複呼叫不疊加;說明跟著換'] = () => {
  const doc = fakeDoc('https://www.rushuplanguage.com/grammar.html', '文法課');
  const ctx = runCommon(doc);
  assert.equal(typeof ctx.setPageMeta, 'function');
  ctx.setPageMeta('u=ga-01', '看到常見的名詞都能寫出它的複數。');
  const can = () => doc.querySelectorAll('link[rel="canonical"]');
  assert.equal(can().length, 1);
  assert.equal(can()[0].href, 'https://www.rushuplanguage.com/grammar.html?u=ga-01');
  assert.equal(doc.querySelector('meta[property="og:url"]').getAttribute('content'), 'https://www.rushuplanguage.com/grammar.html?u=ga-01');
  assert.equal(doc.querySelector('meta[name="description"]').getAttribute('content'), '看到常見的名詞都能寫出它的複數。');
  assert.equal(doc.querySelector('meta[property="og:description"]').getAttribute('content'), '看到常見的名詞都能寫出它的複數。');
  ctx.setPageMeta('u=ga-02');
  assert.equal(can().length, 1);
  assert.equal(can()[0].href, 'https://www.rushuplanguage.com/grammar.html?u=ga-02');
  ctx.setPageMeta('');
  assert.equal(can()[0].href, 'https://www.rushuplanguage.com/grammar.html');
  assert.equal(doc.querySelector('meta[name="description"]').getAttribute('content'), '看到常見的名詞都能寫出它的複數。', '沒給說明就不動');
  const none = fakeDoc('', '');
  none.els.length = 0;
  runCommon(none).setPageMeta('u=x');
  assert.equal(none.els.length, 0, '沒有 og:url 就什麼都不寫(不猜網域)');
};
T['四個單元頁的程式:每一種畫面都呼叫 setPageMeta,參數跟頁面上的連結格式一樣;單元標題帶站名'] = () => {
  const g = read('js/grammar.js'), p = read('js/phonics.js'), r = read('js/reading.js'), d = read('js/dialogue.js');
  assert.match(g, /setPageMeta\(''\)/); assert.match(g, /setPageMeta\('u=' \+ encodeURIComponent\(u\.id\)/); assert.match(g, /setPageMeta\('ref=' \+ k\)/);
  assert.match(p, /setPageMeta\(''\)/); assert.match(p, /setPageMeta\('u=' \+ encodeURIComponent\(u\.id\)/); assert.match(p, /setPageMeta\('ref=chart'\)/);
  assert.match(r, /setPageMeta\(''\)/); assert.match(r, /setPageMeta\('id=' \+ encodeURIComponent\(a\.id\)/);
  assert.match(d, /setPageMeta\(''\)/); assert.match(d, /setPageMeta\('id=' \+ encodeURIComponent\(d\.id\)/);
  assert.match(g, /document\.title = u\.title \+ '\|衝衝英文'/);
  assert.match(p, /document\.title = u\.title \+ '\|衝衝英文'/);
  ['grammar', 'phonics', 'reading', 'dialogue', 'ear', 'daily-ui'].forEach((n) => {
    const titles = Array.from(read('js/' + n + '.js').matchAll(/document\.title = ([^;]+);/g)).map((m) => m[1]);
    titles.forEach((t) => assert.match(t, /衝衝英文/, n + '.js 的標題沒帶站名:' + t));
  });
  ['grammar.html?ref=tenses', 'grammar.html?ref=verbs'].forEach((u) => assert.ok(g.indexOf("'" + u.split('?')[0] + "?ref=' + k") > -1 || g.indexOf(u) > -1, u));
};
T['首頁:WebSite 與 Organization 結構化資料,alternateName 只有 Rushup、沒有原名;logo 是 112px 以上的點陣圖'] = () => {
  const src = read('index.html');
  const blocks = Array.from(src.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)).map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 1);
  const g = blocks[0]['@graph'];
  const site = g.find((x) => x['@type'] === 'WebSite');
  const org = g.find((x) => x['@type'] === 'Organization');
  assert.ok(site && org);
  assert.deepEqual([site.name, site.alternateName, site.url], ['衝衝英文', 'Rushup', LIVE + '/']);
  assert.deepEqual([org.name, org.alternateName, org.url], ['衝衝英文', 'Rushup', LIVE + '/']);
  assert.equal(org.logo, LIVE + '/img/icon-512.png');
  assert.equal(org.email, CFG.mail);
  assert.equal(site.publisher['@id'], org['@id']);
  assert.equal(/刷刷|shuashua/.test(blocks[0] && JSON.stringify(blocks[0])), false);
  const png = fs.readFileSync(path.join(REPO, 'img/icon-512.png'));
  assert.ok(png.readUInt32BE(16) >= 112 && png.readUInt32BE(20) >= 112);
};
T['首頁:h1 有站名;看得到英文名 Rushup;沒有寫死日期的免費公告'] = () => {
  const src = read('index.html');
  assert.match(src, /<h1>衝衝英文[^<]*<\/h1>/);
  assert.ok(src.split('<body')[1].indexOf('Rushup') > -1, '頁面文字裡沒有 Rushup');
  assert.equal(/\d+ 月 \d+ 日以前全站免費/.test(src), false);
};
T['sitemap.xml 跟 tools/build_sitemap.js 產生的一樣:要收錄的頁＋每個單元,沒有 noindex 的頁'] = () => {
  const cur = read('sitemap.xml').replace(/\r\n/g, '\n');
  assert.equal(cur, SM.build(REPO), 'sitemap.xml 不是最新的,執行 node tools/build_sitemap.js');
  const locs = Array.from(cur.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1].replace(/&amp;/g, '&'));
  assert.equal(new Set(locs).size, locs.length, '有重複的網址');
  indexable.forEach((f) => assert.ok(locs.indexOf(LIVE + '/' + (f === 'index.html' ? '' : f)) > -1, f + ' 不在 sitemap'));
  locs.forEach((u) => {
    assert.ok(u.indexOf(LIVE + '/') === 0, u);
    const f = u.slice(LIVE.length + 1).split('?')[0] || 'index.html';
    assert.ok(indexable.indexOf(f) > -1, u + ' 是 noindex 或不存在');
  });
  ['dialogue.html', 'mock.html', 'daily.html'].forEach((f) => assert.ok(locs.indexOf(LIVE + '/' + f) > -1, f));
  assert.ok(locs.indexOf(LIVE + '/grammar.html?u=ga-01') > -1);
  assert.ok(locs.filter((u) => /\?/.test(u)).length >= 200, '單元網址太少');
  Array.from(cur.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)).forEach((m) => assert.match(m[1], /^\d{4}-\d{2}-\d{2}$/));
};
T['build_sitemap:lastmod 依各頁自己的檔案,不是全部同一天;改動中的檔案算今天'] = () => {
  const seen = [];
  const out = SM.build(REPO, { today: '2030-01-01', lastmod: (files) => { seen.push(files); return files.indexOf('data/grammar.js') > -1 ? '2030-01-01' : '2029-12-31'; } });
  assert.ok(/grammar\.html\?u=ga-01<\/loc><lastmod>2030-01-01/.test(out));
  assert.ok(/reading\.html\?id=art-1a<\/loc><lastmod>2029-12-31/.test(out));
  const g = seen.find((f) => f[0] === 'grammar.html');
  assert.deepEqual(g, ['grammar.html', 'data/grammar.js', 'js/grammar.js']);
  const l = seen.find((f) => f[0] === 'listening.html');
  assert.ok(l.indexOf('js/ear.js') > -1 && l.indexOf('data/ear.js') > -1, JSON.stringify(l));
  assert.ok(seen.every((f) => f.indexOf('js/common.js') < 0), '共用程式不算內容改動');
};
T['404.html:noindex、連結與樣式都用 / 開頭、有頁尾、沒有 GitHub 的 Site not found 字樣'] = () => {
  const s = read('404.html');
  assert.ok(NOINDEX.test(s));
  assert.equal(canonicalOf(s), null);
  Array.from(s.matchAll(/(?:href|src)="([^"]+)"/g)).map((m) => m[1]).forEach((u) => assert.ok(/^(\/|https:\/\/fonts\.|mailto:)/.test(u), u));
  assert.equal(/Site not found|t a GitHub Pages site here/.test(s), false);
  assert.ok(s.indexOf('衝衝英文由個人經營') > -1);
};

let pass = 0;
const names = Object.keys(T);
for (const n of names) {
  try { T[n](); pass++; console.log('PASS ' + n); }
  catch (e) { console.log('FAIL ' + n + '  →  ' + (e && e.message)); }
}
console.log(pass + ' / ' + names.length + ' 通過');
process.exit(pass === names.length ? 0 : 1);
