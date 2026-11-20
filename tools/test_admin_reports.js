/* 教師後台的「題目回報」區(js/admin-reports.js,接在 js/admin.js 上)。
   用 tools/owner_test_kit.js 的假 DOM 與假 Supabase;不連網、不改 repo 檔案。用法:node tools/test_admin_reports.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const K = require('./owner_test_kit.js');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const J = (x) => JSON.stringify(x);
const S1 = '5b000000-0000-4000-8000-000000000001', S2 = '5b000000-0000-4000-8000-000000000002', S3 = '5b000000-0000-4000-8000-000000000003';
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const meta = (uid, name) => ({ user_id: uid, k: '_meta', v: { name, email: name + '@example.com' }, updated_at: iso(NOW - 864e5 * 30) });
const rep = (uid, entries, at) => ({ user_id: uid, k: 'q_reports', v: entries, updated_at: iso(at || NOW) });
const E = (c, n, t) => ({ c, n, t, f: t });
const KEY = 'p5:p5-b1-01';
const DATA_FILES = ['part5', 'part6', 'part7', 'listening', 'grammar', 'articles', 'phrases', 'ear'];

/* 站長開後台:rows 是 progress 表讀回來的列。o.owner 為假就是普通老師。 */
async function open(rows, o) {
  const opts = o || {};
  const w = K.world();
  w.progressRows = rows;
  const upserts = [];
  const from = w.client.from;
  w.client.from = (t) => {
    const b = from(t);
    const up = b.upsert;
    b.upsert = (row, opt) => { upserts.push({ table: t, row, opt }); return up.call(b, row, opt); };
    return b;
  };
  const L = K.context(w, { paid: false });
  const ctx = L.ctx;
  ctx.CLOUD.isOwner = async () => opts.owner !== false;
  ctx.CLOUD.accountCheck = () => '';
  ctx.TOEIC = {};
  ctx.window.TOEIC = ctx.TOEIC;
  (opts.data || DATA_FILES).forEach((f) => vm.runInContext(read('data/' + f + '.js'), ctx, { filename: f }));
  ctx.bandEstimate = () => ({ band: '-' });
  const root = new L.dom.Node('div'); root.attrs.id = 'admin-root'; L.dom.body.append(root);
  ctx.$ = (sel) => (sel === '#admin-root' ? root : null);
  vm.runInContext(read('js/report.js'), ctx);
  vm.runInContext(read('js/admin-classes.js'), ctx);
  if (opts.reports !== false) vm.runInContext(read('js/admin-reports.js'), ctx);
  vm.runInContext(read('js/admin.js'), ctx);
  await K.settle();
  const section = () => root.byClass('rpa')[0] || null;
  return { w, ctx, root, upserts, dom: L.dom, section, items: () => root.byClass('rpa-item') };
}
const head = (item) => item.byClass('rpa-head')[0];
const expand = async (item) => { await head(item).fire('click'); await K.settle(); };
const btn = (scope, t) => scope.byText(t)[0];

const BASE = [meta(S1, '小安'), meta(S2, '小宏'), meta(S3, '小美')];

const T = {};
T['只有站長:不是站長沒有「題目回報」區、也沒有任何多出來的節點;是站長才建'] = async () => {
  const rows = BASE.concat(rep(S1, { [KEY]: E('typo', '字', NOW) }));
  const a = await open(rows, { owner: false });
  const b = await open(rows, { reports: false });
  const c = await open(rows, { owner: true });
  const same = a.root.textContent === b.root.textContent && a.root.find(() => true).length === b.root.find(() => true).length;
  return { ok: !a.section() && same && !!c.section(), detail: '非站長無區 ' + !a.section() + ',DOM 跟沒裝時一樣 ' + same + ',站長有區 ' + !!c.section() };
};
T['彙整:三個學生回報同一題只有一列、人數 3,依人數排序;展開看到三位的暱稱、類型、說明'] = async () => {
  const rows = BASE.concat(
    rep(S1, { [KEY]: E('wrong_key', '我覺得是 B', NOW - 3000), 'p5:p5-b1-02': E('other', '', NOW) }),
    rep(S2, { [KEY]: E('multi_key', 'A 也可以', NOW - 2000) }),
    rep(S3, { [KEY]: E('typo', '第二行有錯字', NOW - 1000) }));
  const A = await open(rows);
  const items = A.items();
  await expand(items[0]);
  const text = items[0].textContent;
  return { ok: items.length === 2 && head(items[0]).textContent.includes('p5-b1-01') && head(items[0]).textContent.includes('3 人') && head(items[1]).textContent.includes('1 人')
    && ['小安', '小宏', '小美', '答案有誤', '不只一個答案', '題目或選項有錯字', '我覺得是 B', 'A 也可以', '第二行有錯字'].every((s) => text.includes(s)), detail: items.length + ' 列;' + head(items[0]).textContent.slice(0, 60) };
};
T['資料安全:學生繞過介面寫 constructor、toString、hasOwnProperty、__proto__ 等鍵,其他人的回報照樣顯示,不丟錯'] = async () => {
  const bad = JSON.parse('{"constructor":{"c":"typo","n":"","t":' + NOW + '},"toString":{"c":"typo","n":"","t":' + NOW + '},"hasOwnProperty":{"c":"typo","n":"","t":' + NOW + '},"__proto__":{"c":"typo","n":"","t":' + NOW + '},"p5:p5-b1-02":{"c":"typo","n":"好的","t":' + NOW + '}}');
  const rows = BASE.concat(rep(S1, bad), rep(S2, { [KEY]: E('wrong_key', '真的', NOW - 5) }));
  const A = await open(rows);
  const agg = A.ctx.ADMIN_REPORTS.aggregate(rows, () => 'x');
  const keys = agg.map((g) => g.key).sort();
  return { ok: !!A.section() && A.items().length === 2 && J(keys) === J(['p5:p5-b1-01', 'p5:p5-b1-02']), detail: J(keys) + ' / ' + A.items().length + ' 列' };
};
T['載入失敗:彙整出錯時顯示一行「題目回報載入失敗」,後台其他部分照常'] = async () => {
  const A = await open(BASE);
  const box = new A.dom.Node('div'); A.dom.body.append(box);
  await A.ctx.ADMIN_REPORTS.mount(box, { rows: BASE.concat(rep(S1, { [KEY]: E('typo', '', NOW) })), nameOf: () => { throw new Error('boom'); } });
  const sec = box.byClass('rpa')[0];
  return { ok: !!sec && sec.textContent.includes('題目回報載入失敗') && A.items().length === 0, detail: sec ? sec.textContent : '沒有區塊' };
};
T['純文字:補充說明含 <img onerror> 時畫面是文字,沒有 img 節點'] = async () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const A = await open(BASE.concat(rep(S1, { [KEY]: E('other', evil, NOW) })));
  await expand(A.items()[0]);
  const bad = A.root.find((n) => n.tagName === 'IMG' || n.tagName === 'SCRIPT');
  return { ok: bad.length === 0 && A.section().textContent.includes(evil) && !/innerHTML/.test(read('js/admin-reports.js').replace(/\/\*[\s\S]*?\*\//g, '')), detail: bad.length + ' 個危險節點' };
};
T['CSV:=cmd 開頭的儲存格前面有單引號;逗號、雙引號、換行正確;中文不亂碼;檔名有日期'] = async () => {
  const rows = BASE.concat(rep(S1, { [KEY]: E('other', '=HYPERLINK("x")', NOW), 'p5:p5-b1-02': E('typo', '甲,乙\n"丙"', NOW), 'p5:p5-b1-03': E('typo', '+1 @a -b', NOW) }));
  const A = await open(rows);
  await btn(A.section(), '下載回報（CSV）').click();
  await K.settle();
  const csv = A.ctx.blobs[0] || '';
  const lines = csv.split('\r\n');
  const today = new Date();
  const name = '題目回報_' + today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0') + '.csv';
  return { ok: csv.startsWith('﻿題號,模組,類型,補充說明,回報者暱稱,回報時間') && csv.includes('"\'=HYPERLINK(""x"")"') && csv.includes('"甲,乙 ""丙"""') && csv.includes("'+1 @a -b") && csv.includes('Part 5') && csv.includes('小安')
    && A.ctx.downloads[0] === name && lines.length >= 4, detail: name + ' ' + lines.length + ' 行' };
};
T['csvCell:四種開頭都補單引號,正常字不動'] = async () => {
  const A = await open(BASE);
  const f = A.ctx.ADMIN_REPORTS.csvCell;
  return { ok: f('=1') === "'=1" && f('+1') === "'+1" && f('-1') === "'-1" && f('@x') === "'@x" && f('正常') === '正常' && f('a,b') === '"a,b"' && f('a\nb') === '"a\nb"' && f('"x"') === '"""x"""', detail: [f('=1'), f('a,b')].join(' ') };
};
T['已處理:標記寫到站長自己的 progress 列 rreview,不碰別人的列;重載後還在;之後有新回報會再出現'] = async () => {
  const rows = BASE.concat(rep(S1, { [KEY]: E('typo', '', NOW - 5000) }));
  const A = await open(rows);
  await expand(A.items()[0]);
  await btn(A.items()[0], '標為已處理').click();
  await K.settle();
  const up = A.upserts.filter((u) => u.row.k === 'rreview');
  const onlyMine = A.upserts.every((u) => u.table === 'progress' && u.row.user_id === K.OWNER_ID && u.row.k === 'rreview');
  const saved = up[0] && up[0].row.v[KEY];
  const hiddenNow = A.items().length === 0;
  /* 重載:帶著剛寫的 rreview */
  const B = await open(rows.concat({ user_id: K.OWNER_ID, k: 'rreview', v: up[0].row.v, updated_at: iso(NOW) }));
  const hiddenAfter = B.items().length === 0 && B.section().textContent.includes('顯示已處理（1）');
  await btn(B.section(), '顯示已處理（1）').click();
  const shown = B.items().length === 1 && B.items()[0].textContent.includes('已處理');
  /* 處理之後又有新回報 */
  const C = await open(rows.concat({ user_id: K.OWNER_ID, k: 'rreview', v: { [KEY]: { s: 'done', t: NOW - 1000 } }, updated_at: iso(NOW) }, rep(S2, { [KEY]: E('typo', '', NOW) })));
  return { ok: up.length === 1 && onlyMine && saved && saved.s === 'done' && hiddenNow && hiddenAfter && shown && C.items().length === 1, detail: J({ ups: up.length, onlyMine, saved: !!saved, hiddenNow, hiddenAfter, shown, resurfaced: C.items().length }) };
};
T['已處理:存不進去時顯示錯誤、不改畫面'] = async () => {
  const A = await open(BASE.concat(rep(S1, { [KEY]: E('typo', '', NOW) })));
  A.ctx.CLOUD.accountCheck = () => '帳號已經換了';
  await expand(A.items()[0]);
  await btn(A.items()[0], '標為已處理').click();
  await K.settle();
  return { ok: A.items().length === 1 && A.items()[0].textContent.includes('帳號已經換了') && A.upserts.length === 0, detail: 'upserts ' + A.upserts.length };
};
T['最近活動:只有回報沒有其他練習的學生,不在本週動態、最近活動不是今天'] = async () => {
  const old = iso(NOW - 864e5 * 30);
  const rows = [{ user_id: S1, k: '_meta', v: { name: '只回報', email: 'a@example.com' }, updated_at: old }, rep(S1, { [KEY]: E('typo', '', NOW) })];
  const A = await open(rows);
  const text = A.root.textContent;
  const rowsTr = A.root.find((n) => n.tagName === 'TR');
  const cells = rowsTr.length > 1 ? rowsTr[1].children.map((c) => c.textContent) : [];
  const today = iso(NOW).slice(0, 10);
  return { ok: !text.includes('本週動態（近 7 天）：') && cells[1] === old.slice(0, 10) && cells[1] !== today && !text.includes('只回報：'), detail: J(cells.slice(0, 2)) };
};
T['淘汰題:回報的題已淘汰,看題目顯示「這題已淘汰」與更正紀錄連結,不丟錯'] = async () => {
  const A = await open(BASE.concat(rep(S1, { 'p5:p5-b2-17': E('wrong_key', '', NOW), 'p7:p7-b4-2:1': E('typo', '', NOW - 10) })));
  const out = [];
  for (const it of A.items()) {
    await expand(it);
    await btn(it, '看題目').click();
    await K.settle();
    const a = it.find((n) => n.tagName === 'A' && /corrections\.html/.test(n.attrs.href || ''))[0];
    out.push([it.textContent.includes('這題已淘汰'), a && a.attrs.href]);
  }
  return { ok: out.length === 2 && out.every((x) => x[0] && /^corrections\.html\?q=/.test(x[1])), detail: J(out) };
};
T['看題目:題目還在就顯示題幹、選項、正解與詳解(P5、P6、P7、聽力、文法、文章、片語、英語耳)'] = async () => {
  const keys = ['p5:p5-b1-01', 'p6:p6-b1-1:2', 'p7:p7-b1-1:0', 'l1:l1-01', 'l3:l3-11:1', 'g:ga-01:3', 'r:art-1a:1', 'ph:ph-101', 'ear:n-01', 'ear:d-01'];
  const ent = {}; keys.forEach((k, i) => { ent[k] = E('unclear', '', NOW - i); });
  const A = await open(BASE.concat(rep(S1, ent)));
  const res = [];
  for (const it of A.items()) {
    await expand(it);
    await btn(it, '看題目').click();
    await K.settle();
    res.push([head(it).textContent.slice(0, 14), !it.textContent.includes('這題已淘汰') && it.byClass('q-text').length === 1]);
  }
  return { ok: res.length === keys.length && res.every((x) => x[1]), detail: J(res.filter((x) => !x[1])) + ' / ' + res.length };
};
T['看題目:資料檔還沒載(聽力、文法)時才去載;載入失敗顯示「載入失敗」不丟錯'] = async () => {
  const key = 'l1:l1-01';
  const A = await open(BASE.concat(rep(S1, { [key]: E('audio', '', NOW) })), { data: ['part5', 'part6', 'part7', 'articles'] });
  const it = A.items()[0];
  await expand(it);
  await btn(it, '看題目').click();
  await K.settle();
  const failedText = it.textContent.includes('題目資料載入失敗') && !it.textContent.includes('這題已淘汰');
  /* 注入載入器:載入後資料就位 */
  const B = await open(BASE, { data: ['part5', 'part6', 'part7', 'articles'] });
  const box = new B.dom.Node('div'); B.dom.body.append(box);
  let loaded = [];
  await B.ctx.ADMIN_REPORTS.mount(box, { rows: BASE.concat(rep(S1, { [key]: E('audio', '', NOW) })), nameOf: () => 'x',
    loadScript: async (src) => { loaded.push(src); vm.runInContext(read(src), B.ctx); } });
  const it2 = box.byClass('rpa-item')[0];
  await expand(it2);
  await btn(it2, '看題目').click();
  await K.settle();
  return { ok: failedText && J(loaded) === '["data/listening.js"]' && it2.byClass('q-text').length === 1, detail: 'failed ' + failedText + ' loaded ' + J(loaded) };
};
T['不碰學生的列:整個後台操作過程沒有寫 progress 以外的表,也沒有改別人的列;rreview 不是 store 鍵'] = async () => {
  const A = await open(BASE.concat(rep(S1, { [KEY]: E('typo', '', NOW) })));
  await expand(A.items()[0]);
  await btn(A.items()[0], '標為已處理').click();
  await K.settle();
  const w = A.w.writes();
  const src = read('js/admin-reports.js');
  const storeUse = /store\.(get|set|remove)\(/.test(src);
  return { ok: w.every((q) => q.table === 'progress' && q.op === 'upsert') && A.upserts.every((u) => u.row.user_id === K.OWNER_ID) && !storeUse, detail: w.length + ' 次寫入,store 使用 ' + storeUse };
};
T['admin.html:載入順序(report.js 在 admin-classes 前、admin-reports 在 admin.js 前)'] = () => {
  const s = read('admin.html');
  const i = (n) => s.indexOf('js/' + n + '.js');
  return { ok: i('common') < i('report') && i('report') < i('admin-classes') && i('admin-reports') > 0 && i('admin-reports') < i('admin') && s.split('js/admin-reports.js').length === 2, detail: 'ok' };
};

K.run(T);
