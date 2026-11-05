/* 搜尋引擎相關的檢查(2026-10-31 SEO 稽核;2026-11-05 搜尋結果外觀):每一頁的標題、說明、canonical、分享預覽、首頁結構化資料、sitemap、404、網站圖示。
   - 每頁:有 lang;標題是「頁名 - 衝衝英文」,首頁是「衝衝英文 - 說明」,全站(含程式改的標題)不用直線「|」
     (Google 常把直線換掉或拿掉,半形連字號前後空一格是官方列的分隔符號);noindex 的頁不寫 canonical(轉址用的 tenses、verbs 除外)。
   - 要收錄的頁:說明 24–70 字、每頁不一樣;og 一組(title/description/url/site_name/locale/image)＋twitter:card;og:title 跟 title 一樣;
     canonical 跟 og:url 一樣。文法、自然發音、閱讀、對話四頁的 canonical 由 js/common.js 的 setPageMeta 依網址寫,HTML 不寫死。
   - 這四頁的列表模式:標題下有一句介紹,課程清單一建立就帶 data-nosnippet(不拿清單當搜尋結果的摘要);單元頁不帶。
   - setPageMeta:網域取 og:url(所以舊網址代理時也指新網址),單元網址只留決定內容的參數,重複呼叫不會疊加。
   - 首頁:WebSite 與 OnlineBusiness(Organization 的子類型)結構化資料,alternateName 只有 Rushup;h1 有站名;沒有過期的日期公告。
   - sitemap.xml 跟 tools/build_sitemap.js 產生的一樣:每個要收錄的頁加上每個單元,沒有 noindex 的頁。
   - 404.html:noindex、連結與樣式用 / 開頭(網址可能在任何一層)、不含 GitHub 的「Site not found」字樣(Worker 靠它判斷新網址掛了)。
   - 網站圖示(Google 搜尋結果不吃 SVG):每頁同一組 icon 連結(/favicon.ico、PNG、SVG、apple-touch-icon,/ 開頭);
     favicon.ico 有 16、32、48,favicon PNG 是 tools/build_icons.js 從 img/favicon.svg 產生的;App 圖示尺寸對、apple-touch-icon 不透明、
     maskable 安全區外只有底色;manifest 的圖示都在、尺寸跟寫的一樣。
   用法:node tools/test_seo.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const SM = require('./build_sitemap.js');
const IC = require('./build_icons.js');

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
const titleOf = (src) => { const m = /<title>([^<]*)<\/title>/.exec(src); return m ? m[1] : null; };
/* 一個函式的內容:從 function 名稱( 到下一個同層的 function 或區塊註解 */
function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i > -1, '找不到 function ' + name);
  const rest = src.slice(i + 10);
  const j = rest.search(/\n  (?:function |\/\* =)/);
  return j < 0 ? rest : rest.slice(0, j);
}

const T = {};
T['每一頁:lang 是 zh-Hant;標題是「頁名 - 衝衝英文」、首頁是「衝衝英文 - 說明」;不用直線;og:title 跟 title 一樣'] = () => {
  PAGES.forEach((f) => {
    assert.match(read(f), /<html lang="zh-Hant">/, f);
    const t = titleOf(head(f));
    assert.ok(t, f + ' 沒有 title');
    assert.equal(/[|｜]/.test(t), false, f + ' 標題還有直線:' + t);
    assert.equal(t.split('衝衝英文').length, 2, f + ' 站名要剛好一次:' + t);
    if (f === 'index.html') assert.match(t, /^衝衝英文 - [^ -]/, t);
    else assert.match(t, /^[^ -].* - 衝衝英文$/, f + ':' + t);
    const og = meta(head(f), 'property', 'og:title');
    if (og !== null) assert.equal(og, t, f + ' og:title 跟 title 不一樣');
  });
  const home = titleOf(head('index.html'));
  assert.ok(home.length <= 32, '首頁標題太長會被截掉:' + home.length + ' 字');
  assert.equal(/・/.test(home), false, '首頁標題用頓號,不用・:' + home);
};
T['程式改的標題:每一個 document.title 都是「… - 衝衝英文」,不用直線'] = () => {
  const files = fs.readdirSync(path.join(REPO, 'js')).filter((f) => /\.js$/.test(f));
  let n = 0;
  files.forEach((f) => {
    Array.from(read('js/' + f).matchAll(/document\.title = ([^;]+);/g)).forEach((m) => {
      n++;
      assert.equal(/[|｜]/.test(m[1]), false, f + ' 標題還有直線:' + m[1]);
      assert.match(m[1], / - 衝衝英文'$/, f + ' 標題結尾不是「 - 衝衝英文」:' + m[1]);
    });
  });
  assert.ok(n >= 30, '找到的標題太少:' + n);
};
T['要收錄的頁:說明 24–70 字、每頁不一樣、不以日期開頭;單元頁的說明也各不相同;自然發音、文法說明裡的課數跟資料一樣'] = () => {
  const seen = {};
  indexable.forEach((f) => {
    const d = meta(head(f), 'name', 'description');
    assert.ok(d && d.length >= 24 && d.length <= 70, f + ' 說明 ' + (d || '').length + ' 字:' + d);
    assert.ok(!seen[d], f + ' 的說明跟 ' + seen[d] + ' 一樣');
    seen[d] = f;
    assert.equal(/^\d{4} ?年|^\d{1,2} ?月/.test(d), false, f);
    assert.equal(/刷刷|shuashua/i.test(d), false, f);
  });
  const load = (file) => { const c = {}; c.window = c; vm.createContext(c); vm.runInContext(read(file), c); return c; };
  const g = load('data/grammar.js').TOEIC.grammar, p = load('data/phonics.js').TOEIC.phonics;
  [g, p].forEach((units) => {
    const goals = units.map((u) => u.goal);
    assert.ok(goals.every((x) => x && x.length >= 20 && x.length <= 90), '單元說明長度');
    assert.equal(new Set(goals).size, goals.length, '單元說明有重複');
  });
  const pd = meta(head('phonics.html'), 'name', 'description');
  const chapters = new Set(p.map((u) => u.id.split('-')[0])).size;
  assert.ok(pd.indexOf(chapters + ' 章 ' + p.length + ' 課') > -1, '自然發音說明的章數課數跟資料不一樣:' + pd);
  assert.ok(g.length >= 90 && g.length < 100 && meta(head('grammar.html'), 'name', 'description').indexOf('九十多個') > -1, '文法說明寫九十多個單元,資料有 ' + g.length);
  /* 閱讀、對話的單元說明由標題組出來,每篇不同 */
  assert.match(read('js/reading.js'), /setPageMeta\('id=' \+ encodeURIComponent\(a\.id\), a\.titleZh \? '英文閱讀「' \+ a\.title \+ '」/);
  assert.match(read('js/dialogue.js'), /setPageMeta\('id=' \+ encodeURIComponent\(d\.id\), d\.titleEn \? '英文對話「' \+ d\.titleEn \+ '」/);
  assert.equal(/看不懂的單字點一下練填空/.test(read('js/reading.js') + read('reading.html')), false, '閱讀的說明照實際做法寫:重點單字點了才變填空');
};
T['法律頁照常收錄(藍新、Google 登入的同意畫面要連得到):不加 noindex、生效日期照寫'] = () => {
  ['terms.html', 'privacy.html', 'refund.html', 'pricing.html'].forEach((f) => {
    assert.ok(indexable.indexOf(f) > -1, f + ' 不能 noindex');
    if (f !== 'pricing.html') assert.match(read(f), /<p class="result-note">\d{4} 年 \d{1,2} 月 \d{1,2} 日起適用<\/p>/, f);
  });
};
T['列表頁(文法、自然發音、閱讀、對話):標題下一句介紹;課程清單一建立就帶 data-nosnippet,單元頁不帶;不用程式事後加或拿掉'] = () => {
  const L = { grammar: 'renderHome', phonics: 'renderHome', reading: 'renderList', dialogue: 'renderList' };
  Object.keys(L).forEach((n) => {
    const src = read('js/' + n + '.js');
    const body = fnBody(src, L[n]);
    assert.match(body, /h\('div', \{ class: 'page-head' \},\s*h\('h1', null, '[^']+'\),\s*h\('p', null, /, n + ' 列表的標題下沒有介紹');
    assert.match(body, /h\('div', \{ [^}]*'data-nosnippet': ''/, n + ' 列表的清單沒有在建立時帶 data-nosnippet');
    assert.equal((src.match(/data-nosnippet/g) || []).length, (body.match(/data-nosnippet/g) || []).length, n + ' 列表以外也有 data-nosnippet');
    assert.equal(/(?:set|remove|toggle)Attribute\('data-nosnippet'/.test(src), false, n + ' 不能事後用程式加或拿掉 data-nosnippet');
    /* 介紹在 data-nosnippet 外面:page-head 那一段裡沒有 data-nosnippet */
    const ph = /h\('div', \{ class: 'page-head' \},[\s\S]*?\)\)[,;]/.exec(body);
    assert.ok(ph && ph[0].indexOf('data-nosnippet') < 0, n + ' 的介紹被包進 data-nosnippet');
  });
  PAGES.concat(fs.readdirSync(path.join(REPO, 'js')).map((f) => 'js/' + f)).forEach((f) => {
    Array.from(read(f).matchAll(/<(\w+)[^>]*\bdata-nosnippet\b/g)).forEach((m) => assert.ok(['span', 'div', 'section'].indexOf(m[1]) > -1, f + ' 的 data-nosnippet 只能放 span、div、section'));
    Array.from(read(f).matchAll(/h\('(\w+)', \{[^}]*'data-nosnippet'/g)).forEach((m) => assert.ok(['span', 'div', 'section'].indexOf(m[1]) > -1, f + ' 的 data-nosnippet 只能放 span、div、section'));
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
  assert.match(g, /setPageMeta\(''\)/); assert.match(g, /setPageMeta\('u=' \+ encodeURIComponent\(u\.id\)/); assert.match(g, /setPageMeta\('ref=' \+ k, r\.title \+ /);
  assert.match(p, /setPageMeta\(''\)/); assert.match(p, /setPageMeta\('u=' \+ encodeURIComponent\(u\.id\)/); assert.match(p, /setPageMeta\('ref=chart', '自然發音總表/);   /* 查表頁也要有自己的說明,不跟列表頁重複 */
  assert.match(r, /setPageMeta\(''\)/); assert.match(r, /setPageMeta\('id=' \+ encodeURIComponent\(a\.id\)/);
  assert.match(d, /setPageMeta\(''\)/); assert.match(d, /setPageMeta\('id=' \+ encodeURIComponent\(d\.id\)/);
  assert.match(g, /document\.title = u\.title \+ ' - 衝衝英文'/);
  assert.match(p, /document\.title = u\.title \+ ' - 衝衝英文'/);
  ['grammar', 'phonics', 'reading', 'dialogue', 'ear', 'daily-ui'].forEach((n) => {
    const titles = Array.from(read('js/' + n + '.js').matchAll(/document\.title = ([^;]+);/g)).map((m) => m[1]);
    titles.forEach((t) => assert.match(t, /衝衝英文/, n + '.js 的標題沒帶站名:' + t));
  });
  ['grammar.html?ref=tenses', 'grammar.html?ref=verbs'].forEach((u) => assert.ok(g.indexOf("'" + u.split('?')[0] + "?ref=' + k") > -1 || g.indexOf(u) > -1, u));
};
T['首頁:WebSite 與 OnlineBusiness 結構化資料,alternateName 只有 Rushup、沒有原名;有介紹;logo 是 112px 以上的點陣圖'] = () => {
  const src = read('index.html');
  const blocks = Array.from(src.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)).map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 1);
  const g = blocks[0]['@graph'];
  assert.equal(g.length, 2);
  const site = g.find((x) => x['@type'] === 'WebSite');
  const org = g.find((x) => x['@type'] === 'OnlineBusiness');   /* Google 建議用最貼近的 Organization 子類型:線上賣訂閱的網站 */
  assert.ok(site && org);
  assert.deepEqual([site.name, site.alternateName, site.url], ['衝衝英文', 'Rushup', LIVE + '/']);
  assert.deepEqual([org.name, org.alternateName, org.url], ['衝衝英文', 'Rushup', LIVE + '/']);
  assert.equal(org['@id'], LIVE + '/#organization');
  assert.equal(org.logo, LIVE + '/img/icon-512.png');
  assert.equal(org.email, CFG.mail);
  assert.ok(org.description && org.description.length >= 20 && org.description.indexOf('衝衝英文') === 0, '要有一句介紹:' + org.description);
  assert.equal('legalName' in org, false, '不寫本名');
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

/* 網站圖示(2026-11-05):Google 搜尋結果支援 BMP、GIF、ICO、PNG、JPEG、PPM、TIFF,不支援 SVG;建議大於 48×48。
   順序照 realfavicongenerator 的慣例:PNG 放第一個,SVG 給支援的瀏覽器,ICO 給舊瀏覽器與自動抓 /favicon.ico 的程式。 */
const ICON_LINKS = [
  '<link rel="icon" href="/img/favicon-96.png" type="image/png" sizes="96x96">',
  '<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">',
  '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">',
  '<link rel="apple-touch-icon" href="/img/icon-180.png" sizes="180x180">',
];
/* move-out.html 在舊網址的搬家期間要能單獨打開,它載入的檔案要跟 Worker 的 KEEP_ASSETS、sw.js 的 MOVE_ASSETS 一樣(test_worker、test_sw 檢查),
   所以照舊只掛 img/favicon.svg;改它要連 Worker 一起部署 */
const ICON_EXEMPT = REDIRECT_STUBS.concat(['move-out.html']);
const png = (f) => IC.decodePng(fs.readFileSync(path.join(REPO, f)));
T['每一頁的圖示連結都一樣:PNG、SVG、/favicon.ico、apple-touch-icon,都用 / 開頭;沒有別的 icon 連結'] = () => {
  PAGES.filter((f) => ICON_EXEMPT.indexOf(f) < 0).forEach((f) => {
    const s = head(f);
    const links = Array.from(s.matchAll(/<link rel="(?:icon|shortcut icon|apple-touch-icon[^"]*)"[^>]*>/g)).map((m) => m[0]);
    assert.deepEqual(links, ICON_LINKS, f);
  });
  assert.deepEqual(Array.from(head('move-out.html').matchAll(/<link rel="icon"[^>]*>/g)).map((m) => m[0]), ['<link rel="icon" href="img/favicon.svg" type="image/svg+xml">']);
  ICON_LINKS.forEach((l) => assert.ok(fs.existsSync(path.join(REPO, /href="\/([^"]+)"/.exec(l)[1])), l));
};
T['favicon.ico 有 16、32、48(32 位元);favicon-48/96/192.png 是 build_icons 從現在的 img/favicon.svg 產生的,ICO 的 48 跟 favicon-48.png 一模一樣'] = () => {
  const svg = read('img/favicon.svg');
  assert.doesNotThrow(() => IC.svgSquare(svg));
  const ico = IC.readIco(fs.readFileSync(path.join(REPO, 'favicon.ico')));
  assert.deepEqual(ico.map((x) => [x.w, x.h, x.bpp]), [[16, 16, 32], [32, 32, 32], [48, 48, 32]]);
  const tag = IC.sourceTag(svg);
  [48, 96, 192].forEach((n) => {
    const f = 'img/favicon-' + n + '.png';
    const im = png(f);
    assert.deepEqual([im.w, im.h], [n, n], f);
    assert.equal(IC.readSourceTag(fs.readFileSync(path.join(REPO, f))), tag, f + ' 不是從現在的 img/favicon.svg 產生的,執行 node tools/build_icons.js img/favicon.svg --only favicon');
  });
  assert.ok(png('img/favicon-48.png').data.equals(ico[2].data), 'favicon.ico 的 48 跟 favicon-48.png 不一樣');
};
T['App 圖示:apple-touch-icon 180 不透明;192、512 尺寸對;maskable 512 安全區(中間直徑 80% 的圓)外只有底色'] = () => {
  const t = png('img/icon-180.png');
  assert.deepEqual([t.w, t.h], [180, 180]);
  for (let i = 3; i < t.data.length; i += 4) assert.equal(t.data[i], 255, 'apple-touch-icon 有透明的地方,iPhone 上會變黑底');
  assert.deepEqual([png('img/icon-192.png').w, png('img/icon-192.png').h], [192, 192]);
  assert.deepEqual([png('img/icon-512.png').w, png('img/icon-512.png').h], [512, 512]);
  const m = png('img/icon-maskable-512.png');
  assert.deepEqual([m.w, m.h], [512, 512]);
  assert.equal(IC.safeZoneProblem(m), null, 'maskable 安全區外有圖案');
};
T['manifest:圖示檔都在、尺寸跟寫的一樣;有 192、512 與 maskable'] = () => {
  const man = JSON.parse(read('manifest.json'));
  const all = man.icons.concat(...(man.shortcuts || []).map((s) => s.icons || []));
  all.forEach((ic) => {
    const im = png(ic.src.replace(/^\.?\//, ''));
    assert.equal(ic.sizes, im.w + 'x' + im.h, ic.src);
    assert.equal(ic.type, 'image/png', ic.src);
  });
  const any = man.icons.filter((ic) => !ic.purpose || ic.purpose === 'any').map((ic) => ic.sizes).sort();
  assert.deepEqual(any, ['192x192', '512x512']);
  const mask = man.icons.filter((ic) => ic.purpose === 'maskable');
  assert.deepEqual(mask.map((ic) => [ic.src, ic.sizes]), [['img/icon-maskable-512.png', '512x512']]);
};
T['build_icons:PNG、ICO 寫出去讀得回來;PNG 記得來源;SVG 要正方形、有 viewBox;自動 maskable 把貼邊的圖縮進安全區;參數檢查'] = () => {
  const img = { w: 3, h: 2, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 255]) };
  const back = IC.decodePng(IC.encodePng(img, { source: 'abc' }));
  assert.deepEqual([back.w, back.h], [3, 2]);
  assert.ok(back.data.equals(img.data));
  assert.equal(IC.readSourceTag(IC.encodePng(img, { source: 'abc' })), 'abc');
  const rgb = IC.encodePng(img, { opaque: true });
  assert.equal(rgb[25], 2, '不透明的圖存成沒有透明通道的 PNG');
  const sq = (n, c) => ({ w: n, h: n, data: Buffer.alloc(n * n * 4, Buffer.from(c)) });
  const icoBack = IC.readIco(IC.writeIco([sq(16, [1, 2, 3, 255]), sq(32, [4, 5, 6, 0])]));
  assert.deepEqual(icoBack.map((x) => [x.w, x.bpp]), [[16, 32], [32, 32]]);
  assert.ok(icoBack[0].data.equals(sq(16, [1, 2, 3, 255]).data));
  assert.deepEqual([...icoBack[1].data.subarray(0, 4)], [4, 5, 6, 0]);
  assert.deepEqual(IC.svgSquare('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="32" height="32"></svg>'), 64);
  assert.throws(() => IC.svgSquare('<svg viewBox="0 0 64 32"></svg>'), /正方形/);
  assert.throws(() => IC.svgSquare('<svg width="32" height="32"></svg>'), /viewBox/);
  assert.throws(() => IC.svgSquare('<html></html>'), /SVG/);
  /* 一張貼滿邊的圖(白底,紅色畫到四個角):自動 maskable 要縮到安全區裡,四周補白 */
  const n = 64, art = sq(n, [255, 255, 255, 255]);
  for (let i = 0; i < n * n; i++) if (i % n < 6 || i % n >= n - 6) art.data.set([200, 0, 0, 255], i * 4);
  assert.notEqual(IC.safeZoneProblem(art), null);
  const m = IC.maskable(art, [255, 255, 255]);
  assert.deepEqual([m.w, m.h], [n, n]);
  assert.equal(IC.safeZoneProblem(m), null);
  assert.deepEqual(IC.parseArgs(['a.svg', '--only', 'favicon', '--tmp', 'D:/x']), { svg: 'a.svg', app: null, maskable: null, bg: null, only: 'favicon', out: null, tmp: 'D:/x' });
  assert.throws(() => IC.parseArgs([]), /用法/);
  assert.throws(() => IC.parseArgs(['a.svg', '--only', 'all']), /--only/);
  assert.throws(() => IC.parseArgs(['a.svg', '--bg', 'blue']), /--bg/);
};

let pass = 0;
const names = Object.keys(T);
for (const n of names) {
  try { T[n](); pass++; console.log('PASS ' + n); }
  catch (e) { console.log('FAIL ' + n + '  →  ' + (e && e.message)); }
}
console.log(pass + ' / ' + names.length + ' 通過');
process.exit(pass === names.length ? 0 : 1);
