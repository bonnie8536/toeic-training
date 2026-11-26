/* 金鑰外洩檢查的測試：node tools/test_secret_scan.js
   - 32 個以上連續十六進位、Azure 新式金鑰格式、AZURE_SPEECH_KEY=... 賦值都會被抓到
   - 允許清單的路徑與 token 不報；佔位寫法（<金鑰>、process.env）不報
   - 目前 repo 追蹤的檔案沒有命中；check_release.js 有接上 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./secret_scan.js');

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) pass++; else fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !d ? '' : '  →  ' + d)); };
const none = { paths: [], tokens: new Set() };
/* 假值執行時才組出來，這個檔本身不含像金鑰的字串 */
const hex32 = 'a1b2c3d4'.repeat(4);
const az84 = ('Ab1' + 'x'.repeat(40) + 'Y9z').padEnd(84, 'q');

check('32 字元十六進位被抓到', S.scanText('key=' + hex32, 'a.js', none).length >= 1);
check('64 字元十六進位被抓到', S.scanText('"' + hex32 + hex32 + '"', 'a.js', none).length === 1);
check('31 字元不報', S.scanText(hex32.slice(1), 'a.js', none).length === 0);
check('Azure 84 字元金鑰格式被抓到', S.scanText('k: ' + az84, 'a.js', none).length === 1);
check('84 字元全小寫英文（像一般長字）不報', S.scanText('x'.repeat(84), 'a.js', none).length === 0);
check('AZURE_SPEECH_KEY 賦值被抓到', S.scanText('set AZURE_SPEECH_KEY=Zq' + 'w'.repeat(20), 'a.md', none).length === 1);
check('佔位寫法不報', S.scanText('AZURE_SPEECH_KEY=<你的金鑰>\nAZURE_SPEECH_KEY=$KEY\nconst k = process.env.AZURE_SPEECH_KEY;', 'a.md', none).length === 0);
check('允許的路徑不報（資料夾與單檔）', S.scanText(hex32, 'tools/fixtures/x.json', { paths: ['tools/fixtures/'], tokens: new Set() }).length === 0
  && S.scanText(hex32, 'tools/m.json', { paths: ['tools/m.json'], tokens: new Set() }).length === 0 && S.scanText(hex32, 'tools/n.json', { paths: ['tools/m.json'], tokens: new Set() }).length === 1);
check('路徑豁免只管十六進位規則：目錄與單檔內的 84 字元金鑰、金鑰賦值仍被抓到',
  S.scanText(az84, 'tools/fixtures/x.json', { paths: ['tools/fixtures/'], tokens: new Set() }).length === 1
  && S.scanText('AZURE_SPEECH_KEY=Zq' + 'w'.repeat(20), 'tools/m.json', { paths: ['tools/m.json'], tokens: new Set() }).length === 1);
check('允許的 token 不報，其他照報', S.scanText(hex32, 'a.js', { paths: [], tokens: new Set([hex32]) }).length === 0 && S.scanText(hex32 + 'b', 'a.js', { paths: [], tokens: new Set([hex32]) }).length === 1);
check('回報內容不含完整金鑰', !JSON.stringify(S.scanText(hex32, 'a.js', none)).includes(hex32));
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
  const g = (...a) => execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' });
  g('init'); fs.writeFileSync(path.join(d, 'ok.txt'), 'hello'); fs.writeFileSync(path.join(d, 'bad.txt'), 'x ' + hex32);
  fs.writeFileSync(path.join(d, 'untracked.txt'), hex32); g('add', 'ok.txt', 'bad.txt');
  const hits = S.scanRepo(d, none);
  check('掃 git 追蹤的檔：只報 bad.txt，未追蹤的不掃', hits.length === 1 && hits[0].file === 'bad.txt' && hits[0].line === 1);
  fs.rmSync(d, { recursive: true, force: true });
}
/* ---------- 收費上線後會出現的金鑰格式(假值執行時才組出來) ---------- */
let seed = 7;
const mix = (n) => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) % 2147483648; s += a[seed % a.length]; } return s; };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (p) => b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u(p) + '.' + mix(43);
const n = (text, rel) => S.scanText(text, rel || 'a.js', none).length;
check('Supabase service_role 金鑰(JWT 第二段 role 是 service_role)被抓到', n('SUPABASE_SERVICE_ROLE_KEY=' + jwt({ iss: 'supabase', ref: mix(20).toLowerCase(), role: 'service_role', iat: 1700000000, exp: 2000000000 })) === 1);
check('anon 金鑰與測試用的假 JWT 不報', n("const k = '" + jwt({ iss: 'supabase', ref: mix(20).toLowerCase(), role: 'anon', iat: 1700000000, exp: 2000000000 }) + "';") === 0
  && n('Bearer ' + jwt({ sub: 'test' })) === 0 && n('x.eyJ' + mix(30) + '.y') === 0);
check('官方文件的本機開發 service_role 範例(iss 是 supabase-demo)不報', n(jwt({ iss: 'supabase-demo', role: 'service_role', exp: 1983812996 })) === 0);
check('sb_secret_ 開頭的金鑰被抓到;佔位寫法與 publishable 金鑰不報', n('SUPABASE_SECRET_KEY=sb_secret_' + mix(31)) === 1
  && n('sb_secret_...\n/sb_secret_|service_role/\nsb_secret_xxx') === 0 && n('sb_publishable_' + mix(31)) === 0);
check('postgres 連線字串含密碼被抓到', n('DB=postgresql://postgres.' + mix(20).toLowerCase() + ':' + mix(18) + '@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres') === 1
  && n("url: 'postgres://app:" + mix(12) + "@db.example.com/app'") === 1);
check('postgres 連線字串的佔位與本機預設密碼不報', n('postgresql://postgres:[YOUR-PASSWORD]@db.abcdefghijklmnopqrst.supabase.co:5432/postgres') === 0
  && n('postgresql://postgres:postgres@127.0.0.1:54322/postgres') === 0 && n('postgres://user:${DB_PASSWORD}@host/db') === 0
  && n('postgres://user:<password>@host/db') === 0 && n('postgres://localhost:5432/db') === 0 && n('postgres://user:password@host/db') === 0);
check('HashKey/HashIV 後面接像真值的字串被抓到(賦值、JSON、環境變數)', n('NEWEBPAY_HASH_KEY=' + mix(32)) === 1
  && n('"hashKey": "' + mix(32) + '"') === 1 && n("HashIV: '" + mix(16) + "'") === 1 && n('NEWEBPAY_HASH_IV="' + mix(16) + '"') === 1);
check('HashKey/HashIV 的假值、變數與組字串不報', n('"hashIV": "1234567890123456"') === 0 && n('"hashKey": "' + 'x'.repeat(32) + '"') === 0 && n("hashKey: 'abcdefghijklmnopqrstuvwxyz012345'") === 0
  && n("hashIV: 'abcdefghijklmnop'") === 0 && n('hashKey: V.mpg_v1.hashKey') === 0 && n('`HashKey=${hashKey}&${x}&HashIV=${hashIV}`') === 0
  && n("NEWEBPAY_HASH_KEY: 'short'") === 0 && n('const hashKey = env(\'NEWEBPAY_HASH_KEY\') as string;') === 0);
check('PEM 私鑰被抓到;公鑰與憑證不報', ['', 'RSA ', 'EC ', 'OPENSSH ', 'ENCRYPTED '].every((k) => n('-----BEGIN ' + k + 'PRIVATE KEY-----\nMIIE') === 1)
  && n('-----BEGIN PUBLIC KEY-----') === 0 && n('-----BEGIN CERTIFICATE-----') === 0);
check('常見雲端金鑰前綴被抓到', [
  'AKIA' + mix(16).toUpperCase().replace(/[^A-Z2-7]/g, 'Q'), 'AIza' + mix(35), 'ghp_' + mix(36), 'gho_' + mix(36), 'github_pat_' + mix(22) + '_' + mix(59),
  'sk-proj-' + mix(48), 'sk-ant-api03-' + mix(80), 'sk-' + mix(48), 'xoxb-' + mix(10) + '-' + mix(12) + '-' + mix(24), 'sk_live_' + mix(24),
].every((v) => n('k = "' + v + '"') === 1));
check('雲端金鑰前綴的官方範例與一般字不報', n('AKIAIOSFODNN7EXAMPLE') === 0 && n('task-force sk-xxx ghp_ AIza') === 0
  && n('mask-image ask-for-help desk-' + 'q'.repeat(40)) === 0);
check('新規則的回報不含完整金鑰', (() => { const v = 'sb_secret_' + mix(31); return !JSON.stringify(S.scanText(v, 'a.js', none)).includes(v); })());
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'allow-test-'));
  const f = path.join(d, 'allow.json');
  fs.writeFileSync(f, JSON.stringify({ paths: [{ path: 'tools/fixtures/', reason: 'x' }], tokens: [] }));
  let err = '';
  try { S.loadAllow(f); } catch (e) { err = e.message; }
  fs.writeFileSync(f, JSON.stringify({ paths: [{ path: 'tools/fixtures/a.json', reason: 'x' }], tokens: [] }));
  const ok = S.loadAllow(f).paths.join() === 'tools/fixtures/a.json';
  check('允許清單的路徑只能逐檔列出,寫資料夾會報錯', /逐檔/.test(err) && ok, err);
  fs.rmSync(d, { recursive: true, force: true });
}
check('允許清單裡的路徑都是存在的檔案', JSON.parse(fs.readFileSync(path.join(__dirname, 'secret_scan_allow.json'), 'utf8')).paths
  .every((p) => !p.path.endsWith('/') && fs.existsSync(path.join(__dirname, '..', p.path)) && fs.statSync(path.join(__dirname, '..', p.path)).isFile()));

const allow = S.loadAllow();
check('允許清單的每一項都有理由', JSON.parse(fs.readFileSync(path.join(__dirname, 'secret_scan_allow.json'), 'utf8')).tokens.every((t) => t.reason)
  && JSON.parse(fs.readFileSync(path.join(__dirname, 'secret_scan_allow.json'), 'utf8')).paths.every((t) => t.reason));
const repoHits = S.scanRepo(path.join(__dirname, '..'), allow);
check('目前 repo 追蹤的檔案沒有像金鑰的字串', repoHits.length === 0, JSON.stringify(repoHits.slice(0, 3)));
check('check_release.js 有呼叫金鑰檢查', /secret_scan/.test(fs.readFileSync(path.join(__dirname, 'check_release.js'), 'utf8')));
console.log(pass + ' / ' + (pass + fail) + ' 通過');
process.exit(fail ? 1 : 0);
