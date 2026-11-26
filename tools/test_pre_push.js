/* 推送前檢查(tools/hooks/pre-push)的測試:node tools/test_pre_push.js
   在暫存資料夾建一個裸 repo 當遠端、一個工作 repo,用 tools/install_hooks.js --repo 裝進工作 repo(不碰這個 repo 的 .git/hooks)。
   - 一般推送照常成功
   - 追蹤的檔案有像金鑰的字串:拒絕,遠端不變
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
  g(work, 'rm', '-q', 'b.txt');
  g(work, 'commit', '-q', '-m', 'remove b');

  g(work, 'branch', 'backup/old');
  const r3 = push('-q', 'origin', 'backup/old');
  check('推 backup/ 開頭的分支:拒絕', r3.status !== 0 && remoteHead('refs/heads/backup/old') === '' && /backup/.test(r3.stderr), r3.stderr);
  const r3b = push('-q', 'origin', 'main:refs/heads/backup/x');
  check('把分支推到遠端的 backup/ 名稱:拒絕', r3b.status !== 0 && remoteHead('refs/heads/backup/x') === '', r3b.stderr);

  g(work, 'update-ref', 'refs/original/refs/heads/main', 'HEAD~1');
  const r4 = push('-q', 'origin', 'refs/original/refs/heads/main:refs/original/refs/heads/main');
  check('推 refs/original 底下的 ref:拒絕', r4.status !== 0 && remoteHead('refs/original/refs/heads/main') === '' && /refs\/original/.test(r4.stderr), r4.stderr);
  const r5 = push('-q', '--mirror', 'origin');
  check('push --mirror(會帶上備份 ref):拒絕,遠端不變', r5.status !== 0 && remoteHead('refs/heads/backup/old') === '' && remoteHead('refs/heads/main') === before, r5.stderr);

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
