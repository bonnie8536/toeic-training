/* 公開 repo 的檔案衛生:node tools/test_public_hygiene.js
   - 要擋的個人字樣不寫進 repo:放在 repo 外的文字檔,由 RUSHUP_PRIVATE_PATTERNS_FILE 指定(tools/private_patterns.js 讀)
   - 測試檔不寫正式格式的藍新商店代號;不寫本機絕對路徑;repo 外的檔案路徑由環境變數傳入
   - .gitignore 擋得住金鑰檔,也不會擋到現在追蹤的檔案
   - _config.yml 只排除不需要發佈的資料夾與說明檔,搬家要用的 move-ping.txt 照常發佈;.well-known/security.txt 會發佈
   - _config.yml 的 exclude 要列 CNAME:自訂 exclude 會整份取代預設清單,GitHub Pages 原本自動排除 CNAME 的做法就不再套用 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(REPO, f));
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const BIN = /\.(mp3|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|mp4|wav)$/i;
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const textFiles = () => tracked.filter((f) => !BIN.test(f)).map((f) => {
  let b; try { b = fs.readFileSync(path.join(REPO, f)); } catch (e) { return null; }
  return b.includes(0) ? null : { f, s: b.toString('utf8') };
}).filter(Boolean);

const T = {};

/* ---------- 個人字樣清單 ---------- */
T['字樣清單:沒設環境變數或檔案不存在就略過並說明原因'] = () => {
  const P = require('./private_patterns.js');
  const a = P.loadPrivatePatterns({});
  const b = P.loadPrivatePatterns({ RUSHUP_PRIVATE_PATTERNS_FILE: path.join(os.tmpdir(), 'no-such-dir-' + Date.now(), 'x.txt') });
  return a.patterns.length === 0 && /RUSHUP_PRIVATE_PATTERNS_FILE/.test(a.skipped) && b.patterns.length === 0 && typeof b.skipped === 'string' && b.skipped.length > 0;
};
T['字樣清單:每行一個正規式,不分大小寫;空行與 # 開頭略過;有錯的那行直接報錯且不印出樣式'] = () => {
  const P = require('./private_patterns.js');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-'));
  try {
    const f = path.join(d, 'p.txt');
    fs.writeFileSync(f, '﻿# 說明\n\nfoo\\d{2}\r\n雞蛋\n');
    const r = P.loadPrivatePatterns({ RUSHUP_PRIVATE_PATTERNS_FILE: f });
    const ok1 = r.skipped === null && r.patterns.length === 2
      && P.privateHits('xxFOO12yy', r.patterns).join() === '0' && P.privateHits('炒雞蛋', r.patterns).join() === '1'
      && P.privateHits('foo1 雞肉', r.patterns).length === 0;
    fs.writeFileSync(f, 'ok\n(unclosed\n');
    let msg = '';
    try { P.loadPrivatePatterns({ RUSHUP_PRIVATE_PATTERNS_FILE: f }); } catch (e) { msg = e.message; }
    return ok1 && /第 2 個/.test(msg) && msg.indexOf('unclosed') < 0;
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
};
T['付款與 Edge Function 的測試不放字樣的雜湊或明文,字樣清單由環境變數指定'] = () => {
  const co = read('tools/test_checkout.js'), nb = read('tools/test_newebpay.js');
  return !/PRIVATE_HASHES|hashedHits/.test(co) && !/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/.test(co)
    && /require\('\.\/private_patterns\.js'\)/.test(co) && /require\('\.\/private_patterns\.js'\)/.test(nb)
    && !/[一-鿿]\|/.test((nb.match(/assert\.equal\(\/[^\n]*sb_secret_[^\n]*/) || [''])[0]);
};
T['允許清單沒有 64 碼十六進位的雜湊'] = () => {
  const j = JSON.parse(read('tools/secret_scan_allow.json'));
  return !(j.tokens || []).some((t) => /^[0-9a-f]{64}$/.test(t.token));
};

/* ---------- 商店代號、本機路徑、repo 外的路徑 ---------- */
/* tools/fixtures/newebpay.vectors.json 是官方手冊與公開範例的值(檔內寫了出處),不算 */
T['check_release.js:沒設 RUSHUP_PRIVATE_PATTERNS_FILE 時印出明顯的提醒,設了就不印'] = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'release-warn-'));
  try {
    const f = path.join(d, 'p.txt');
    fs.writeFileSync(f, 'zz-no-such-word-zz\n');
    const run = (extra) => {
      const env = Object.assign({}, process.env, extra);
      if (!extra) delete env.RUSHUP_PRIVATE_PATTERNS_FILE;
      return spawnSync(process.execPath, [path.join(__dirname, 'check_release.js')], { cwd: REPO, env, encoding: 'utf8' });
    };
    const off = run(null), on = run({ RUSHUP_PRIVATE_PATTERNS_FILE: f });
    const warn = /注意.*RUSHUP_PRIVATE_PATTERNS_FILE/;
    return (warn.test(off.stdout + off.stderr) && !warn.test(on.stdout + on.stderr)) || JSON.stringify({ off: off.stdout.slice(0, 200), on: on.stdout.slice(0, 200) });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
};
T['追蹤的檔案沒有正式格式的藍新商店代號(假代號要含 000000 或整串同一個數字)'] = () => {
  const bad = [];
  textFiles().filter(({ f }) => f !== 'tools/fixtures/newebpay.vectors.json').forEach(({ f, s }) => {
    for (const m of s.matchAll(/(?<![A-Za-z0-9])MS\d{8,}(?![0-9])/g)) if (m[0].indexOf('000000') < 0 && !/^MS(\d)\1+$/.test(m[0])) bad.push(f);
  });
  return bad.length === 0 || ('有 ' + bad.length + ' 處:' + [...new Set(bad)].join('、'));
};
T['追蹤的檔案沒有本機使用者資料夾的絕對路徑'] = () => {
  const bad = textFiles().filter(({ s }) => /[A-Za-z]:[\\/]+Users[\\/]/i.test(s)).map(({ f }) => f);
  return bad.length === 0 || bad.join('、');
};
T['tools 的程式不寫死 repo 外的中文資料夾路徑;要用的檔案由環境變數傳入'] = () => {
  const bad = fs.readdirSync(__dirname).filter((f) => /\.js$/.test(f))
    .filter((f) => /['"]\.\.['"]\s*,\s*['"][^\x00-\x7f]/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  const nb = read('tools/test_newebpay.js'), tw = read('tools/test_worker.js');
  return (bad.length === 0 && /process\.env\.RUSHUP_PAID_SQL_FILE/.test(nb) && /process\.env\.RUSHUP_WORKER_PASTE_FILE/.test(tw)) || ('寫死的:' + bad.join('、'));
};
T['check_audio 的 Python 只從 --python 或 PYTHON 取得,都沒有就略過語音辨識並說明'] = async () => {
  const A = require('./check_audio.js');
  const saved = process.env.PYTHON;
  delete process.env.PYTHON;
  try {
    const none = A.pythonExe({});
    const r = await A.asrAvailable({}, async () => ({ code: 1, stdout: '', stderr: '' }));
    process.env.PYTHON = 'py-from-env';
    const env = A.pythonExe({});
    const arg = A.pythonExe({ python: 'py-from-arg' });
    return none === null && r.ok === false && /PYTHON/.test(r.reason) && env === 'py-from-env' && arg === 'py-from-arg';
  } finally { if (saved === undefined) delete process.env.PYTHON; else process.env.PYTHON = saved; }
};

/* ---------- .gitignore ---------- */
T['.gitignore:沒有 BOM;規則行只用英數符號'] = () => {
  const s = read('.gitignore');
  const rules = s.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  return s.charCodeAt(0) !== 0xFEFF && rules.every((l) => /^[\x20-\x7e]+$/.test(l));
};
T['.gitignore:金鑰檔與環境變數檔都擋;根目錄的中文檔名筆記也擋;README 不擋'] = () => {
  const should = ['.env', '.env.local', '.env.production', 'supabase/functions/.env.local', 'x.env', 'a.pem', 'tools/b.key', 'c.p12', 'd.pfx', '筆記.md'];
  const shouldNot = ['README.md', 'GITHUB上線指南.md', 'tools/fixtures/newebpay.vectors.json', 'js/cloud-config.js', 'move-ping.txt', '.well-known/security.txt', '_config.yml'];
  const ignored = (p) => { try { execFileSync('git', ['-C', REPO, 'check-ignore', '-q', '--no-index', p], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
  const miss = should.filter((p) => !ignored(p)), extra = shouldNot.filter(ignored);
  return (miss.length === 0 && extra.length === 0) || ('沒擋:' + miss.join('、') + ' 誤擋:' + extra.join('、'));
};
T['.gitignore:不會擋到任何現在追蹤的檔案'] = () => {
  const out = git('ls-files', '-ci', '--exclude-standard').trim();
  return out === '' || out.split('\n').slice(0, 5).join('、');
};

/* ---------- 網站發佈範圍 ---------- */
const listIn = (s, key) => {
  const m = new RegExp('^' + key + ':\\s*\\[([^\\]]*)\\]\\s*$', 'm').exec(s);
  return m ? m[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : null;
};
T['_config.yml:只有 exclude 與 include 兩項;排除 tools、supabase 與兩份說明檔,不排除 move-ping.txt'] = () => {
  if (!exists('_config.yml')) return '沒有 _config.yml';
  const s = read('_config.yml');
  const keys = s.split(/\r?\n/).filter((l) => /^[A-Za-z_]+:/.test(l)).map((l) => l.split(':')[0]);
  const ex = listIn(s, 'exclude') || [];
  return keys.sort().join() === 'exclude,include'
    && ['tools', 'supabase', 'README.md', 'GITHUB上線指南.md'].every((x) => ex.includes(x))
    && ex.length === 5 && !ex.some((x) => /move-ping/.test(x)) && !exists('.nojekyll');
};
/* GitHub Pages(pages-gem)只在 exclude 等於 Jekyll 預設清單時才補上 CNAME;這裡自訂了 exclude,要自己列。
   自訂網域看的是 repo 設定與來源分支根目錄的 CNAME 檔,不是建置後的網站,所以排除它不影響網域 */
T['_config.yml:exclude 也列 CNAME,網站上的 /CNAME 維持 404'] = () => {
  if (!exists('_config.yml')) return '沒有 _config.yml';
  const ex = listIn(read('_config.yml'), 'exclude') || [];
  return (ex.includes('CNAME') && exists('CNAME')) || ('exclude:' + ex.join('、'));
};
T['_config.yml:include 讓 .well-known 發佈'] = () => exists('_config.yml') && (listIn(read('_config.yml'), 'include') || []).join() === '.well-known';
T['網站的頁面與程式不從 tools/、supabase/ 載入任何檔案'] = () => {
  const site = tracked.filter((f) => /\.(html|js|css|json)$/.test(f) && !/^(tools|supabase|data)\//.test(f));
  const bad = site.filter((f) => /["'`(](\.{0,2}\/)?(tools|supabase)\/[\w./-]+/.test(read(f).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, '')));
  return bad.length === 0 || bad.join('、');
};
T['發佈的檔案不含 Jekyll 會處理的 front matter(排除的資料夾以外)'] = () => {
  const bad = tracked.filter((f) => !/^(tools|supabase)\//.test(f) && !/^(README\.md|GITHUB上線指南\.md)$/.test(f) && !BIN.test(f))
    .filter((f) => { try { return fs.readFileSync(path.join(REPO, f)).slice(0, 3).toString() === '---'; } catch (e) { return false; } });
  const md = tracked.filter((f) => /\.(md|markdown)$/i.test(f) && !/^(tools|supabase)\//.test(f) && !/^(README\.md|GITHUB上線指南\.md)$/.test(f));
  return (bad.length === 0 && md.length === 0) || ('front matter:' + bad.join('、') + ' markdown:' + md.join('、'));
};
T['.well-known/security.txt:聯絡信箱跟 tools/domain.json 一致,期限在一年內,語言 zh-TW 與 en'] = () => {
  if (!exists('.well-known/security.txt')) return '沒有 security.txt';
  const s = read('.well-known/security.txt');
  const mail = JSON.parse(read('tools/domain.json')).mail;
  const exp = (/^Expires:\s*(\S+)\s*$/m.exec(s) || [])[1];
  const t = Date.parse(exp || '');
  const now = Date.now();
  return new RegExp('^Contact: mailto:' + mail.replace(/[.+]/g, '\\$&') + '\\s*$', 'm').test(s)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(exp || '') && t > now && t - now <= 366 * 864e5
    && /^Preferred-Languages: zh-TW, en\s*$/m.test(s);
};

T['後台(admin.html)不載第三方的腳本:只載本站的 js'] = () => {
  const html = fs.readFileSync(path.join(REPO, 'admin.html'), 'utf8');
  const ext = (html.match(/<script[^>]*\ssrc=["']?[^"' >]+/gi) || []).map((t) => t.replace(/.*\ssrc=["']?/i, '')).filter((u) => /^(https?:)?\/\//i.test(u));
  return ext.length === 0 || '載了 ' + ext.join(', ');
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const n of names) {
    let r;
    try { r = await T[n](); } catch (e) { r = '例外 ' + (e && e.message); }
    const ok = r === true;
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || r === false ? '' : '  →  ' + r));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
