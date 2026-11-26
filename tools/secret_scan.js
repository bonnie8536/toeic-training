/* 掃描 repo 追蹤的檔案裡有沒有像金鑰的字串（repo 是公開的）。
   規則：
   - 32 個以上連續十六進位字元；84 個字元、大小寫英數混合的 Azure 新式金鑰；AZURE_SPEECH_KEY=... 這種把金鑰寫進檔案的賦值
   - Supabase：JWT 第二段解開後 role 是 service_role（官方本機開發範例 iss=supabase-demo 不算）；sb_secret_ 開頭的金鑰
   - postgres:// 或 postgresql:// 連線字串裡有密碼（[YOUR-PASSWORD]、<...>、${...}、password、postgres 這類佔位不算）
   - 藍新 HashKey／HashIV 後面接看起來像真值的字串（16 字元以上、大小寫英數至少兩種、不是連號或同一個字）；
     中間可以是 = 、: 、=> 、| 或空白（賦值、JSON、PHP 陣列、表格、CLI 參數）
   - PGPASSWORD=... 與 libpq 連線字串的 password=...（佔位寫法不算）
   - PEM 私鑰；常見雲端金鑰前綴（AWS、Google、GitHub、OpenAI、Anthropic、Slack、Stripe 正式金鑰）
   已知的公開值（Cloudflare 流量統計的公開 token、官方文件範例、測試用的假值）列在 tools/secret_scan_allow.json，
   每一項都要寫理由；路徑豁免只能逐檔列出，而且只略過十六進位規則；新增例外要有人看過。
   UTF-16 編碼的文字檔（有 BOM，或沒有 BOM 但 NUL 都在同一邊）轉成字串再掃；只有真正的二進位檔略過。
   用法：
   - node tools/secret_scan.js：掃工作目錄裡 git 追蹤的檔案（check_release.js 也會呼叫）
   - node tools/secret_scan.js --commits [--remote <遠端名稱>] -- <rev>...：掃 git rev-list <rev>... 列出的每個 commit 裡的檔案，
     不看工作目錄與暫存區；給了遠端名稱就跳過已經在那個遠端追蹤分支上的 commit，命中的字串在那些分支頂端本來就有的也不報
     （<rev> 寫成 ^<sha> 的，那個 commit 也當作遠端已經有的）。推送前檢查（tools/hooks/pre-push）用這個。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');

function jwtRole(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const j = JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch (e) { return null; }
}
const PG_PLACEHOLDER = /^(\[.*\]|<.*>|\$\{?[A-Za-z_]\w*\}?|%\w+%|\{\{.*\}\}|password|passwd|pass|postgres|secret|changeme|your[-_]?password|\*+|x+|\.{3}|…)$/i;
function looksRealValue(v) {
  if (v.length < 16) return false;
  const kinds = [/[A-Z]/, /[a-z]/, /[0-9]/].filter((r) => r.test(v)).length;
  if (kinds < 2) return false;
  if (/^(.)\1+$/.test(v)) return false;
  if (/^(0123456789|1234567890|abcdefghij|ABCDEFGHIJ)/.test(v)) return false;
  return !/(your|example|sample|dummy|placeholder|xxxx|fake)/i.test(v);
}
const PATTERNS = [
  { name: '32 個以上連續十六進位字元', hexOnly: true, re: /(?<![0-9A-Za-z])[0-9a-fA-F]{32,}(?![0-9A-Za-z])/g },
  { name: 'Azure 新式金鑰格式（84 字元英數）', re: /(?<![0-9A-Za-z])(?=[A-Za-z0-9]{84}(?![0-9A-Za-z]))(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{84}/g },
  { name: '把金鑰寫進檔案的賦值', re: /AZURE_SPEECH_KEY\s*[=:]\s*['"]?(?!<|\$|%|process|your|xxx|\.\.\.)[A-Za-z0-9]{16,}/g },
  { name: 'Supabase service_role 金鑰（JWT）', re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/g,
    keep: (m) => { const j = jwtRole(m[0]); return !!j && j.role === 'service_role' && j.iss !== 'supabase-demo'; } },
  { name: 'Supabase secret 金鑰（sb_secret_）', re: /(?<![A-Za-z0-9_])sb_secret_[A-Za-z0-9_-]{20,}/g },
  { name: 'postgres 連線字串含密碼', re: /postgres(?:ql)?:\/\/[^\s:@\/'"`]+:([^\s@'"`]+)@/g, keep: (m) => !PG_PLACEHOLDER.test(m[1]) },
  { name: '藍新 HashKey／HashIV 的值', re: /hash[_-]?(?:key|iv)['"]?(?:\s*(?:=>|[:=|])\s*|\s+)['"`]?([A-Za-z0-9+\/=_-]{16,})/gi, keep: (m) => looksRealValue(m[1]) },
  { name: '資料庫密碼（PGPASSWORD、password=）', re: /(?<![A-Za-z0-9_])(?:PGPASSWORD|password)=['"]?((?:(?![\s'"&;`])[\x21-\x7e])+)/g,
    keep: (m) => m[1].length >= 8 && !PG_PLACEHOLDER.test(m[1]) && !/^[$<{%[]/.test(m[1]) },
  { name: 'PEM 私鑰', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  { name: '雲端服務金鑰前綴', re: /(?<![A-Za-z0-9_-])(?:(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}|sk-(?:proj-|ant-[a-z0-9]+-|svcacct-)?[A-Za-z0-9_-]{32,}|xox[abprs]-[A-Za-z0-9-]{20,}|(?:sk|rk)_live_[A-Za-z0-9]{20,})(?![A-Za-z0-9])/g,
    keep: (m) => !/EXAMPLE/.test(m[0]) },
];
const SKIP_EXT = /\.(mp3|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|mp4|wav)$/i;

function loadAllow(file) {
  const j = JSON.parse(fs.readFileSync(file || path.join(__dirname, 'secret_scan_allow.json'), 'utf8'));
  const paths = (j.paths || []).map((x) => x.path);
  const dir = paths.find((p) => p.endsWith('/'));
  if (dir) throw new Error('secret_scan_allow.json 的路徑豁免要逐檔列出，不能寫資料夾：' + dir);
  return { paths, tokens: new Set((j.tokens || []).map((x) => x.token)) };
}
function scanText(text, rel, allow) {
  const hits = [];
  const pathAllowed = allow.paths.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p)));
  for (const p of PATTERNS) {
    if (pathAllowed && p.hexOnly) continue; /* 路徑豁免只略過十六進位規則，金鑰格式與賦值規則一律照掃 */
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text))) {
      const value = m[1] || m[0];
      if (allow.tokens.has(m[0]) || allow.tokens.has(value)) continue;
      if (p.keep && !p.keep(m)) continue;
      const hit = { file: rel, rule: p.name, line: text.slice(0, m.index).split('\n').length, sample: m[0].slice(0, 4) + '…(' + m[0].length + ' 字元)' };
      Object.defineProperty(hit, 'value', { value: m[0], enumerable: false }); /* 只給 scanCommits 比對用，不印、不輸出 */
      hits.push(hit);
    }
  }
  return hits;
}
/* 檔案內容 → 字串；二進位檔回 null。UTF-16：有 BOM 照 BOM；沒有 BOM 時，NUL 只出現在奇數位（或只在偶數位）就當成 UTF-16 */
function decode(buf) {
  const even = (b) => b.subarray(0, b.length - (b.length % 2));
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return even(buf.subarray(2)).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(even(buf.subarray(2))).swap16().toString('utf16le');
  if (!buf.includes(0)) return buf.toString('utf8');
  let zEven = 0, zOdd = 0;
  const body = even(buf);
  for (let i = 0; i < body.length; i++) if (body[i] === 0) { if (i % 2) zOdd++; else zEven++; }
  if (zEven === 0 && zOdd > 0) return body.toString('utf16le');
  if (zOdd === 0 && zEven > 0) return Buffer.from(body).swap16().toString('utf16le');
  return null;
}
function scanBuffer(buf, rel, allow) {
  const text = decode(buf);
  return text === null ? [] : scanText(text, rel, allow);
}
function scanRepo(repo, allow) {
  const files = execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0').filter(Boolean);
  const hits = [];
  for (const rel of files) {
    if (SKIP_EXT.test(rel)) continue;
    const p = path.join(repo, rel);
    let buf;
    try { buf = fs.readFileSync(p); } catch (e) { continue; }
    hits.push(...scanBuffer(buf, rel.split(path.sep).join('/'), allow));
  }
  return hits;
}
/* 掃 git rev-list <revs> 列出的每個 commit 裡的檔案（同一份內容只掃一次，回報第一個出現它的 commit）。
   opts.published：遠端已經有的 commit（遠端追蹤分支的頂端）；命中的字串在那些 commit 的檔案裡本來就有，就不算這次推送新帶出去的
   （例如分支上較早的 commit 還留著遠端早就公開的舊值）。git 指令失敗就丟錯，呼叫的人要當作沒掃過 */
function scanCommits(repo, revs, allow, opts) {
  const published = (opts && opts.published) || [];
  const git = (args, input) => execFileSync('git', ['-C', repo, ...args], { input, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });
  const commits = git(['rev-list', ...revs, '--']).toString('utf8').split('\n').filter(Boolean);
  const blobs = new Map();
  for (const c of commits) {
    for (const ent of git(['ls-tree', '-r', '-z', c]).toString('utf8').split('\0').filter(Boolean)) {
      const tab = ent.indexOf('\t');
      const [, type, sha] = ent.slice(0, tab).split(' ');
      const rel = ent.slice(tab + 1);
      if (type !== 'blob' || SKIP_EXT.test(rel) || blobs.has(sha)) continue;
      blobs.set(sha, { rel, commit: c.slice(0, 10) });
    }
  }
  if (!blobs.size) return [];
  const out = git(['cat-file', '--batch'], Array.from(blobs.keys()).join('\n') + '\n');
  const hits = [];
  let pos = 0;
  while (pos < out.length) {
    const nl = out.indexOf(10, pos);
    const [sha, type, size] = out.subarray(pos, nl).toString('utf8').split(' ');
    if (type !== 'blob') throw new Error('讀不到 ' + sha);
    const len = Number(size);
    const info = blobs.get(sha);
    scanBuffer(out.subarray(nl + 1, nl + 1 + len), info.rel, allow).forEach((h) => hits.push(Object.defineProperty(Object.assign({ commit: info.commit }, h), 'value', { value: h.value, enumerable: false })));
    pos = nl + 1 + len + 1;
  }
  if (!published.length) return hits;
  const seen = new Map();
  const isPublished = (v) => {
    if (!seen.has(v)) {
      const r = spawnSync('git', ['-C', repo, 'grep', '-q', '-F', '-I', '-e', v, ...published, '--'], { stdio: 'ignore' });
      if (r.status !== 0 && r.status !== 1) throw new Error('git grep 失敗');
      seen.set(v, r.status === 0);
    }
    return seen.get(v);
  };
  return hits.filter((h) => !isPublished(h.value));
}
module.exports = { scanText, scanRepo, scanCommits, decode, loadAllow, PATTERNS };

/* --commits 的參數：[--remote <名稱>] -- <rev>... */
function commitArgs(argv) {
  const sep = argv.indexOf('--');
  const ri = argv.indexOf('--remote');
  const remote = ri > -1 && (sep < 0 || ri < sep) ? argv[ri + 1] : '';
  return { remote, revs: sep > -1 ? argv.slice(sep + 1) : [] };
}
if (require.main === module) {
  const argv = process.argv.slice(2);
  let hits;
  if (argv[0] === '--commits') {
    const { remote, revs } = commitArgs(argv);
    if (!revs.length) { console.log('沒有要掃的 commit。'); process.exit(0); }
    try {
      const remotes = execFileSync('git', ['-C', REPO, 'remote'], { encoding: 'utf8' }).split('\n').map((x) => x.trim()).filter(Boolean);
      const known = remote && remotes.indexOf(remote) > -1;
      const not = known ? ['--not', '--remotes=' + remote] : [];
      const tips = known ? execFileSync('git', ['-C', REPO, 'for-each-ref', '--format=%(objectname)', 'refs/remotes/' + remote + '/'], { encoding: 'utf8' })
        .split('\n').filter(Boolean) : [];
      const published = Array.from(new Set(tips.concat(revs.filter((r) => r[0] === '^').map((r) => r.slice(1)))));
      hits = scanCommits(REPO, revs.concat(not), loadAllow(), { published });
    } catch (e) {
      console.log('無法列出要推送的 commit：' + String(e.message).split('\n')[0]);
      process.exit(2);
    }
  } else {
    hits = scanRepo(REPO, loadAllow());
  }
  if (hits.length) {
    hits.slice(0, 30).forEach((h) => console.log('像金鑰的字串：' + (h.commit ? 'commit ' + h.commit + ' 的 ' : '') + h.file + ':' + h.line + '（' + h.rule + '，' + h.sample + '）'));
    console.log('共 ' + hits.length + ' 處。真的是金鑰就拿掉，並到發出金鑰的服務重新產生；是公開的假值就加進 tools/secret_scan_allow.json 並寫理由。');
    process.exit(1);
  }
  console.log('沒有發現像金鑰的字串。');
}
