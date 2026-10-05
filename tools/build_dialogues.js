/* 對話練習的資料:data/raw/dialogues.json → data/dialogues.js(網站讀這個,勿手改)。
   產生前逐段檢查,有任何錯誤就不寫檔、exit 1。
   用法:node tools/build_dialogues.js        檢查並產生
        node tools/build_dialogues.js --check 只檢查 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const RAW = path.join(REPO, 'data', 'raw', 'dialogues.json');
const OUT = path.join(REPO, 'data', 'dialogues.js');
const CATS = ['朋友閒聊', '吃吃喝喝', '購物與服務', '交通與旅行', '校園與職場', '休閒生活'];
const LEVELS = ['初級', '中級', '進階'];
const PROFANITY = /\b(damn|dammit|hell|crap|crappy|shit|fuck\w*|ass|asshole|bitch\w*|piss(ed)?|bastard|dick)\b/i;
const ACRONYMS = ['FOMO', 'YOLO', 'ASAP', 'TBH', 'IMO', 'IRL', 'BTW', 'OMG', 'DIY', 'ETA', 'GOAT'];   // 本來就寫成大寫的縮寫
const MAINLAND = ['網絡', '視頻', '質量', '信息', '軟件', '硬件', '默認', '鼠標', '打印', '屏幕', '短信', '博客', '高清', '出租車', '激活', '服務器', '數據庫'];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function check(list) {
  const errs = [];
  const seen = new Set();
  if (!Array.isArray(list) || !list.length) return ['資料是空的'];
  list.forEach((d, di) => {
    const at = (msg) => errs.push((d.id || '#' + di) + ':' + msg);
    if (!/^dlg-\d{2}$/.test(d.id || '')) at('id 格式要是 dlg-NN');
    if (seen.has(d.id)) at('id 重複'); seen.add(d.id);
    if (!CATS.includes(d.cat)) at('分類不在清單裡:' + d.cat);
    if (!LEVELS.includes(d.level)) at('等級不在清單裡:' + d.level);
    ['title', 'titleEn', 'scene'].forEach((k) => { if (!d[k] || typeof d[k] !== 'string') at('缺 ' + k); });
    const sp = d.speakers || {};
    ['A', 'B'].forEach((k) => {
      if (!sp[k] || !sp[k].name) at('缺說話的人 ' + k);
      else if (!['M', 'F'].includes(sp[k].gender)) at('說話的人 ' + k + ' 的 gender 要是 M 或 F');
    });
    if (sp.A && sp.B && sp.A.name === sp.B.name) at('兩個人同名');
    const lines = d.lines || [];
    if (lines.length < 10 || lines.length > 20) at('句數 ' + lines.length + '(要 10 到 20)');
    let slang = 0;
    lines.forEach((l, li) => {
      const L = (msg) => at('第 ' + (li + 1) + ' 句 ' + msg);
      if (!['A', 'B'].includes(l.s)) L('說話的人要是 A 或 B');
      if (!l.en || !l.zh) L('缺英文或中文');
      if (PROFANITY.test(l.en || '')) L('有不適合的字:' + (l.en.match(PROFANITY) || [])[0]);
      if (/[&@#]/.test(l.en || '')) L('英文有 & @ # 這類符號,語音會念怪');
      const caps = ((l.en || '').match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !ACRONYMS.includes(w));
      if (caps.length) L('英文有整個大寫的字(' + caps.join('、') + '),語音會念怪');
      (l.slang || []).forEach((s) => {
        slang++;
        if (!s.t || !s.m) L('口語說明缺欄位');
        else if ((l.en || '').toLowerCase().indexOf(s.t.toLowerCase()) < 0) L('口語「' + s.t + '」不在這句英文裡');
      });
    });
    if (slang < 3) at('口語只有 ' + slang + ' 個');
    // 中文規則:所有中文欄位
    const zhTexts = [d.title, d.scene, ...lines.flatMap((l) => [l.zh, ...(l.slang || []).flatMap((s) => [s.m, s.n || ''])])];
    zhTexts.forEach((t) => {
      if (!t) return;
      if (EMOJI.test(t)) at('中文有 emoji:' + t);
      if (/——|—|–/.test(t)) at('中文有破折號:' + t);
      if (/不是[^。,,]{0,20}而是/.test(t)) at('用了「不是…而是…」:' + t);
      const hit = MAINLAND.find((w) => t.includes(w));
      if (hit) at('大陸用語「' + hit + '」:' + t);
    });
  });
  return errs;
}

const list = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const errs = check(list);
if (errs.length) {
  console.log('有 ' + errs.length + ' 個問題,沒有產生檔案:');
  errs.forEach((e) => console.log('  ' + e));
  process.exit(1);
}
const lines = list.reduce((n, d) => n + d.lines.length, 0);
if (process.argv.includes('--check')) { console.log('檢查通過:' + list.length + ' 段、' + lines + ' 句'); process.exit(0); }
fs.writeFileSync(OUT, '/* 對話練習資料。由 tools/build_dialogues.js 從 data/raw/dialogues.json 產生,勿手改。 */\n'
  + 'window.TOEIC_DIALOGUES = ' + JSON.stringify(list, null, 1) + ';\n');
console.log('已產生 data/dialogues.js:' + list.length + ' 段、' + lines + ' 句');
