/* 搜尋引擎相關的檢查(2026-10-31 SEO 稽核;2026-11-05 搜尋結果外觀):每一頁的標題、說明、canonical、分享預覽、首頁結構化資料、sitemap、404、網站圖示。
   - 每頁:有 lang;標題是「頁名 - 衝衝英文」,首頁是「衝衝英文 - 說明」,全站(含程式改的標題)不用直線「|」
     (Google 常把直線換掉或拿掉,半形連字號前後空一格是官方列的分隔符號);noindex 的頁不寫 canonical(轉址用的 tenses、verbs 除外)。
   - 要收錄的頁:說明 24–70 字、每頁不一樣;閱讀的說法全站一致(重點單字點了才變填空,首頁、學習頁的卡片也算);og 一組(title/description/url/site_name/locale/image)＋twitter:card;og:title 跟 title 一樣;
     canonical 跟 og:url 一樣。文法、自然發音、閱讀、對話四頁的 canonical 由 js/common.js 的 setPageMeta 依網址寫,HTML 不寫死。
   - 這四頁的列表模式:標題下只有 h1,不掛介紹句(站長刪過兩次,3c18669、159e17d);課程清單,以及文法、自然發音列表頁左邊的章節導覽列,
     一建立就帶 data-nosnippet(搜尋結果的摘要不拿清單和章號、課號,改用頁面說明);單元頁、查表頁不帶。
   - setPageMeta:網域取 og:url(所以舊網址代理時也指新網址),單元網址只留決定內容的參數,重複呼叫不會疊加。
   - 首頁:WebSite 與 OnlineBusiness(Organization 的子類型)結構化資料,alternateName 只有 Rushup;h1 有站名;沒有過期的日期公告。
   - 首頁搜尋結果的摘要(2026-11-13,Google 拿了導覽列文字當摘要):全站 .topbar-inner、頁尾連結列(外包 div)、首頁數字列、每日練習、小雞卡、聽力訓練頁的進度數字與級別選單一建立就帶 data-nosnippet(首頁、價格頁不寫全站免費公告,2026-11-17 站長拿掉),
     h1、功能卡片、頁尾那句不帶,h1 下不掛介紹句;首頁說明第一句講是準備多益的線上練習網站,寫的題數不超過題庫,數字列照資料算(題庫含聽力、單字不重複);
     定稿關鍵字表分「原樣」「拆開」逐處核對,「多益練習」要原樣在標題或說明;錯題本接在題庫後面(模擬考錯題不進錯題本);h1 用 keep-all 只在「：」「、」後換行;
     錯題本的卡片與說明只寫 js/review.js 真的收的(不寫全站錯題);單字、聽力頁的說明和首頁卡片列出頁上每一種玩法;
     標題、說明、h1、結構化資料、manifest 說明不寫會變假的字(免費、考古題、官方……),iPhone 安裝入口關著時也不寫 App、主畫面。
   - sitemap.xml 跟 tools/build_sitemap.js 產生的一樣:每個要收錄的頁加上每個單元,沒有 noindex 的頁。
   - 404.html:noindex、連結與樣式用 / 開頭(網址可能在任何一層)、不含 GitHub 的「Site not found」字樣(Worker 靠它判斷新網址掛了)。
   - 網站圖示(Google 搜尋結果不吃 SVG):每頁同一組 icon 連結(/favicon.ico、PNG、SVG、apple-touch-icon,/ 開頭);
     favicon.ico 有 16、32、48,favicon PNG 是 tools/build_icons.js 從 img/favicon.svg 產生的;App 圖示尺寸對、apple-touch-icon 不透明、
     maskable 安全區外只有底色、四張 App 圖示是同一次產生的;manifest 的圖示都在、尺寸跟寫的一樣;
     build_icons 全部做好、檢查過才寫,maskable 安全區不過時一個檔都不動。
   用法:node tools/test_seo.js */
'use strict';
const fs = require('fs');
const os = require('os');
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
/* 一個函式每一次被呼叫的位置與參數(只切最外層的逗號),跳過 function 宣告那一處 */
function callArgs(src, name) {
  const out = [];
  const re = new RegExp('(^|[^\\w.])' + name + '\\(', 'g');
  let m;
  while ((m = re.exec(src))) {
    const at = m.index + m[1].length;
    if (/function\s+$/.test(src.slice(Math.max(0, at - 12), at))) continue;
    const args = [];
    let depth = 0, cur = '';
    for (let k = at + name.length; k < src.length; k++) {
      const c = src[k];
      if ('([{'.indexOf(c) > -1 && ++depth === 1) continue;
      if (')]}'.indexOf(c) > -1 && --depth === 0) { args.push(cur.trim()); break; }
      if (c === ',' && depth === 1) { args.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    out.push({ at, args });
  }
  return out;
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
T['要收錄的頁:說明 24–70 字、每頁不一樣、不以日期開頭;單元頁的說明也各不相同;自然發音、文法說明裡的課數跟資料一樣;全站不再寫「看不懂的單字點一下」'] = () => {
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
  /* 閱讀照實際做法寫(重點單字點了才變填空):全站的頁面與程式都不能再有舊說法(首頁、學習頁的閱讀卡片也算) */
  const SITE = PAGES.concat(fs.readdirSync(path.join(REPO, 'js')).filter((f) => /\.js$/.test(f)).map((f) => 'js/' + f));
  const old = SITE.filter((f) => /看不懂的單字點一下/.test(read(f)));
  assert.deepEqual(old, [], '這些檔案還寫「看不懂的單字點一下」,閱讀只有重點單字點了才變填空');
};
T['法律頁照常收錄(藍新、Google 登入的同意畫面要連得到):不加 noindex、生效日期照寫'] = () => {
  ['terms.html', 'privacy.html', 'refund.html', 'pricing.html'].forEach((f) => {
    assert.ok(indexable.indexOf(f) > -1, f + ' 不能 noindex');
    if (f !== 'pricing.html') assert.match(read(f), /<p class="result-note">\d{4} 年 \d{1,2} 月 \d{1,2} 日起適用<\/p>/, f);
  });
};
T['列表頁(文法、自然發音、閱讀、對話):標題下只有 h1、不掛介紹句;清單與文法、自然發音的章節導覽列一建立就帶 data-nosnippet,單元頁、查表頁不帶;不用程式事後加或拿掉'] = () => {
  const L = { grammar: 'renderHome', phonics: 'renderHome', reading: 'renderList', dialogue: 'renderList' };
  const count = (s) => (s.match(/data-nosnippet/g) || []).length;
  Object.keys(L).forEach((n) => {
    const src = read('js/' + n + '.js');
    const body = fnBody(src, L[n]);
    /* 站長刪過兩次列表標題下的說明句(3c18669、159e17d):page-head 裡只放 h1,摘要交給頁面說明 */
    assert.match(body, /h\('div', \{ class: 'page-head' \},\s*h\('h1', null, '[^']+'\)\)[,;]/, n + ' 列表的標題下不能掛介紹句,page-head 裡只放 h1');
    assert.match(body, /h\('div', \{ [^}]*'data-nosnippet': ''/, n + ' 列表的清單沒有在建立時帶 data-nosnippet');
    assert.equal(/(?:set|remove|toggle)Attribute\('data-nosnippet'/.test(src), false, n + ' 不能事後用程式加或拿掉 data-nosnippet');
    let rail = '';
    if (n === 'grammar' || n === 'phonics') {
      /* h1 不能被包進 data-nosnippet:外面那層 gx-col 不帶 */
      assert.match(body, /h\('div', \{ class: 'gx-col' \},/, n + ' 列表的 gx-col 不能帶 data-nosnippet');
      /* 左邊的章節導覽列只有章號、課號和「名詞、冠詞與代名詞 0 / 12」:列表頁(能切章、會傳 onPickStage)畫的那一份,裡面兩塊 div 建立時就帶 */
      rail = fnBody(src, 'buildRail');
      assert.match(rail, /h\('nav', \{ class: 'gx-rail'[^}]*\}, stations, pathWrap\)/, n + ' 的導覽列裡應該只有 stations、pathWrap 兩塊');
      assert.equal(/\brail\.(?:append|prepend|appendChild|insertBefore)\(/.test(rail), false, n + ' 的導覽列不能再直接加東西(會在 data-nosnippet 外面)');
      ['gx-stations', 'gx-pathwrap'].forEach((c) => assert.match(rail,
        new RegExp("h\\('div', \\{ class: '" + c + "', 'data-nosnippet': onPickStage \\? '' : null \\}\\)"), n + ' 的 .' + c + ' 沒有在列表頁建立時帶 data-nosnippet'));
      /* 只有列表頁傳 onPickStage(切章的函式);單元頁、查表頁、發音總表傳 null,導覽列不帶 */
      const from = src.indexOf(body), calls = callArgs(src, 'buildRail');
      const inList = (c) => c.at >= from && c.at < from + body.length;
      assert.equal(calls.filter(inList).length, 1, n + ' 列表頁應該畫一次導覽列');
      calls.forEach((c) => {
        if (inList(c)) assert.match(c.args[2] || '', /=>/, n + ' 列表頁的導覽列要傳切章的函式:buildRail(' + c.args.join(', ') + ')');
        else assert.equal(c.args[2], 'null', n + ' 列表以外的導覽列不能帶 data-nosnippet:buildRail(' + c.args.join(', ') + ')');
      });
      assert.ok(calls.length > 1, n + ' 找不到單元頁的導覽列');
    }
    assert.equal(count(src), count(body) + count(rail), n + ' 列表與列表頁的導覽列以外也有 data-nosnippet');
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
/* 首頁的 h1 裡有 <wbr>(窄螢幕在「與」後面換行,字不變):比對 h1 的字之前先拿掉 */
const homeSrc = () => read('index.html').replace(/<wbr>/g, '');
T['首頁:h1 有站名;看得到英文名 Rushup;沒有寫死日期的免費公告'] = () => {
  const src = homeSrc();
  assert.match(src, /<h1>衝衝英文[^<]*<\/h1>/);
  assert.ok(src.split('<body')[1].indexOf('Rushup') > -1, '頁面文字裡沒有 Rushup');
  assert.equal(/\d+ 月 \d+ 日以前全站免費/.test(src), false);
};

/* 一頁 body 裡的每個元素,記下它是不是在 data-nosnippet 裡面(自己帶或外層帶)。不用套件:script 內容與註解拿掉後照標籤開合算外層 */
const VOID_TAGS = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;
function bodyElements(src) {
  const body = src.split(/<body[^>]*>/)[1].split('</body>')[0].replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [], els = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map((e) => e.tag).lastIndexOf(tag);
      assert.ok(i > -1, '多出結尾標籤 </' + tag + '>');
      stack.length = i;
      continue;
    }
    const cls = (/\bclass="([^"]*)"/.exec(m[3]) || [])[1] || '';
    const e = { tag, cls: cls.split(/\s+/), id: (/\bid="([^"]*)"/.exec(m[3]) || [])[1] || '', own: /\bdata-nosnippet\b/.test(m[3]) };
    e.hidden = e.own || stack.some((p) => p.hidden);
    els.push(e);
    if (!VOID_TAGS.test(tag)) stack.push(e);
  }
  assert.deepEqual(stack.map((e) => e.tag), [], '有沒關的標籤');
  return els;
}
/* 首頁說明與 App 說明不能寫的字(2026-11-13 定稿):會變假的(之後要收費、題目不是真題、跟 ETS 無關、音檔是合成語音……)與誇大字 */
const HOME_BANNED = ['免費', '考古題', '官方', '真人', '口說', '離線', '免註冊', 'PDF', '下載', '神器', '首選', '保證', '990', '一站式', '全方位', '打造', '助你', '輕鬆', '高效', 'AI', '刷刷'];
T['首頁搜尋結果的摘要(2026-11-13):導覽列、數字列、每日練習、小雞卡、聽力頁進度與級別選單建立時就帶 data-nosnippet,全站頁尾連結列包一層;h1、功能卡片、頁尾那句不帶;h1 下不掛介紹句;首頁、價格頁不寫全站免費公告;聽力頁說明不寫這頁沒有的題組'] = () => {
  /* 11/13 Google 拿首頁的導覽列文字當摘要:有頂欄的每一頁,.topbar-inner 都帶(「登入▾」、App 的返回鍵與頁名是 JS 加進這一層的);header 本身不能帶 */
  let bars = 0;
  PAGES.forEach((f) => {
    const s = read(f);
    const all = (s.match(/class="topbar-inner"/g) || []).length;
    bars += all;
    assert.equal((s.match(/<div class="topbar-inner" data-nosnippet>/g) || []).length, all, f + ' 的 .topbar-inner 沒帶 data-nosnippet');
    assert.equal(/<header\b[^>]*data-nosnippet/.test(s), false, f + ' 的 header 不能帶 data-nosnippet(只能放 span、div、section)');
  });
  assert.ok(bars >= 30, '有頂欄的頁太少:' + bars);
  const src = homeSrc();
  const els = bodyElements(src);
  const one = (pred, name) => { const x = els.filter(pred); assert.equal(x.length, 1, '首頁找不到剛好一個 ' + name); return x[0]; };
  /* 該擋的:數字列(JS 填的數字)、每日練習(個人進度)。免費公告 11/17 拿掉了(站長:「不用特別寫全站免費什麼的,要收錢我們就收」) */
  assert.ok(one((e) => e.tag === 'div' && e.cls.indexOf('stats') > -1, '.stats').own, '數字列沒帶 data-nosnippet');
  assert.ok(one((e) => e.id === 'daily-home', '#daily-home').own, '每日練習沒帶 data-nosnippet');
  assert.equal(/全站免費|free-note/.test(src), false, '首頁不再寫全站免費公告');
  assert.equal(/全站免費/.test(read('pricing.html')), false, '價格頁不再寫全站免費公告');
  /* 聽力訓練頁:四張卡的「完成 0/140」與級別選單是介面字,建立時就帶 data-nosnippet;玩法名稱與說明不擋 */
  const ear = read('js/ear.js');
  assert.ok(ear.includes("h('div', { class: 'p-stats', 'data-nosnippet': '' }"), '聽力頁進度數字沒帶 data-nosnippet');
  assert.ok(ear.includes("h('div', { class: 'cfg-row', 'data-nosnippet': '' }, lvSel"), '聽力頁級別選單沒帶 data-nosnippet');
  /* 聽力訓練頁只有聽力基本功(js/ear.js);Part 1–4 題組在題庫刷題(js/listening.js)。說明不能寫這頁沒有的題組 */
  const lh = read('listening.html');
  const lhDesc = ((/<meta name="description" content="([^"]*)"/.exec(lh) || [])[1] || '') + ((/<meta property="og:description" content="([^"]*)"/.exec(lh) || [])[1] || '');
  if (lh.indexOf('js/listening.js') < 0) assert.equal(/照片描述|應答|獨白|題組/.test(lhDesc), false, '聽力頁說明寫了這頁沒有的題組');
  /* 小雞卡訪客也看得到,內容是「今天 0 / N 題」:js/pet-ui.js 的 card() 建立時就帶,不事後加 */
  const pet = read('js/pet-ui.js');
  assert.match(pet, /h\('section', \{ class: 'pet-card pet-' \+ kind, 'aria-labelledby': idp \+ '-h', 'data-nosnippet': '' \}\)/, '小雞卡建立時沒帶 data-nosnippet');
  assert.equal(/(?:set|remove|toggle)Attribute\('data-nosnippet'/.test(pet + src), false, '不能事後用程式加或拿掉 data-nosnippet');
  /* 不能擋的:h1、功能卡片(Google 不用說明時摘要靠這兩塊)、頁尾(有 Rushup 與「與 ETS 無關」) */
  assert.equal(one((e) => e.tag === 'h1', 'h1').hidden, false, 'h1 被包進 data-nosnippet');
  const cards = els.filter((e) => e.cls.indexOf('module-card') > -1);
  assert.ok(cards.length >= 10, '功能卡片太少:' + cards.length);
  cards.forEach((e) => assert.equal(e.hidden, false, '功能卡片被包進 data-nosnippet'));
  const foot = one((e) => e.tag === 'footer', 'footer'), after = els.slice(els.indexOf(foot));
  assert.equal(foot.hidden, false, '頁尾被包進 data-nosnippet');
  assert.equal(after.find((e) => e.tag === 'p').hidden, false, '頁尾那句(Rushup、與 ETS 無關)被包進 data-nosnippet');
  /* 頁尾的連結列(方案、條款、隱私、退款、客服信箱)跟頂欄一樣是一串連結字;nav 不能帶,外面包一層 div。有連結列的每一頁都一樣 */
  const links = after.find((e) => e.tag === 'nav' && e.cls.indexOf('foot-links') > -1);
  assert.ok(links && links.hidden && !links.own, '首頁頁尾的連結列沒包進 div data-nosnippet');
  let rows = 0;
  PAGES.forEach((f) => {
    const s = read(f);
    const all = (s.match(/<nav class="foot-links" aria-label="網站資訊">/g) || []).length;
    rows += all;
    assert.equal((s.match(/<div data-nosnippet><nav class="foot-links" aria-label="網站資訊">[^\n]*?<\/nav><\/div>/g) || []).length, all, f + ' 的頁尾連結列沒包進 div data-nosnippet');
  });
  assert.ok(rows >= 25, '有頁尾連結列的頁太少:' + rows);
  /* 首頁 h1 下的說明句刪過三次(3c18669、159e17d、22c78df):h1 後面緊接數字列;首屏後來加的主按鈕、文字連結、小雞跟數字列一樣帶 data-nosnippet,
     首屏裡除了 h1 沒有給搜尋引擎看的字,也沒有段落 */
  assert.match(src, /<div class="hero-inner">\s*<h1>[^<]+<\/h1>\s*<div class="stats"/, '首頁 h1 下不掛介紹句');
  const heroAt = els.findIndex((e) => e.cls.indexOf('hero-inner') > -1), mainAt = els.findIndex((e) => e.tag === 'main');
  const hero = els.slice(heroAt + 1, mainAt);
  assert.ok(heroAt > -1 && hero.length >= 4, '首頁找不到首屏');
  assert.equal(hero.some((e) => e.tag === 'p'), false, '首屏不放段落');
  hero.filter((e) => e.tag !== 'h1').forEach((e) => assert.ok(e.hidden, '首屏的 ' + e.tag + '.' + e.cls.join('.') + ' 沒帶 data-nosnippet'));
  ['hero-cta', 'hero-pic'].forEach((c) => assert.ok(one((e) => e.cls.indexOf(c) > -1, '.' + c).own, '首屏的 .' + c + ' 沒帶 data-nosnippet'));
  /* 已登入才出現的錯題本那一列:字(待複習的數字)不給搜尋結果 */
  els.filter((e) => e.cls.indexOf('home-review') > -1).forEach((a) => {
    const kids = els.slice(els.indexOf(a) + 1).filter((e) => e.tag === 'span').slice(0, 2);
    kids.forEach((k) => assert.ok(k.hidden, '錯題本那一列的字沒帶 data-nosnippet'));
  });
};
T['首頁與 App 的說明(2026-11-13 定稿):講清楚是準備多益的線上練習網站;關鍵字表寫的位置真的有;錯題本不接在模擬考後面;h1 不把詞拆兩行;數字列算的是實際資料;寫的題數是真的;不寫會變假的字'] = () => {
  const src = homeSrc(), s = head('index.html');
  const desc = meta(s, 'name', 'description');
  const org = JSON.parse(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/.exec(src)[1])['@graph'].find((x) => x['@type'] === 'OnlineBusiness');
  const man = JSON.parse(read('manifest.json'));
  const h1 = /<h1>([^<]+)<\/h1>/.exec(src)[1];
  assert.match(desc, /^衝衝英文是準備多益的線上英文練習網站。/, '首頁說明第一句要講是什麼站:' + desc);
  [titleOf(s), desc, h1, man.description].forEach((t) => assert.match(t, /多益/, t));
  [titleOf(s), desc, h1].forEach((t) => assert.ok(/聽力/.test(t) && /閱讀/.test(t), '要寫出主要練聽力、閱讀:' + t));
  /* 定稿第六節關鍵字表:T 標題、D 說明、H h1、M manifest、J 結構化資料、C 首頁卡片。
     「原樣」是整個詞一字不差出現的地方,要剛好是表上寫的那幾處(多了、少了都要回去改表);
     「拆開」是沒有原樣、但同一段有「多益」也有詞的後半(C 首頁卡片上沒有「多益」兩字,只看後半)。
     以前只查拆開的片段(「練習」「聽力」),表上寫「多益練習:T、D、H、J」,其實一處都沒有原樣(審查第 2 輪 #1) */
  const spot = { T: titleOf(s), D: desc, H: h1, M: man.description, J: org.description,
    /* 首頁卡片的名稱換成「錯題本」之前,舊名「每日複習」也算同一個詞(關鍵字表只看「錯題本」出現在哪幾處) */
    C: Array.from(src.matchAll(/<a class="module-card[^"]*"[^>]*>\s*(?:<canvas[^>]*><\/canvas>\s*)?<h2>([^<]+)<\/h2>\s*<p>([^<]*)<\/p>/g)).map((m) => m[1] + m[2]).join('|').replace(/每日複習/g, '錯題本') };
  const where = (w) => Object.keys(spot).filter((k) => spot[k].indexOf(w) > -1).sort().join('');
  const sameSpots = (w, at) => assert.equal(where(w), at.split('').sort().join(''), '關鍵字表說「' + w + '」原樣出現在「' + at + '」,實際是「' + where(w) + '」');
  assert.ok(spot.T.indexOf('多益練習') > -1 || spot.D.indexOf('多益練習') > -1, '主關鍵字「多益練習」要原樣出現在標題或說明:' + spot.T + ' / ' + spot.D);
  [['多益練習', 'T', 'DHJ', ['練習']], ['多益線上練習', '', 'DJ', ['線上', '練習']], ['多益英文練習', '', 'DJ', ['英文練習']], ['多益練習網站', '', 'DJ', ['練習網站']],
    ['多益聽力', 'HM', 'TDJC', ['聽力']], ['多益閱讀', '', 'TDHMJC', ['閱讀']], ['多益題庫', '', 'TDJC', ['題庫']], ['多益刷題', '', 'THMC', ['刷題']],
    ['多益單字', '', 'TDHMJC', ['單字']], ['多益模擬考', '', 'TDMJC', ['模擬考']], ['多益模擬試題', '', 'J', ['模擬試題']], ['多益文法', '', 'DMJC', ['文法']]].forEach(([w, exact, split, parts]) => {
    sameSpots(w, exact);
    split.split('').forEach((k) => assert.ok((k === 'C' || spot[k].indexOf('多益') > -1) && parts.every((p) => spot[k].indexOf(p) > -1),
      '關鍵字表說「' + w + '」拆開出現在 ' + k + ',實際沒有:' + spot[k]));
  });
  /* 次要的詞本身就是關鍵字,一樣要剛好出現在表上寫的那幾處。
     首頁卡片改成圖示磚(名稱加一行數字)之後:題庫刷題那塊的數字是「Part 1–7」(多了 C),卡片不再寫「附解析」(解析留在 D、M、J) */
  [['題庫刷題', 'TC'], ['Part 1–7', 'DMJC'], ['解析', 'DMJ'], ['錯題本', 'MJC'], ['自然發音', 'JC'], ['對話', 'JC'], ['寫作', 'JC'], ['TOEIC', 'J']].forEach(([w, at]) => sameSpots(w, at));
  assert.equal(spot.T.indexOf('寫作'), -1, '多益聽讀不考寫作,標題不放寫作');
  /* 模擬考只存 mock_history,錯題不會進錯題本(js/review.js 只收題庫刷題、片語、單字、文法、發音):講錯題本的那句要接在題庫後面,不能排在模擬考後面 */
  [spot.M, spot.J].forEach((t) => assert.ok(t.indexOf('錯題本') < t.indexOf('模擬考'), '錯題本要接在題庫刷題後面,不能接在模擬考後面:' + t));
  /* h1 只在「：」「、」後面換行(.hero h1 用 word-break: keep-all;原本 360 寬斷成「刷 / 題」、320 寬斷成「閱 / 讀」),每段要在 320 寬一行放得下(手機 24px,一行 11 字) */
  assert.match(read('css/style.css'), /\n\.hero h1 \{[^}]*word-break: keep-all;[^}]*\}/, '.hero h1 沒設 word-break: keep-all');
  h1.split(/(?<=[：、])/).forEach((seg) => assert.ok(seg.length <= 11, 'h1 這段在 320 寬放不進一行:' + seg));
  /* 數字從資料數:題庫刷題的題目(閱讀 Part 5–7、聽力 Part 1–4)、文章的重點單字(不重複、不分大小寫) */
  const c = {}; c.window = c; vm.createContext(c);
  ['articles', 'part5', 'part6', 'part7', 'listening'].forEach((f) => vm.runInContext(read('data/' + f + '.js'), c));
  const D = c.TOEIC, L = D.listening;
  const sets = (a) => a.reduce((n, x) => n + x.questions.length, 0);
  const total = D.part5.length + sets(D.part6) + sets(D.part7) + L.p1.length + L.p2.length + sets(L.p3) + sets(L.p4);
  const words = new Set();
  D.articles.forEach((a) => a.paragraphs.forEach((p) => (p.en.match(/\[\[(.+?)\]\]/g) || []).forEach((m) => words.add(m.slice(2, -2).trim().toLowerCase()))));
  /* 首頁那段數字程式拿去跑:要載得到聽力題庫,跑出來的數字跟上面一樣 */
  const scripts = Array.from(src.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)).map((m) => m[1]);
  assert.ok(scripts.indexOf('data/listening.js') > -1, '首頁沒載聽力題庫,刷題題數只會算到閱讀');
  const out = {};
  c.document = { getElementById: (id) => ({ set textContent(v) { out[id] = v; } }) };
  vm.runInContext(Array.from(src.matchAll(/<script>([\s\S]*?)<\/script>/g)).map((m) => m[1]).find((b) => b.indexOf('stat-questions') > -1), c);
  assert.deepEqual(out, { 'stat-articles': D.articles.length, 'stat-vocab': words.size, 'stat-questions': total });
  /* 說明寫的「超過 N 題」不能比題庫多 */
  [desc, org.description].forEach((t) => {
    const m = /超過 (\d+) 題/.exec(t);
    assert.ok(m && Number(m[1]) <= total, '說明的題數要寫、而且不能超過題庫的 ' + total + ' 題:' + t);
  });
  /* 會變假的字;iPhone 的安裝入口關著(js/app-shell.js 的 IOS_INSTALL = 'off')時也不寫 App、主畫面 */
  const ios = /const IOS_INSTALL = '([\w-]+)'/.exec(read('js/app-shell.js'));
  assert.ok(ios, 'js/app-shell.js 找不到 IOS_INSTALL');
  const banned = HOME_BANNED.concat(ios[1] === 'off' ? ['App', 'app', '主畫面'] : []);
  const texts = { 標題: titleOf(s), 說明: desc, og: meta(s, 'property', 'og:title') + meta(s, 'property', 'og:description'), h1, 結構化資料: org.description, manifest: man.description };
  Object.keys(texts).forEach((k) => banned.forEach((w) => assert.equal(texts[k].indexOf(w), -1, '首頁' + k + '寫了「' + w + '」:' + texts[k])));
  assert.ok(man.description.length >= 20 && man.description.length <= 80, 'manifest 說明 ' + man.description.length + ' 字(商店簡短說明上限 80)');
  /* 首頁的功能卡片跟 App 的學習、刷題頁同名的卡片,說明要一樣(改一邊忘了另一邊會出現兩種說法) */
  /* 卡片可以帶 tile 類別與圖示(<canvas> 在 h2 前面);圖示磚的數字行可以是空的(錯題本的數字是徽章) */
  const cardsOf = (f) => Array.from(read(f).matchAll(/<a class="module-card[^"]*" href="([^"]+)">\s*(?:<canvas[^>]*><\/canvas>\s*)?<h2>([^<]+)<\/h2>\s*<p>([^<]*)<\/p>/g)).map((m) => [m[1], m[2], m[3]]);
  const home = cardsOf('index.html');
  assert.ok(home.length >= 10, '首頁卡片太少:' + home.length);
  /* 首頁目錄的磚跟分組頁一樣沒有說明句:數字行不超過 12 字、沒有句號與逗號;目錄裡的「開始」是描邊按鈕(首頁的實色按鈕在首屏與每日練習卡) */
  home.forEach(([href, name, text]) => assert.ok(text.length <= 12 && !/[，。；]/.test(text), '首頁「' + name + '」磚的數字行太長或有標點:' + text));
  const dirs = Array.from(src.matchAll(/<section class="home-dir"[\s\S]*?<\/section>/g)).map((m) => m[0]);
  assert.equal(dirs.length, 3, '首頁要有三組目錄');
  dirs.forEach((d) => assert.equal(/class="btn primary/.test(d), false, '首頁目錄裡不放實色按鈕'));
  ['learn.html', 'warmup.html', 'drill.html'].forEach((f) => {
    const hub = cardsOf(f);
    assert.ok(hub.length >= 4, f + ' 卡片太少');
    hub.forEach(([href, name, text]) => {
      const twin = home.find((c) => c[0] === href);
      if (!twin) return;
      if (f === 'learn.html' || f === 'warmup.html' || f === 'drill.html') {
        /* 學習頁與刷題選單的卡片只留一行事實標籤,字數比首頁短;兩邊都寫了同一種單位(章、課、組、級)的數字就不能不同 */
        const units = (t) => Array.from(t.matchAll(/(\d+) ?([章課組級題])/g)).map((m) => [m[2], m[1]]);
        const homeU = units(twin[2]);
        units(text).forEach(([u, n]) => homeU.filter((x) => x[0] === u).forEach((x) => assert.equal(n, x[1], f + ' 的「' + name + '」卡片寫的' + u + '數跟首頁不一樣')));
        /* 同一塊磚兩邊的數字行要一字不差(單位比對抓不到「回合」這類沒列進單位的寫法) */
        assert.equal(text, twin[2], f + ' 的「' + name + '」磚數字行跟首頁不一樣');
        if (href !== 'review.html') assert.ok(text.length > 0, f + ' 的「' + name + '」卡片沒有標籤');
        return;
      }
      assert.equal(text, twin[2], f + ' 的「' + name + '」卡片說明跟首頁不一樣');
    });
  });
};
T['首頁卡片與內頁說明寫的是真的、而且一致(2026-11-13 審查第 2 輪):錯題本只寫 js/review.js 真的收的;單字、聽力頁的說明和首頁卡片列出頁上每一種玩法'] = () => {
  const cards = new Map(Array.from(read('index.html').matchAll(/<a class="module-card[^"]*" href="([^"]+)">\s*(?:<canvas[^>]*><\/canvas>\s*)?<h2>[^<]+<\/h2>\s*<p>([^<]*)<\/p>/g)).map((m) => [m[1], m[2]]));
  /* js/review.js 收的是題庫刷題(Part 5、聽力 P1/P2 直接出題,題組列出來連回刷題)、片語、單字遊戲漏接、文法和自然發音沒全對的課;
     模擬考(只存 mock_history)、程度檢測、閱讀文章、聽寫這類聽力基本功的錯題都不會進去,所以不能寫「全站錯題」。
     data-nosnippet 擋掉導覽列等之後,首頁卡片是 h1 下面第一段會被拿去當摘要的字 */
  const rv = read('js/review.js');
  const rvText = [cards.get('review.html'), meta(head('review.html'), 'name', 'description')];
  rvText.forEach((t) => {
    /* 錯題本那塊磚的數字行是空的(待複習的數字畫成徽章),所以只要找得到 */
    assert.ok(typeof t === 'string', '找不到錯題本的卡片或說明');
    ['全站', '模擬考', '程度檢測', '文章', '聽寫'].forEach((w) => assert.equal(t.indexOf(w), -1, '錯題本寫了「' + w + '」,js/review.js 沒有收這些:' + t));
  });
  [['刷題', "store.get('drill_p5'"], ['片語', "store.get('phrase_drill'"], ['單字', "store.get('vgame_miss'"], ['文法', "store.get('grammar_done'"]].forEach(([w, key]) => {
    if (rvText[0].indexOf(w) > -1) assert.ok(rv.indexOf(key) > -1, '錯題本卡片寫了「' + w + '」,js/review.js 卻沒讀 ' + key);
  });
  /* 單字頁、聽力頁的說明(搜尋結果、分享預覽)要列出頁上每一種玩法;以前首頁卡片加了記憶吐司、跟讀,內頁說明沒跟上。
     首頁卡片改成圖示磚之後只寫數字(「4 種遊戲」「4 種練習」):數字要跟頁上的玩法數一樣 */
  const games = Array.from(read('js/vocab.js').matchAll(/gameCard\('\w+', '([^']+)'/g)).map((m) => m[1].replace(/^單字/, ''));
  const ears = Array.from(read('js/ear.js').matchAll(/\b\w+: \{ key: 'ear_\w+', title: '([^']+)'/g)).map((m) => m[1].replace(/^句子(?=跟讀)/, ''));
  assert.ok(games.length >= 4 && ears.length >= 4, '找不到單字玩法或聽力基本功的名稱:' + games + ' / ' + ears);
  [['vocab.html', games], ['listening.html', ears]].forEach(([f, names]) => {
    const d = meta(head(f), 'name', 'description');
    names.forEach((n) => {
      assert.ok(d.indexOf(n) > -1, f + ' 的說明少了「' + n + '」:' + d);
    });
    assert.ok(cards.get(f).indexOf(names.length + ' 種') === 0, '首頁「' + f + '」磚寫的玩法數跟頁上的 ' + names.length + ' 種不一樣:' + cards.get(f));
  });
};
T['頂欄與分組頁:20 頁的頂欄是同一份(首頁加三個分組連結),目前頁亮的是歸屬那一格,我的、學習記錄、能力分析、教師後台都不亮;新頁登記在分頁列、開機清單、版面檢查;「每日複習」改成「錯題本」'] = () => {
  const NAV = /<nav class="topnav" aria-label="主要導覽">[\s\S]*?<\/nav>/;
  const plain = (n) => n.replace(/\r/g, '').replace(/ class="active" aria-current="page"/g, '').replace(/ active/g, '').replace(/ aria-current="page"/g, '');
  const withNav = PAGES.filter((f) => /class="topnav"/.test(read(f)));
  assert.equal(withNav.length, 20, '有導覽的頁數:' + withNav.length);
  const base = plain(NAV.exec(read('index.html'))[0]);
  const GROUPS = { 'learn.html': ['grammar.html', 'phonics.html', 'reading.html', 'dialogue.html'], 'warmup.html': ['vocab.html', 'listening.html', 'writing.html', 'grammar.html?ref=verbs'],
    'drill.html': ['practice.html', 'mock.html', 'diagnostic.html', 'review.html'] };
  const tops = [['index.html', '首頁']].concat(Array.from(base.matchAll(/<a class="nav-btn" href="([^"]+)">([^<]+)<\/a>/g)).map((m) => [m[1], m[2]]));
  assert.deepEqual(tops.map((t) => t[0]), ['index.html', 'learn.html', 'warmup.html', 'drill.html'], '頂欄四個連結:' + JSON.stringify(tops));
  assert.deepEqual(['首頁', '日常學習', '練練手感', '刷刷題目'], tops.map((t) => t[1]));
  assert.equal(/<button class="nav-btn/.test(read('index.html')), false, '.nav-btn 要是連結,不是按鈕');
  Object.keys(GROUPS).forEach((g) => {
    const menu = new RegExp('<a class="nav-btn(?: active)?" href="' + g + '"[^>]*>[^<]+</a>\\s*<div class="nav-menu">([\\s\\S]*?)</div>').exec(base);
    assert.ok(menu, g + ' 的選單');
    assert.deepEqual(Array.from(menu[1].matchAll(/href="([^"]+)"/g)).map((m) => m[1]), GROUPS[g]);
    GROUPS[g].forEach((h) => assert.ok(fs.existsSync(path.join(REPO, h.split('?')[0])), h));
  });
  /* 目前頁亮哪一格:每一頁屬於哪一格的歸屬表 */
  const OWNER = { home: ['index.html', 'daily.html'], 'learn.html': ['learn.html', 'grammar.html', 'phonics.html', 'reading.html', 'dialogue.html'],
    'warmup.html': ['warmup.html', 'vocab.html', 'listening.html', 'writing.html'], 'drill.html': ['drill.html', 'practice.html', 'mock.html', 'diagnostic.html', 'review.html'],
    none: ['me.html', 'history.html', 'analysis.html', 'admin.html'] };
  const all = Object.keys(OWNER).reduce((a, k) => a.concat(OWNER[k]), []);
  assert.deepEqual(all.slice().sort(), withNav.slice().sort(), '歸屬表要剛好涵蓋有導覽的頁');
  withNav.forEach((f) => {
    const nav = NAV.exec(read(f));
    assert.ok(nav, f + ' 沒有新頂欄');
    assert.equal(plain(nav[0]), base, f + ' 的頂欄跟首頁的不是同一份');
    const homeOn = /<a href="index\.html" class="active" aria-current="page">/.test(nav[0]);
    const grp = (/<a class="nav-btn active" href="([^"]+)"/.exec(nav[0]) || [])[1] || null;
    const want = Object.keys(OWNER).find((k) => OWNER[k].indexOf(f) > -1);
    assert.equal(homeOn, want === 'home', f + ' 首頁那格');
    assert.equal(grp, want === 'home' || want === 'none' ? null : want, f + ' 亮的分組');
    assert.equal((nav[0].match(/class="[^"]*\bactive\b/g) || []).length - (homeOn ? 1 : 0) - (grp ? 1 : 0) <= 1, true, f + ' 亮太多格');
    if (want === 'none') assert.equal(/\bactive\b/.test(nav[0]), false, f + ' 這一頁頂欄不該亮');
  });
  /* 開機程式的分頁根頁清單、分頁列的五格、手機版不再有點 .nav-btn 展開的程式 */
  const shell = read('js/app-shell.js');
  const tabHrefs = Array.from(shell.matchAll(/\{ key: '(\w+)', label: '([^']+)', href: '([^']+)'/g)).map((m) => m[3]);
  assert.deepEqual(tabHrefs, ['index.html', 'learn.html', 'warmup.html', 'drill.html', 'me.html']);
  const ROOTS = "['index.html', 'learn.html', 'warmup.html', 'drill.html', 'me.html']";
  let boots = 0;
  PAGES.forEach((f) => {
    const m = /d\.classList\.add\('is-tab-root'\)/.test(read(f));
    if (!m) return;
    boots++;
    assert.ok(read(f).indexOf(ROOTS + '.indexOf(p) > -1') > -1, f + ' 的分頁根頁清單不是五格');
  });
  assert.ok(boots >= 27, '有開機程式的頁:' + boots);
  assert.equal(/nav-btn/.test(read('js/common.js')), false, 'js/common.js 還在處理 .nav-btn 的點擊');
  /* 新頁 warmup.html 登記:分頁列、版面檢查頁清單、sitemap 建置工具(noindex 的頁不收錄) */
  assert.ok(/'warmup\.html'/.test(shell.split('const TITLES')[0]), '分頁列沒有練練手感');
  assert.ok(/warmup\.html/.test(read('tools/check_layout.js')), 'check_layout 的頁清單沒有 warmup.html');
  assert.match(read('warmup.html'), /<title>練練手感 - 衝衝英文<\/title>/);
  ['learn.html:日常學習', 'warmup.html:練練手感', 'drill.html:刷刷題目', 'review.html:錯題本'].forEach((x) => {
    const [f, name] = x.split(':');
    assert.match(read(f), new RegExp('<title>' + name + ' - 衝衝英文</title>'), f);
    if (f !== 'review.html') assert.match(read(f), new RegExp('<h1>' + name + '</h1>'), f);
    const d = meta(head(f), 'name', 'description');
    assert.ok(d && d.length >= 24 && d.length <= 70, f + ' 說明 ' + (d || '').length + ' 字');
  });
  const descs = ['learn.html', 'warmup.html', 'drill.html', 'review.html'].map((f) => meta(head(f), 'name', 'description'));
  assert.equal(new Set(descs).size, 4, '四頁說明要各不相同');
  /* 分組頁:磚沒有說明句(數字行不超過 12 字、沒有句號與逗號),主打磚的實色按鈕剛好一顆 */
  Object.keys(GROUPS).forEach((f) => {
    const src = read(f);
    assert.equal((src.match(/class="btn primary tile-go"/g) || []).length, 1, f + ' 實色主按鈕要剛好一顆');
    assert.equal((src.match(/class="module-card tile/g) || []).length, 4, f + ' 要一塊主打磚加三塊一般磚');
    Array.from(src.matchAll(/<p>([^<]*)<\/p>/g)).filter((m) => m.index > src.indexOf('<main')).filter((m) => m.index < src.indexOf('</main>'))
      .forEach((m) => assert.ok(m[1].length <= 12 && !/[，。；]/.test(m[1]), f + ' 的磚數字行太長或有標點:' + m[1]));
    assert.equal(/<main[\s\S]*?<\/h1>\s*<p/.test(src), false, f + ' 標題下面不放說明句');
  });
  assert.ok(read('js/hub.js').length > 0 && /<script src="js\/hub\.js"><\/script>/.test(read('learn.html')) && /<script src="js\/hub\.js"><\/script>/.test(read('drill.html')));
  /* 「每日複習」全站改叫「錯題本」(首頁內容區之外) */
  PAGES.forEach((f) => assert.equal(/每日複習/.test(read(f).replace(/<main[\s\S]*?<\/main>/, '')), false, f + ' 還有「每日複習」'));
  assert.equal(/每日複習/.test(read('manifest.json')), false, 'manifest 還有「每日複習」');
  const man = JSON.parse(read('manifest.json'));
  assert.deepEqual(man.shortcuts.map((x) => [x.name, x.url]), [['錯題本', './review.html'], ['題庫刷題', './practice.html'], ['每日練習', './daily.html']]);
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
const APP_ICONS = ['img/icon-180.png', 'img/icon-192.png', 'img/icon-512.png', 'img/icon-maskable-512.png'];
const FAV_FILES = ['favicon.ico', 'img/favicon-48.png', 'img/favicon-96.png', 'img/favicon-192.png', 'img/favicon.svg'];
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
T['App 圖示:apple-touch-icon 180 不透明;192、512 尺寸對;maskable 512 安全區(中間直徑 80% 的圓)外只有底色;四張是同一次產生的,沒有新舊混在一起'] = () => {
  const t = png('img/icon-180.png');
  assert.deepEqual([t.w, t.h], [180, 180]);
  for (let i = 3; i < t.data.length; i += 4) assert.equal(t.data[i], 255, 'apple-touch-icon 有透明的地方,iPhone 上會變黑底');
  assert.deepEqual([png('img/icon-192.png').w, png('img/icon-192.png').h], [192, 192]);
  assert.deepEqual([png('img/icon-512.png').w, png('img/icon-512.png').h], [512, 512]);
  const m = png('img/icon-maskable-512.png');
  assert.deepEqual([m.w, m.h], [512, 512]);
  assert.equal(IC.safeZoneProblem(m), null, 'maskable 安全區外有圖案');
  /* 四張要是同一次 build_icons 產生的(PNG 裡記的 App 圖、maskable、底色組合一樣),不能新舊混在一起;
     四張都沒有記號的是 build_icons 之前就有的舊圖 */
  const tags = APP_ICONS.map((f) => IC.readSourceTag(fs.readFileSync(path.join(REPO, f))));
  if (tags.some((t) => t)) {
    assert.ok(tags.every((t) => t === tags[0]) && /^build_icons app sha256:/.test(tags[0]),
      'App 圖示不是同一次產生的(' + APP_ICONS.map((f, k) => f + ' ' + (tags[k] || '沒有記號')).join(';') + '),重跑 node tools/build_icons.js … --only app');
  }
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
  /* App 圖示的組合記號:App 圖、maskable、底色任一個不同就不同 */
  const t0 = IC.appTag('<svg/>', null, [1, 2, 3]);
  assert.match(t0, /^build_icons app sha256:[0-9a-f]{64}$/);
  assert.equal(IC.appTag('<svg/>\r\n', null, [1, 2, 3]), IC.appTag('<svg/>\n', null, [1, 2, 3]), '換行不同算同一張');
  assert.equal(new Set([t0, IC.appTag('<svg />', null, [1, 2, 3]), IC.appTag('<svg/>', '<svg/>', [1, 2, 3]), IC.appTag('<svg/>', null, [1, 2, 4])]).size, 4);
};
T['build_icons:全部算好、檢查過才寫;maskable 安全區不過時一個檔都不動、不留暫存檔;寫的時候四張 App 圖示一起換、記號一樣'] = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_seo-icons-'));
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#22aa44"/></svg>';
    const a = path.join(dir, 'app.svg'), bad = path.join(dir, 'bad_mask.svg'), out = path.join(dir, 'out');
    fs.writeFileSync(a, svg);
    fs.writeFileSync(bad, svg.replace('</svg>', '<rect width="15" height="15" fill="red"/></svg>'));
    fs.mkdirSync(path.join(out, 'img'), { recursive: true });
    FAV_FILES.concat(APP_ICONS).forEach((f) => fs.writeFileSync(path.join(out, f), 'old ' + f));
    const snap = () => {
      const o = {};
      const walk = (d) => fs.readdirSync(path.join(out, d)).forEach((f) => {
        const r = d ? d + '/' + f : f;
        if (fs.statSync(path.join(out, r)).isDirectory()) walk(r); else o[r] = fs.readFileSync(path.join(out, r)).toString('base64');
      });
      walk('');
      return o;
    };
    /* 不開 Chrome:綠色方塊;SVG 裡有紅色的那張在左上角畫紅色(maskable 安全區外有圖案) */
    const render = (jobs) => jobs.map((j) => {
      const n = j.size, im = { w: n, h: n, data: Buffer.alloc(n * n * 4, Buffer.from([34, 170, 68, 255])) };
      if (/fill="red"/.test(j.svg)) for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) im.data.set([255, 0, 0, 255], (y * n + x) * 4);
      return im;
    });
    const run = (args) => IC.main([a].concat(args, ['--out', out]), { render, log: () => {} });
    const before = snap();
    assert.throws(() => run(['--maskable', bad]), /maskable 安全區/);
    assert.deepEqual(snap(), before, '全套:maskable 安全區不過,還是先寫了別的檔');
    assert.throws(() => run(['--only', 'app', '--maskable', bad]), /maskable 安全區/);
    assert.deepEqual(snap(), before, '--only app:maskable 安全區不過,還是先寫了別的檔');
    /* 暫存檔寫到一半失敗(icon-512 的暫存檔名被資料夾佔住):已寫的暫存檔刪掉,原本的檔不動 */
    const block = path.join(out, 'img', 'icon-512.png.build_icons-' + process.pid + '.tmp');
    fs.mkdirSync(block);
    assert.throws(() => run(['--maskable', a]), /寫暫存檔失敗/);
    fs.rmdirSync(block);
    assert.deepEqual(snap(), before, '暫存檔寫到一半失敗,原本的檔被換掉或留下暫存檔');
    /* 成功:--only app 只換四張 App 圖示,記號一樣;favicon 系列不動;沒有多出別的檔 */
    run(['--only', 'app']);
    const s1 = snap();
    assert.deepEqual(Object.keys(s1).sort(), Object.keys(before).sort(), '多出或少了檔案');
    FAV_FILES.forEach((f) => assert.equal(s1[f], before[f], '--only app 動到 ' + f));
    APP_ICONS.forEach((f) => assert.notEqual(s1[f], before[f], f + ' 沒換'));
    const tagsOf = (s) => APP_ICONS.map((f) => IC.readSourceTag(Buffer.from(s[f], 'base64')));
    const t1 = tagsOf(s1);
    assert.ok(t1.every((t) => t === t1[0]) && t1[0] === IC.appTag(svg, null, [34, 170, 68]), JSON.stringify(t1));
    /* 成功:全套,另給 maskable;九個檔都換,App 圖示記號換成新的組合 */
    run(['--maskable', a]);
    const s2 = snap();
    assert.deepEqual(Object.keys(s2).sort(), Object.keys(before).sort(), '多出或少了檔案');
    FAV_FILES.concat(APP_ICONS).forEach((f) => assert.notEqual(s2[f], before[f], f + ' 沒換'));
    const t2 = tagsOf(s2);
    assert.ok(t2.every((t) => t === t2[0]) && t2[0] === IC.appTag(svg, svg, [34, 170, 68]) && t2[0] !== t1[0], JSON.stringify(t2));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

let pass = 0;
const names = Object.keys(T);
for (const n of names) {
  try { T[n](); pass++; console.log('PASS ' + n); }
  catch (e) { console.log('FAIL ' + n + '  →  ' + (e && e.message)); }
}
console.log(pass + ' / ' + names.length + ' 通過');
process.exit(pass === names.length ? 0 : 1);
