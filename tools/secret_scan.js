/* 掃描 repo 追蹤的檔案裡有沒有像金鑰的字串（repo 是公開的）。
   規則：
   - 32 個以上連續十六進位字元；84 個字元、大小寫英數混合的 Azure 新式金鑰；AZURE_SPEECH_KEY=... 這種把金鑰寫進檔案的賦值
   - Supabase：JWT 第二段解開後 role 是 service_role（官方本機開發範例 iss=supabase-demo 不算）；sb_secret_ 開頭的金鑰
   - postgres:// 或 postgresql:// 連線字串裡有密碼（[YOUR-PASSWORD]、<...>、${...}、password、postgres 這類佔位不算）
   - 藍新 HashKey／HashIV 後面接看起來像真值的字串（16 字元以上、大小寫英數至少兩種、不是連號或同一個字）
   - PEM 私鑰；常見雲端金鑰前綴（AWS、Google、GitHub、OpenAI、Anthropic、Slack、Stripe 正式金鑰）
   已知的公開值（Cloudflare 流量統計的公開 token、官方文件範例、測試用的假值）列在 tools/secret_scan_allow.json，
   每一項都要寫理由；路徑豁免只能逐檔列出，而且只略過十六進位規則；新增例外要有人看過。
   用法：node tools/secret_scan.js（掃 git ls-files）；check_release.js 與推送前檢查（tools/hooks/pre-push）也會呼叫。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
  { name: '藍新 HashKey／HashIV 的值', re: /hash_?(?:key|iv)['"]?\s*[:=]\s*['"`]?([A-Za-z0-9+\/=_-]{16,})/gi, keep: (m) => looksRealValue(m[1]) },
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
      hits.push({ file: rel, rule: p.name, line: text.slice(0, m.index).split('\n').length, sample: m[0].slice(0, 4) + '…(' + m[0].length + ' 字元)' });
    }
  }
  return hits;
}
function scanRepo(repo, allow) {
  const files = execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0').filter(Boolean);
  const hits = [];
  for (const rel of files) {
    if (SKIP_EXT.test(rel)) continue;
    const p = path.join(repo, rel);
    let buf;
    try { buf = fs.readFileSync(p); } catch (e) { continue; }
    if (buf.includes(0)) continue;
    hits.push(...scanText(buf.toString('utf8'), rel.split(path.sep).join('/'), allow));
  }
  return hits;
}
module.exports = { scanText, scanRepo, loadAllow, PATTERNS };

if (require.main === module) {
  const hits = scanRepo(REPO, loadAllow());
  if (hits.length) {
    hits.slice(0, 30).forEach((h) => console.log('像金鑰的字串：' + h.file + ':' + h.line + '（' + h.rule + '，' + h.sample + '）'));
    console.log('共 ' + hits.length + ' 處。真的是金鑰就拿掉，並到發出金鑰的服務重新產生；是公開的假值就加進 tools/secret_scan_allow.json 並寫理由。');
    process.exit(1);
  }
  console.log('沒有發現像金鑰的字串。');
}
