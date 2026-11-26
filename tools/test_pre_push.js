/* 推送前檢查(tools/hooks/pre-push)的測試:node tools/test_pre_push.js
   在暫存資料夾建一個裸 repo 當遠端、一個工作 repo,用 tools/install_hooks.js --repo 裝進工作 repo(不碰這個 repo 的 .git/hooks)。
   - 一般推送照常成功
   - 要推的 commit 有像金鑰的字串:拒絕,遠端不變(只在工作目錄刪掉、推另一個分支、中間加入又刪掉、UTF-16 的檔案都一樣)
   - 工作目錄裡還沒 commit 的東西(staged、add -N)不影響推送
   - 推 backup/ 開頭的分支、refs/original 底下的 ref、--mirror:拒絕
   - 裝的 hook 是 LF 換行,內容跟 tools/hooks/pre-push 一樣 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const TOOLS = __dirname;
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) pass++; else fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !d ? '' : '  →  ' + d)); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prepush-'));
const remote = path.join(root, 'remote.git');
const work = path.join(root, 'work');
const ID = ['-c', 'user.name=test', '-c', 'user.email=test@example.test', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main'];
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...ID, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const push = (...a) => spawnSync('git', ['-C', work, ...ID, 'push', ...a], { encoding: 'utf8' });
const remoteHead = (ref) => { try { return g(remote, 'rev-parse', '--verify', '-q', ref); } catch (e) { return ''; } };

try {
  execFileSync('git', [...ID, 'init', '-q', '--bare', remote]);
  execFileSync('git', [...ID, 'init', '-q', work]);
  fs.mkdirSync(path.join(work, 'tools'));
  ['secret_scan.js', 'secret_scan_allow.json'].forEach((f) => fs.copyFileSync(path.join(TOOLS, f), path.join(work, 'tools', f)));
  fs.writeFileSync(path.join(work, 'tools', 'secret_scan_allow.json'), JSON.stringify({ paths: [], tokens: [] }));
  fs.writeFileSync(path.join(work, 'a.txt'), 'hello\n');
  g(work, 'add', '.');
  g(work, 'commit', '-q', '-m', 'init');
  g(work, 'remote', 'add', 'origin', remote);

  const inst = spawnSync(process.execPath, [path.join(TOOLS, 'install_hooks.js'), '--repo', work], { encoding: 'utf8' });
  const hookPath = path.join(work, '.git', 'hooks', 'pre-push');
  const installed = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : '';
  const src = fs.readFileSync(path.join(TOOLS, 'hooks', 'pre-push'), 'utf8').replace(/\r\n/g, '\n');
  check('install_hooks.js --repo 把 pre-push 裝進指定 repo,LF 換行、內容一致', inst.status === 0 && installed === src && !installed.includes('\r'), inst.stderr);

  const r1 = push('-q', 'origin', 'main');
  check('一般推送照常成功', r1.status === 0 && remoteHead('refs/heads/main') === g(work, 'rev-parse', 'HEAD'), r1.stderr);

  const before = remoteHead('refs/heads/main');
  fs.writeFileSync(path.join(work, 'b.txt'), 'SUPABASE_SECRET_KEY=sb_secret_' + 'Qw3rTy7UiOp9AsDfGh2JkLzXcVbNm4'.split('').reverse().join('') + '\n');
  g(work, 'add', 'b.txt');
  g(work, 'commit', '-q', '-m', 'add b');
  const r2 = push('-q', 'origin', 'main');
  check('追蹤的檔案有像金鑰的字串:拒絕推送,遠端不變', r2.status !== 0 && remoteHead('refs/heads/main') === before && /祕密掃描/.test(r2.stderr), r2.stderr);
  const bad = g(work, 'rev-parse', '--short=10', 'HEAD');
  check('拒推訊息寫出是哪個 commit、哪個檔案,不印出完整金鑰', r2.stderr.includes('commit ' + bad) && r2.stderr.includes('b.txt') && !/sb_secret_[A-Za-z0-9]{20}/.test(r2.stderr), r2.stderr);

  /* 金鑰已經 commit,之後只在工作目錄刪掉、沒有 commit 就推:照樣拒絕 */
  fs.rmSync(path.join(work, 'b.txt'));
  const rA = push('-q', 'origin', 'main');
  check('金鑰已經 commit、只在工作目錄刪掉就推:拒絕,遠端不變', rA.status !== 0 && remoteHead('refs/heads/main') === before, rA.stderr);
  /* 加入又刪掉的兩個 commit 一起推:照樣拒絕 */
  g(work, 'rm', '-q', '--cached', 'b.txt');
  g(work, 'commit', '-q', '-m', 'remove b');
  const rD = push('-q', 'origin', 'main');
  check('中間的 commit 加入又刪掉金鑰,一起推:拒絕,遠端不變', rD.status !== 0 && remoteHead('refs/heads/main') === before && rD.stderr.includes('commit ' + bad), rD.stderr);
  g(work, 'reset', '-q', '--hard', before);

  /* 推另一個分支(不是目前檢出的那個):掃的是那個分支的 commit */
  g(work, 'checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(work, 's.txt'), 'token=ghp_' + 'Zx8Cv7Bn6Mm5Ll4Kk3Jj2Hh1Gg0FfDdSsAaQq'.slice(0, 36) + '\n');
  g(work, 'add', 's.txt');
  g(work, 'commit', '-q', '-m', 'side');
  g(work, 'checkout', '-q', 'main');
  const rC = push('-q', 'origin', 'side');
  check('推另一個分支,那個分支的 commit 有金鑰:拒絕', rC.status !== 0 && remoteHead('refs/heads/side') === '' && /s\.txt/.test(rC.stderr), rC.stderr);
  g(work, 'branch', '-q', '-D', 'side');

  /* UTF-16 的文字檔:照樣拒絕 */
  fs.writeFileSync(path.join(work, 'notes.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('token=ghp_' + 'Qw9Er8Ty7Ui6Op5As4Df3Gh2Jk1LzXcVbNmPo'.slice(0, 36) + '\r\n', 'utf16le')]));
  g(work, 'add', 'notes.txt');
  g(work, 'commit', '-q', '-m', 'notes');
  const rU = push('-q', 'origin', 'main');
  check('UTF-16 編碼的文字檔有金鑰:拒絕', rU.status !== 0 && remoteHead('refs/heads/main') === before && /notes\.txt/.test(rU.stderr), rU.stderr);
  g(work, 'reset', '-q', '--hard', before);

  /* 工作目錄裡還沒 commit 的東西不影響推送:只 staged 的檔案、git add -N 的檔案有像金鑰的字串,乾淨的 commit 照常推得出去 */
  fs.writeFileSync(path.join(work, 'c.txt'), 'clean\n');
  g(work, 'add', 'c.txt');
  g(work, 'commit', '-q', '-m', 'clean');
  fs.writeFileSync(path.join(work, 'staged.txt'), 'k=sb_secret_' + 'Mn8Bv7Cx6Za5Lk4Jh3Gf2Ds1Aq'.split('').reverse().join('') + '\n');
  g(work, 'add', 'staged.txt');
  fs.writeFileSync(path.join(work, 'intent.txt'), 'k=sb_secret_' + 'Po9Iu8Yt7Re6Wq5Lk4Jh3Gf2D'.split('').reverse().join('') + '\n');
  g(work, 'add', '-N', 'intent.txt');
  const rE = push('-q', 'origin', 'main');
  check('只 staged 或 git add -N 的檔案有像金鑰的字串:乾淨的 commit 照常推得出去', rE.status === 0 && remoteHead('refs/heads/main') === g(work, 'rev-parse', 'HEAD'), rE.stderr);
  g(work, 'rm', '-q', '--cached', '-f', 'staged.txt', 'intent.txt');
  fs.rmSync(path.join(work, 'staged.txt'));
  fs.rmSync(path.join(work, 'intent.txt'));

  g(work, 'branch', 'backup/old');
  const r3 = push('-q', 'origin', 'backup/old');
  check('推 backup/ 開頭的分支:拒絕', r3.status !== 0 && remoteHead('refs/heads/backup/old') === '' && /backup/.test(r3.stderr), r3.stderr);
  const r3b = push('-q', 'origin', 'main:refs/heads/backup/x');
  check('把分支推到遠端的 backup/ 名稱:拒絕', r3b.status !== 0 && remoteHead('refs/heads/backup/x') === '', r3b.stderr);

  g(work, 'update-ref', 'refs/original/refs/heads/main', 'HEAD~1');
  const r4 = push('-q', 'origin', 'refs/original/refs/heads/main:refs/original/refs/heads/main');
  check('推 refs/original 底下的 ref:拒絕', r4.status !== 0 && remoteHead('refs/original/refs/heads/main') === '' && /refs\/original/.test(r4.stderr), r4.stderr);
  const beforeMirror = remoteHead('refs/heads/main');
  const r5 = push('-q', '--mirror', 'origin');
  check('push --mirror(會帶上備份 ref):拒絕,遠端不變', r5.status !== 0 && remoteHead('refs/heads/backup/old') === '' && remoteHead('refs/heads/main') === beforeMirror, r5.stderr);

  g(work, 'branch', '-D', 'backup/old');
  g(work, 'update-ref', '-d', 'refs/original/refs/heads/main');
  const r6 = push('-q', 'origin', 'main');
  check('拿掉金鑰與備份 ref 之後,一般推送照常成功', r6.status === 0 && remoteHead('refs/heads/main') === g(work, 'rev-parse', 'HEAD'), r6.stderr);

  const r7 = spawnSync(process.execPath, [path.join(TOOLS, 'install_hooks.js'), '--repo', work], { encoding: 'utf8' });
  fs.writeFileSync(hookPath, '#!/bin/sh\nexit 0\n');
  const r8 = spawnSync(process.execPath, [path.join(TOOLS, 'install_hooks.js'), '--repo', work], { encoding: 'utf8' });
  check('重裝同一份不報錯;已有不同的 pre-push 時不覆蓋', r7.status === 0 && r8.status !== 0 && fs.readFileSync(hookPath, 'utf8') === '#!/bin/sh\nexit 0\n', r8.stdout + r8.stderr);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(pass + ' / ' + (pass + fail) + ' 通過');
process.exit(fail ? 1 : 0);
