/* 掃描 repo 追蹤的檔案裡有沒有像金鑰的字串（repo 是公開的）。
   規則：32 個以上連續十六進位字元；84 個字元、大小寫英數混合的 Azure 新式金鑰；AZURE_SPEECH_KEY=... 這種把金鑰寫進檔案的賦值。
   已知的公開值（Cloudflare 流量統計的公開 token、測試用的假值）列在 tools/secret_scan_allow.json，
   每一項都要寫理由；新增例外要有人看過。
   用法：node tools/secret_scan.js（掃 git ls-files）；check_release.js 也會呼叫。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const PATTERNS = [
  { name: '32 個以上連續十六進位字元', re: /(?<![0-9A-Za-z])[0-9a-fA-F]{32,}(?![0-9A-Za-z])/g },
  { name: 'Azure 新式金鑰格式（84 字元英數）', re: /(?<![0-9A-Za-z])(?=[A-Za-z0-9]{84}(?![0-9A-Za-z]))(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{84}/g },
  { name: '把金鑰寫進檔案的賦值', re: /AZURE_SPEECH_KEY\s*[=:]\s*['"]?(?!<|\$|%|process|your|xxx|\.\.\.)[A-Za-z0-9]{16,}/g },
];
const SKIP_EXT = /\.(mp3|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|mp4|wav)$/i;

function loadAllow(file) {
  const j = JSON.parse(fs.readFileSync(file || path.join(__dirname, 'secret_scan_allow.json'), 'utf8'));
  return { paths: (j.paths || []).map((x) => x.path), tokens: new Set((j.tokens || []).map((x) => x.token)) };
}
function scanText(text, rel, allow) {
  const hits = [];
  if (allow.paths.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p)))) return hits;
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text))) {
      if (allow.tokens.has(m[0])) continue;
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
    console.log('共 ' + hits.length + ' 處。真的是金鑰就拿掉並到 Azure 入口網站重新產生；是公開的假值就加進 tools/secret_scan_allow.json 並寫理由。');
    process.exit(1);
  }
  console.log('沒有發現像金鑰的字串。');
}
