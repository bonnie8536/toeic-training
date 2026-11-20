/* 題目更正紀錄(corrections.html、data/corrections.json、tools/build_corrections.js、學習記錄的更正連結)。
   不連網、不開瀏覽器、不改 repo 檔案。用法:node tools/test_corrections.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const K = require('./owner_test_kit.js');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const readJson = (f) => JSON.parse(read(f).replace(/^﻿/, ''));
const B = require('./build_corrections.js');
const DATA = readJson('data/corrections.json');
const RETIRED = readJson('data/retired.json').retired;
const MD = 'D:/claudecode/刷刷英文開發/題庫研究/全審/更正紀錄.md';
const T = {};

T['建置結果與檔案一致,共 181 列(12 答案更正、146 文字修正、23 淘汰)'] = () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build_corrections.js'), '--check'], { encoding: 'utf8' });
  const by = (k) => DATA.rows.filter((x) => x.k === k).length;
  const sum = by('answer') + '/' + by('text') + '/' + by('retired');
  return { ok: r.status === 0 && DATA.rows.length === 181 && sum === '12/146/23', detail: 'exit ' + r.status + ',' + DATA.rows.length + ' 列(' + sum + ')' };
};
T['筆數對得上全審的更正紀錄(研究資料夾在才比)'] = () => {
  if (!fs.existsSync(MD)) return { ok: true, detail: '略過(沒有研究資料夾)' };
  const md = fs.readFileSync(MD, 'utf8').split(/\r?\n/);
  const rows = md.slice(6, 408).filter((l) => /^\| 2026-/.test(l)).length;   // 第一到第八節(第九節在別的分支)
  const src = readJson('tools/corrections/source.json').rows.filter((r) => r.k === 'text').length;
  const minor = src - DATA.rows.filter((x) => x.k === 'text').length;   // 輕微項不上公開頁
  return { ok: rows === DATA.rows.length + minor && minor === 150, detail: 'md ' + rows + ' 列,json ' + DATA.rows.length + ' 列,輕微項 ' + minor + ' 列' };
};
T['淘汰題全部列出,替代題對得上,日期與原因照 retired.json'] = () => {
  const out = DATA.rows.filter((x) => x.k === 'retired');
  const bad = RETIRED.filter((x) => { const o = out.find((r) => r.id === x.id); return !o || o.n !== (x.replacedBy || undefined) || o.d !== x.date || o.a !== 'P' + x.part || o.p !== x.reason; });
  return { ok: bad.length === 0 && out.length === RETIRED.length, detail: RETIRED.length + ' 筆,對不上 ' + bad.length };
};
T['替代題都在題庫'] = () => {
  const ids = B.bankIds(REPO);
  const miss = DATA.rows.filter((x) => x.n && !ids.has(x.n));
  return { ok: miss.length === 0 && ids.size > 1000, detail: '題庫 id ' + ids.size + ',缺 ' + miss.length };
};
T['每列只有規定欄位,不放題目原文'] = () => {
  const ok = DATA.rows.every((x) => Object.keys(x).every((k) => ['d', 'id', 'a', 'k', 'p', 'r', 'i', 'n'].includes(k)) && (x.k === 'retired' || !('n' in x)) && typeof x.i === 'string' && x.i.length > 0);
  const eng = DATA.rows.filter((x) => /[A-Za-z]+(?:[ ,.'-]+[A-Za-z]+){3,}/.test(x.p + ' ' + x.r));
  const q = DATA.rows.filter((x) => /[?？]/.test(x.p + x.r));
  return { ok: ok && !eng.length && !q.length, detail: '欄位 ' + ok + ',英文句子 ' + eng.length + ',問號 ' + q.length + (eng[0] ? ' ' + eng[0].id : '') };
};
T['文案規則:無半形標點、破折號、emoji、人名,每句不超過 60 字'] = () => {
  const bad = [];
  DATA.rows.forEach((x) => {
    B.lintText(x.p).concat(B.lintText(x.r), B.lintText(x.i)).forEach((b) => bad.push(x.id + b));
    if (/審過|專家|審訂|人工/.test(x.p + x.r)) bad.push(x.id + '字樣');
  });
  return { ok: bad.length === 0, detail: bad.length + ' 處 ' + bad.slice(0, 3) };
};
T['題號對得上題庫(題號第一段是題庫現有的題、題組、單元,或已淘汰的 id)'] = () => {
  const bank = B.bankIds(REPO);
  const retired = new Set(RETIRED.map((x) => x.id));
  const miss = DATA.rows.filter((x) => x.k !== 'retired' && !bank.has(x.id.split(':')[0]) && !retired.has(x.id.split(':')[0]));
  return { ok: miss.length === 0, detail: '找不到 ' + miss.length + ' 列 ' + miss.slice(0, 3).map((x) => x.id) };
};
T['頁面登記:開機清單、canonical、og、TITLES、check_layout、sitemap、建置工具'] = () => {
  const h = read('corrections.html');
  const checks = {
    boot: /'refund\.html', 'corrections\.html'\]\.indexOf/.test(h),
    canon: h.includes('rel="canonical" href="https://www.rushuplanguage.com/corrections.html"'),
    og: h.includes('og:url" content="https://www.rushuplanguage.com/corrections.html"') && h.includes('<title>題目更正紀錄 - 衝衝英文</title>'),
    order: h.indexOf('js/app-shell.js') > -1 && h.indexOf('js/corrections.js') > h.indexOf('js/app-shell.js') && !/common\.js|cloud\.js|supabase/.test(h),
    h1: /<h1>題目更正紀錄<\/h1>\s*<div id="corr-app">/.test(h), noscript: h.includes('<noscript>'),
    titles: read('js/app-shell.js').includes("'corrections.html': '題目更正紀錄'"),
    layout: read('tools/check_layout.js').includes('refund.html,corrections.html'),
    sitemap: read('sitemap.xml').includes('/corrections.html</loc>'),
    sitemapJson: read('tools/build_sitemap.js').includes("'data/corrections.json'"),
  };
  const bad = Object.keys(checks).filter((k) => !checks[k]);
  return { ok: !bad.length, detail: bad.length ? '缺 ' + bad : '全部登記' };
};
T['頁尾連結:27 頁都有(含自己與 404),在退款政策之後、客服信箱之前'] = () => {
  const pages = fs.readdirSync(REPO).filter((f) => /\.html$/.test(f) && /class="foot-links"/.test(read(f)));
  const bad = pages.filter((f) => { const s = f === '404.html' ? '/' : ''; return !read(f).includes('<a href="' + s + 'refund.html">退款政策</a><a href="' + s + 'corrections.html">題目更正紀錄</a><a href="mailto:'); });
  return { ok: pages.length === 27 && !bad.length, detail: pages.length + ' 頁,缺 ' + bad };
};

/* ---------- 頁面程式(假 DOM) ---------- */
function page() {
  const dom = K.fakeDom();
  const ctx = { console, document: dom.document, window: {}, location: { search: '' }, Promise, setTimeout };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/corrections.js'), ctx);
  const root = new dom.Node('div');
  dom.body.append(root);
  return { ctx, root, dom, C: ctx.CORRECTIONS };
}
const okFetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(DATA) });
const rowsIn = (root) => root.find((n) => n.tagName === 'TR' && n.parentNode && n.parentNode.tagName === 'TBODY');
const chip = (root, t) => root.byClass('chip').find((n) => n.textContent === t);
const detailsOf = (root) => root.find((n) => n.tagName === 'DETAILS');

T['頁面:三組小標與筆數,答案更正與淘汰預設展開、文字修正收合'] = async () => {
  const p = page(); await p.C.load(p.root, okFetch, '');
  const ds = detailsOf(p.root);
  const names = ds.map((d) => d.find((n) => n.tagName === 'SUMMARY')[0].textContent);
  const open = ds.map((d) => d.hasAttribute('open'));
  return { ok: names.join() === '答案更正(12),淘汰換新(23),題目文字修正(146)' && open.join() === 'true,true,false', detail: names.join(' / ') + ' ' + open };
};
T['頁面:篩選 P5 只剩 P5 的列'] = async () => {
  const p = page(); await p.C.load(p.root, okFetch, '');
  await chip(p.root, 'P5').fire('click');
  const rows = rowsIn(p.root);
  const areas = new Set(rows.map((r) => r.children[2].textContent));
  const expect = DATA.rows.filter((x) => x.a === 'P5').length;
  return { ok: rows.length === expect && areas.size === 1 && areas.has('P5') && chip(p.root, 'P5').getAttribute('aria-pressed') === 'true', detail: rows.length + ' / ' + expect };
};
T['頁面:題號搜尋與空結果'] = async () => {
  const p = page(); await p.C.load(p.root, okFetch, '');
  const s = p.root.byClass('corr-search')[0];
  s.value = ' P7-B4-2 '; await s.fire('input');
  const rows = rowsIn(p.root);
  s.value = 'zzzz'; await s.fire('input');
  const none = p.root.textContent.includes('沒有符合的紀錄。');
  return { ok: rows.length >= 1 && rows.every((r) => r.children[1].textContent.toLowerCase().includes('p7-b4-2')) && none, detail: rows.length + ' 列,空結果文案 ' + none };
};
T['頁面:?q=p7-b4-2:1 標出整組淘汰那一列;q 指到文字修正會展開該組'] = async () => {
  const p = page(); await p.C.load(p.root, okFetch, 'p7-b4-2:1');
  const hit = rowsIn(p.root).filter((r) => r.className.includes('is-target'));
  const q2 = DATA.rows.find((x) => x.k === 'text');
  const p2 = page(); await p2.C.load(p2.root, okFetch, q2.id);
  const d2 = detailsOf(p2.root)[2];
  return { ok: hit.length === 1 && hit[0].children[1].textContent === 'p7-b4-2' && hit[0].getAttribute('aria-current') === 'true' && d2.hasAttribute('open'), detail: hit.length + ' 列;文字組展開 ' + d2.hasAttribute('open') };
};
T['公開頁用語:問題欄只有學生看得懂的類別,沒有猜題訣竅與內部術語;三組都有「影響」,答案更正與淘汰寫明尚未自動排除'] = () => {
  const text = DATA.rows.filter((x) => x.k === 'text');
  const cats = new Set(text.map((x) => x.p));
  const leak = DATA.rows.filter((x) => /最長|猜中|猜得|逐字|字面|真實|網域|英式|拼法|不聽也|不看文章/.test(x.p + x.r + x.i));
  const imp = (k) => DATA.rows.filter((x) => x.k === k).every((x) => x.i === B.IMPACT[k]);
  return { ok: leak.length === 0 && imp('answer') && imp('retired') && imp('text') && /尚未自動排除/.test(B.IMPACT.answer) && /尚未自動排除/.test(B.IMPACT.retired) && Array.from(cats).every((c) => ['不只一個答案', '題目內容有誤', '英文用字有誤', '題意不清楚'].includes(c)), detail: Array.from(cats).join('、') + ';洩漏 ' + leak.length };
};
T['頁面:處理欄文案(答案更正寫明不重算)'] = async () => {
  const p = page(); await p.C.load(p.root, okFetch, '');
  const t = p.root.textContent;
  return { ok: t.includes('答案改為 A') && t.includes('以前的作答紀錄與模擬考分數不重算，能力統計尚未自動排除。') && t.includes('淘汰，換新題 p5-b13-01') && t.includes('淘汰，替代題之後補'), detail: '三種處理句都在' };
};
T['頁面:載入失敗(網路錯、非 200、格式不對)顯示錯誤句,不丟錯'] = async () => {
  const outs = [];
  for (const f of [() => Promise.reject(new Error('x')), () => Promise.resolve({ ok: false }), () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })]) {
    const p = page(); await p.C.load(p.root, f, ''); outs.push(p.root.textContent);
  }
  return { ok: outs.every((t) => t === '更正紀錄載入失敗，請稍後再試。'), detail: outs.length + ' 種失敗' };
};
T['頁面:文字一律 textContent,不用 innerHTML'] = () => ({ ok: !/innerHTML|insertAdjacentHTML|document\.write/.test(read('js/corrections.js')), detail: '沒有 innerHTML' });

/* ---------- 學習記錄的更正連結 ---------- */
const { historyEnv } = require('./history_kit.js');
const corrFetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(DATA) });
const linksIn = (el) => el.find((n) => n.tagName === 'A' && /corrections\.html/.test(n.attrs.href || ''));
const recsOf = (ids) => ids.map(([m, id], i) => ({ m, id, c: 0, ok: false, t: Date.now() - (ids.length - i) * 1000 }));
/* 畫面新的在前,所以列的順序是反的 */
const rowOf = (H, ids, m, id) => ids.slice().reverse().findIndex((x) => x[0] === m && x[1] === id);

T['學習記錄:指向已淘汰的題出現「題目更正紀錄」連結(單題、整組淘汰的小題都對得到)'] = async () => {
  const ids = [['p5', 'p5-b2-17'], ['p7', 'p7-b4-2:1'], ['l2', 'l2-02']];
  const H = await historyEnv(recsOf(ids), { fetch: corrFetch });
  const out = ids.map(([m, id]) => { const r = H.rows()[rowOf(H, ids, m, id)]; const a = linksIn(r)[0]; return a && [a.textContent, a.attrs.href]; });
  const want = ids.map(([, id]) => ['題目更正紀錄', 'corrections.html?q=' + encodeURIComponent(id)]);
  return { ok: JSON.stringify(out) === JSON.stringify(want), detail: JSON.stringify(out) };
};
T['學習記錄:題目還在但被更正過的,展開後有連結;沒更正過的沒有'] = async () => {
  const ids = [['g', 'ga-02:6'], ['p6', 'p6-b7-1:2'], ['p5', 'p5-b1-01']];
  const H = await historyEnv(recsOf(ids), { fetch: corrFetch });
  const res = [];
  for (const [m, id] of ids) {
    const body = await H.open(rowOf(H, ids, m, id));
    const a = linksIn(body)[0];
    res.push(a ? a.textContent + '|' + a.attrs.href : null);
  }
  return { ok: res[0] === '這題曾更正，看更正紀錄|corrections.html?q=ga-02%3A6' && res[1] === '這題曾更正，看更正紀錄|corrections.html?q=p6-b7-1%3A2' && res[2] === null, detail: JSON.stringify(res) };
};
T['學習記錄:更正紀錄晚到也會補上連結;fetch 失敗、壞掉、沒有 fetch 都不報錯、不出連結'] = async () => {
  const ids = [['p5', 'p5-b2-17']];
  let release;
  const slow = () => new Promise((r) => { release = () => r({ ok: true, json: () => Promise.resolve(DATA) }); });
  const H1 = await historyEnv(recsOf(ids), { fetch: slow });
  const before = linksIn(H1.root).length;
  release(); await K.settle();
  const after = linksIn(H1.root).length;
  const outs = [];
  for (const f of [() => Promise.reject(new Error('x')), () => Promise.resolve({ ok: false }), () => Promise.resolve({ ok: true, json: () => Promise.resolve({ bad: 1 }) }), () => { throw new Error('sync'); }, undefined]) {
    const H = await historyEnv(recsOf(ids), { fetch: f });
    outs.push(linksIn(H.root).length + '/' + H.rows().length);
  }
  return { ok: before === 0 && after === 1 && outs.every((x) => x === '0/1'), detail: before + ' → ' + after + ';失敗情境 ' + outs };
};

K.run(T);
