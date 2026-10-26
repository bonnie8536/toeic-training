/* 同步合併(feat/sync-union)跟搬家(feat/move)合在一起時要成立的事(同步合併第二輪審查 #6、#7)。
   用法:node tools/test_sync_move_compat.js
   這個分支自己沒有搬家的檔案(js/move-rules.js、js/move-merge.js):只檢查自己這邊,搬家那幾項略過(算通過)。
   兩個分支都進 main 之後(或試合併的暫存 clone 裡)這幾項就會真的檢查,沒處理好會失敗:
   1. js/cloud.js 不能再用 MOVE_MERGE.mergeBanks 合併題庫(搬家暫存區 takePending 的 unionOf 兩步都是):
      它把蓋過戳記(_t、_p)的同一個題庫當成內容不同,複製一份新 id、名稱加「（舊網址）」,刪除標記(用 id 記)也對不上那份複本。
      合併表上的鍵(vgame_banks、sync_del、mock_history)要用 SYNC_MERGE(題庫帶合併後的 sync_del),或者 flushForMove
      讓合併表上的鍵直接合併上傳、不放進搬家包。
   2. js/move-rules.js 要有 sync_del 的規則,而且不是整份換掉的 'single'(要用 SYNC_MERGE.tombs 合併):
      沒有規則時搬家包會跳過它,舊網址離線刪掉的題庫、字搬過去之後會回來;flushForMove 不過濾就整包被 validate 拒絕。
   3. move-out.html 也要在 cloud.js 前面載入 js/sync-merge.js(tools/test_sync_union.js 第 21 項也會擋):
      沒載到的頁面灌資料時題庫留本機、不上傳(第 22 項),但寄出頁的 flushForMove 就傳不了題庫。
      move-in.html 要在 js/move-merge.js 前面載入:收件頁合併同一個帳號的兩包暫存區、看訪客題庫的戳記,都用 SYNC_MERGE。
   4. tools/test_pet_hooks.js 兩個分支各自改過(這邊加了 tools/fixtures/pet_hooks_base/ 基準檔,搬家那邊改了站名例外):
      合併時用合併後的頁面重新產生基準檔,兩邊的例外都留。這一項只能在合併時人工處理,這裡不檢查。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const has = f => fs.existsSync(path.join(REPO, f));
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + detail : ''));
}

/* 合併表上的鍵:從 js/cloud.js 的 MERGED 讀出來(不用載入整個 cloud.js) */
const cloudSrc = read('js/cloud.js');
const block = /const MERGED = \{([\s\S]*?)\n  \};/.exec(cloudSrc);
const merged = block ? (block[1].match(/^\s{4}(\w+):/gm) || []).map(s => s.trim().slice(0, -1)) : [];
const needed = merged.filter(k => k !== 'pet');
check('js/cloud.js 的合併表有題庫、刪除標記、模擬考紀錄', ['vgame_banks', 'sync_del', 'mock_history'].every(k => needed.indexOf(k) >= 0), JSON.stringify(merged));

const ctx = { console: { log() {}, warn() {}, error() {} } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('js/sync-merge.js'), ctx);
const SM = ctx.SYNC_MERGE;
check('SYNC_MERGE 有題庫、刪除標記、模擬考紀錄的合併函式', !!SM && ['banks', 'tombs', 'mock'].every(f => typeof SM[f] === 'function'), '');

const moving = has('js/move-rules.js') || has('js/move-merge.js');
if (!moving) {
  check('搬家的檔案不在這個分支:搬家那幾項略過(合進 feat/move 之後才檢查)', true, '');
} else {
  const usesMoveBanks = /\b(MM|MOVE_MERGE)\.mergeBanks\s*\(/.test(cloudSrc);
  check('js/cloud.js 合併題庫不用 MOVE_MERGE.mergeBanks(會把蓋過戳記的同一個題庫複製成「（舊網址）」、刪除標記對不上)', !usesMoveBanks,
    usesMoveBanks ? '還在用,搬家暫存區的題庫要改用 SYNC_MERGE.banks(帶 sync_del)' : '');
  if (has('js/move-rules.js')) {
    const c2 = { console: ctx.console };
    c2.window = c2;
    vm.createContext(c2);
    vm.runInContext(read('js/move-rules.js'), c2);
    const R = c2.MOVE_RULES;
    const rules = needed.map(k => [k, R && typeof R.ruleOf === 'function' ? R.ruleOf(k) : null]);
    const missing = rules.filter(x => !x[1]).map(x => x[0]);
    const single = rules.filter(x => x[0] === 'sync_del' && x[1] === 'single').length > 0;
    check('js/move-rules.js:合併表上的鍵都有搬家規則,sync_del 不是整份換掉的 single', !missing.length && !single,
      JSON.stringify(rules) + (missing.length ? ' 沒有規則:' + missing.join('、') : '') + (single ? ' sync_del 是 single' : ''));
  }
}

if (moving) {
  /* 3. 寄出頁、收件頁都要在用到合併的程式前面載入 js/sync-merge.js(只載一次) */
  const order = (f, before) => {
    const srcs = [];
    read(f).replace(/<script[^>]*\ssrc="([^"]+)"/g, (m, s) => { srcs.push(s); return m; });
    const i = srcs.indexOf('js/sync-merge.js'), j = srcs.indexOf(before);
    return i > -1 && j > -1 && i < j && srcs.lastIndexOf('js/sync-merge.js') === i;
  };
  check('move-out.html 在 js/cloud.js 前面載入 js/sync-merge.js', has('move-out.html') && order('move-out.html', 'js/cloud.js'), '');
  check('move-in.html 在 js/move-merge.js 前面載入 js/sync-merge.js', has('move-in.html') && order('move-in.html', 'js/move-merge.js'), '');
}

console.log(pass + ' / ' + (pass + fail) + ' 通過');
process.exit(fail ? 1 : 0);
