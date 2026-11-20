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
const allow = S.loadAllow();
check('允許清單的每一項都有理由', JSON.parse(fs.readFileSync(path.join(__dirname, 'secret_scan_allow.json'), 'utf8')).tokens.every((t) => t.reason)
  && JSON.parse(fs.readFileSync(path.join(__dirname, 'secret_scan_allow.json'), 'utf8')).paths.every((t) => t.reason));
const repoHits = S.scanRepo(path.join(__dirname, '..'), allow);
check('目前 repo 追蹤的檔案沒有像金鑰的字串', repoHits.length === 0, JSON.stringify(repoHits.slice(0, 3)));
check('check_release.js 有呼叫金鑰檢查', /secret_scan/.test(fs.readFileSync(path.join(__dirname, 'check_release.js'), 'utf8')));
console.log(pass + ' / ' + (pass + fail) + ' 通過');
process.exit(fail ? 1 : 0);
