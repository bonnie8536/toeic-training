/* 把 tools/hooks/ 底下的 git hook 裝進 repo(目前只有 pre-push)。
   裝的位置照 git rev-parse --git-path hooks(有設 core.hooksPath 就裝到那裡;worktree 共用同一份)。
   換行一律存成 LF(Git Bash 的 sh 讀 CRLF 會出錯)。已經有內容不同的 hook 就不覆蓋,改完再加 --force。
   用法:node tools/install_hooks.js [--repo <資料夾>] [--force] */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOKS = ['pre-push'];

function parseArgs(argv) {
  const o = { repo: path.join(__dirname, '..'), force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') o.repo = argv[++i];
    else if (argv[i] === '--force') o.force = true;
    else throw new Error('不認得的參數:' + argv[i]);
  }
  if (!o.repo) throw new Error('--repo 後面要接資料夾');
  return o;
}

function install(opts) {
  const dir = execFileSync('git', ['-C', opts.repo, 'rev-parse', '--git-path', 'hooks'], { encoding: 'utf8' }).trim();
  const hooksDir = path.resolve(opts.repo, dir);
  fs.mkdirSync(hooksDir, { recursive: true });
  const done = [];
  for (const name of HOOKS) {
    const src = fs.readFileSync(path.join(__dirname, 'hooks', name), 'utf8').replace(/\r\n/g, '\n');
    const dst = path.join(hooksDir, name);
    if (fs.existsSync(dst)) {
      const cur = fs.readFileSync(dst, 'utf8');
      if (cur === src) { done.push(name + ' 已是最新'); continue; }
      if (!opts.force) throw new Error(dst + ' 已經有別的內容,沒有覆蓋。確認可以換掉再加 --force');
    }
    fs.writeFileSync(dst, src);
    fs.chmodSync(dst, 0o755);
    done.push(name + ' 已裝到 ' + dst);
  }
  return done;
}

module.exports = { install, parseArgs };

if (require.main === module) {
  try {
    install(parseArgs(process.argv.slice(2))).forEach((l) => console.log(l));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
