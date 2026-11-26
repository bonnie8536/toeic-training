/* 全站給人看的字不再出現「小雞」(2026-11-26 小雞改名「暴衝雞」,指這一類資料與功能的字改用「寵物」)。
   檢查範圍:repo 裡所有追蹤的 .html 與 .js(排除 tools/);
   不算:註解、console.* 與 throw new Error 那一行(給開發者看的,不會顯示給學生)、識別字與檔名(只看字串常值與 html 的文字、屬性)。
   用法:node tools/test_no_chick_text.js */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const REPO = path.join(__dirname, '..');
const WORD = '小雞';

const files = cp.execFileSync('git', ['-C', REPO, 'ls-files', '*.html', '*.js'], { encoding: 'utf8' })
  .split(/\r?\n/).filter(f => f && !f.startsWith('tools/'));

/* 取出 js 裡所有字串常值(單引號、雙引號、樣板字串)與它們所在的行;略過註解。正規表示式常值照前一個記號猜 */
function jsStrings(src) {
  const out = [];
  let i = 0, line = 1, prev = '';
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c, start = line; let j = i + 1, text = '';
      while (j < n && src[j] !== q) {
        if (src[j] === '\\') { text += src[j + 1]; j += 2; continue; }
        if (src[j] === '\n') line++;
        text += src[j++];
      }
      out.push({ text, line: start });
      i = j + 1; prev = 'x'; continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
      i = j + 1; prev = 'x'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

const hits = [];
const lineOf = (src, ln) => src.split('\n')[ln - 1] || '';
for (const f of files) {
  const src = fs.readFileSync(path.join(REPO, f), 'utf8');
  if (f.endsWith('.js')) {
    for (const s of jsStrings(src)) {
      if (!s.text.includes(WORD)) continue;
      if (/console\.\w+\(|throw new Error\(/.test(lineOf(src, s.line))) continue;
      hits.push(f + ':' + s.line + '  ' + s.text.slice(0, 40));
    }
  } else {
    const body = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    if (body.includes(WORD)) hits.push(f + '  (html)');
  }
}

let pass = 0, fail = 0;
function T(name, ok, detail) { if (ok) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '\n     ' + detail : '')); } }

T('全站(' + files.length + ' 個 .html、.js)給人看的字串裡沒有「' + WORD + '」', hits.length === 0, hits.join('\n     '));
/* 檢查器自己:認得出字串、略過註解與 console 行 */
const probe = jsStrings("// 小雞\n/* 小雞 */ var a = '小雞'; var r = /'/; var b = \"x\";\nvar c = `暴衝雞`;");
T('檢查器自測:只抓到字串常值,不抓註解,正規表示式裡的引號不會吃掉後面', probe.length === 3 && probe[0].text === '小雞' && probe[1].text === 'x' && probe[2].text === '暴衝雞', JSON.stringify(probe));
const ui = fs.readFileSync(path.join(REPO, 'js/pet-ui.js'), 'utf8');
T('js/pet-ui.js:預設名只有一個來源(DEFAULT_NAME = 暴衝雞),nameOf 用它,輸入框提示也用它', /const DEFAULT_NAME = '暴衝雞'/.test(ui) && /\|\| DEFAULT_NAME; \}/.test(ui) && /placeholder: DEFAULT_NAME/.test(ui) && (ui.match(/'暴衝雞'/g) || []).length === 1);
const mm = fs.readFileSync(path.join(REPO, 'js/move-merge.js'), 'utf8');
T('搬家頁項目名稱:pet「寵物」、pet_hint「寵物提示次數」', /pet: '寵物'/.test(mm) && /pet_hint: '寵物提示次數'/.test(mm));

console.log('\n' + pass + ' / ' + (pass + fail) + ' 通過');
process.exit(fail ? 1 : 0);
