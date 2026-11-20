/* 音檔與資料對得上的測試：不連網、不需要金鑰。
   用法：node tools/test_audio_files.js
   從 data/*.js 與各頁播放音檔的規則算出「應該有的檔名」，檢查：
   - 每個該播的檔都在 audio/ 下、不是空檔、開頭是 mp3 檔頭
   - audio/ 下沒有多出來的檔（頁面不會播、也不在預留名單內）
   - tools/audio_manifest.json 與 audio/ 下的檔一一對應、沒有重複、引擎全是 Azure
   - 預留名單：聽寫題的中文翻譯 dz-NN.mp3（目前頁面只在跟讀播中文，聽寫不播），數量固定、必須在 manifest 內
   播放規則對應：js/listening.js（Part 1-4 用題目 id）、js/ear.js（聽寫、易混音、數字用 id；跟讀用 id 加 dz-<id> 中文）、
   js/phonics.js（單字 ph-<slug>、句子 ph-s-<課 id>-<第幾句>）、js/dialogue.js（dlg/<對話 id>-<兩位數句序>）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const AUDIO = path.join(REPO, 'audio');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !detail ? '' : '  ->  ' + detail)); };
const head = (arr, n) => arr.slice(0, n || 8).join(', ') + (arr.length > (n || 8) ? ' ...共 ' + arr.length : '');

/* ---------- 讀資料 ---------- */
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['listening', 'ear', 'dialogues', 'phonics']) vm.runInContext(fs.readFileSync(path.join(REPO, 'data', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const T = ctx.TOEIC, D = ctx.TOEIC_DIALOGUES;

/* ---------- 算出該播的檔名（相對 audio/） ---------- */
const expected = new Map(); // 檔名 -> 來源說明
const need = (file, why) => { if (!expected.has(file)) expected.set(file, why); };
const pad2 = (n) => String(n).padStart(2, '0');
const slug = (w) => String(w).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

['p1', 'p2', 'p3', 'p4'].forEach((k) => T.listening[k].forEach((q) => need(q.id + '.mp3', '聽力 ' + k)));
['dictation', 'pairs', 'numbers', 'shadow'].forEach((k) => T.ear[k].forEach((q) => need(q.id + '.mp3', '英語耳 ' + k)));
T.ear.shadow.forEach((q) => need('dz-' + (q.id.charAt(0) === 's' ? q.id : q.id.slice(2)) + '.mp3', '跟讀中文翻譯'));
D.forEach((d) => d.lines.forEach((l, i) => need('dlg/' + d.id + '-' + pad2(i + 1) + '.mp3', '對話練習')));
T.phonics.forEach((u) => {
  const w = (x) => { if (x) need('ph-' + slug(x) + '.mp3', '自然發音單字'); };
  w((u.key || {}).word);
  let n = 0;
  (u.lesson || []).forEach((b) => {
    if (b.t === 'words') (b.items || []).forEach((it) => w(it.w));
    else if (b.t === 'pairs') (b.items || []).forEach((it) => { w(it.a); w(it.b); });
    else if (b.t === 'sent') { n++; need('ph-s-' + u.id + '-' + n + '.mp3', '自然發音句子'); }
  });
  (u.quiz || []).forEach((q) => {
    w(q.word);
    const opts = q.options || [];
    if (opts.every((o) => /^[A-Za-z][A-Za-z'-]*$/.test(String(o)))) opts.forEach(w);
  });
});

/* 預留：聽寫題前 60 句的中文翻譯（頁面目前不播） */
const reserved = new Set();
T.ear.dictation.slice(0, 60).forEach((q) => { const f = 'dz-' + q.id.slice(2) + '.mp3'; if (!expected.has(f)) reserved.add(f); });
const RESERVED_COUNT = 60;

/* ---------- 實際的檔 ---------- */
function walk(dir, base) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out = out.concat(walk(path.join(dir, e.name), rel)); else out.push(rel);
  }
  return out;
}
const actual = walk(AUDIO, '');
const actualSet = new Set(actual);

check('audio/ 下只有 mp3', actual.every((f) => f.endsWith('.mp3')), head(actual.filter((f) => !f.endsWith('.mp3'))));
const missing = [...expected.keys()].filter((f) => !actualSet.has(f));
check('資料裡每個會播的音檔都存在（共 ' + expected.size + ' 個）', missing.length === 0, head(missing));
const small = [], badHead = [];
for (const f of actual) {
  const buf = fs.readFileSync(path.join(AUDIO, f));
  if (buf.length < 1000) small.push(f + '(' + buf.length + ')');
  const id3 = buf.slice(0, 3).toString('latin1') === 'ID3';
  const sync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
  if (!id3 && !sync) badHead.push(f);
}
check('沒有空檔或過小的檔（小於 1000 位元組）', small.length === 0, head(small));
check('每個檔開頭都是 mp3 檔頭', badHead.length === 0, head(badHead));
const extra = actual.filter((f) => !expected.has(f) && !reserved.has(f));
check('沒有多出來的檔', extra.length === 0, head(extra));
check('預留名單（聽寫中文翻譯）數量固定為 ' + RESERVED_COUNT, reserved.size === RESERVED_COUNT, '實際 ' + reserved.size);
check('預留的檔都在 audio/ 下', [...reserved].every((f) => actualSet.has(f)));

/* ---------- manifest ---------- */
let man = [];
try { man = JSON.parse(fs.readFileSync(path.join(__dirname, 'audio_manifest.json'), 'utf8')); } catch (e) { check('讀得到 tools/audio_manifest.json', false, e.message); }
const manFiles = man.map((m) => m.file);
check('manifest 每檔只有一筆', new Set(manFiles).size === manFiles.length);
const manSet = new Set(manFiles);
const notInMan = actual.filter((f) => !manSet.has(f)), notOnDisk = manFiles.filter((f) => !actualSet.has(f));
check('audio/ 下每個檔都在 manifest', notInMan.length === 0, head(notInMan));
check('manifest 每一筆都有實際的檔', notOnDisk.length === 0, head(notOnDisk));
check('manifest 筆數與實際檔數相同', man.length === actual.length, man.length + ' vs ' + actual.length);
check('引擎欄位全部是 Azure', man.length > 0 && man.every((m) => m.engine === 'azure-neural-tts'), head([...new Set(man.map((m) => m.engine))]));
const KEYS = ['file', 'category', 'voices', 'rate', 'seconds', 'engine', 'date'];
check('manifest 欄位只有檔名、類別、聲音、語速、秒數、引擎、日期', man.every((m) => Object.keys(m).every((k) => KEYS.includes(k))));
check('manifest 秒數都是正數', man.every((m) => typeof m.seconds === 'number' && m.seconds > 0));
const raw = fs.readFileSync(path.join(__dirname, 'audio_manifest.json'), 'utf8');
check('manifest 沒有磁碟路徑', !/[A-Za-z]:[\\/]|\/Users\//.test(raw));

console.log('\n' + pass + ' 項通過，' + fail + ' 項失敗');
process.exit(fail ? 1 : 0);
