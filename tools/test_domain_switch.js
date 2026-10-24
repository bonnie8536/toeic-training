/* 切換日與換信箱之後,付款與網域的測試照樣要過(搬家計畫 7.2;步驟_Supabase.md 第二、三節部署前要跑)。
   把這個資料夾複製一份(不含 audio、img、.git),在複本裡做切換的那個 commit 會做的事:
   tools/domain.json 的 live 改成 new、填 switchDate、mail 換成一個假的信箱,跑 apply_domain.js,
   再跑 tools/test_newebpay.js、tools/test_checkout.js、tools/test_domain.js,都要過。複本跑完就刪,這個資料夾一個檔都不改。
   用法:node tools/test_domain_switch.js [--tmp <放複本的資料夾>] */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const args = process.argv.slice(2);
const TMP = path.resolve(args.indexOf('--tmp') > -1 ? args[args.indexOf('--tmp') + 1] : os.tmpdir());
const SKIP = new Set(['audio', 'img', '.git', 'node_modules']);
const FAKE_MAIL = 'rushup.support.test@example.com';

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach((d) => {
    if (SKIP.has(d.name)) return;
    const a = path.join(from, d.name), b = path.join(to, d.name);
    if (d.isDirectory()) copy(a, b); else if (d.isFile()) fs.copyFileSync(a, b);
  });
}
function node(file, cwd) {
  const r = spawnSync(process.execPath, [file], { cwd, encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || '');
  return { ok: r.status === 0, tail: out.trim().split('\n').filter((l) => /✖|FAIL|not ok/.test(l)).slice(0, 6).join(' | ') || out.trim().split('\n').slice(-1)[0] };
}

const dir = fs.mkdtempSync(path.join(TMP, 'domain-switch-'));
let pass = 0, total = 0;
try {
  copy(REPO, dir);
  const cfgPath = path.join(dir, 'tools', 'domain.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const cases = [
    ['切到新網址(live = new)', { live: 'new', switchDate: '2026-11-04' }],
    ['切到新網址,而且換了客服信箱', { live: 'new', switchDate: '2026-11-04', mail: FAKE_MAIL }],
    ['退回舊網址(live = old),信箱已經換了', { live: 'old', switchDate: '', mail: FAKE_MAIL }],
  ];
  for (const [name, over] of cases) {
    fs.writeFileSync(cfgPath, JSON.stringify(Object.assign({}, cfg, over), null, 2) + '\n');
    const ap = spawnSync(process.execPath, [path.join(dir, 'tools', 'apply_domain.js'), '--root', dir], { encoding: 'utf8' });
    if (ap.status !== 0) { total++; console.log('FAIL ' + name + '  →  apply_domain.js 失敗:' + (ap.stderr || ap.stdout)); continue; }
    for (const t of ['test_newebpay.js', 'test_checkout.js', 'test_domain.js']) {
      total++;
      const r = node(path.join(dir, 'tools', t), dir);
      if (r.ok) pass++;
      console.log((r.ok ? 'PASS ' : 'FAIL ') + name + ':' + t + '  →  ' + r.tail.slice(0, 300));
    }
  }
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('複本沒刪掉:' + dir); }
}
console.log(pass + ' / ' + total + ' 通過');
process.exit(pass === total ? 0 : 1);
