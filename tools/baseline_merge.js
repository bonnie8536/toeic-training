/* 版面基準的局部存檔：把這次量到的幾項併進 layout_baseline.json 的原文，給 check_layout.js 的 --pages 搭 --save 用。
   只改值有變的 key，其他 key 的原文（順序、縮排、排版、換行字元）一個位元組都不動；基準裡沒有的 key 接在最後面。
   改到或新增的值照原檔的縮排與換行字元寫。測試：node tools/test_layout_baseline.js */

/* 掃最外層物件，記下每個成員的 key 與值在原文的位置。呼叫前已經 JSON.parse 過，格式一定合法。 */
function scan(raw) {
  let i = raw.indexOf('{') + 1;
  const ws = () => { while (/\s/.test(raw[i])) i++; };
  const str = () => { i++; while (raw[i] !== '"') i += raw[i] === '\\' ? 2 : 1; i++; };
  const members = [];
  ws();
  while (raw[i] === '"') {
    const keyStart = i;
    str();
    const keyEnd = i;
    ws(); i++; ws();
    const valStart = i;
    let depth = 0;
    while (depth > 0 || (raw[i] !== ',' && raw[i] !== '}')) {
      if (raw[i] === '"') { str(); continue; }
      if (raw[i] === '{' || raw[i] === '[') depth++;
      else if (raw[i] === '}' || raw[i] === ']') depth--;
      i++;
    }
    let valEnd = i;
    while (/\s/.test(raw[valEnd - 1])) valEnd--;
    members.push({ key: JSON.parse(raw.slice(keyStart, keyEnd)), keyStart, keyEnd, valStart, valEnd });
    if (raw[i] === ',') i++;
    ws();
  }
  return members;
}

/* raw 是基準檔原文，updates 是這次量到的各項（key 是「寬度 頁面」）。
   回傳 text（新的檔案內容）、changed（值有變的 key）、added（新增的 key）；原文壞掉就丟錯，呼叫端不寫檔。 */
function mergeBaseline(raw, updates) {
  const base = JSON.parse(raw);
  if (!base || typeof base !== 'object' || Array.isArray(base)) throw new Error('基準檔最外層不是物件');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const members = scan(raw);
  if (!members.length) {
    return { text: JSON.stringify(updates, null, 1).split('\n').join(eol) + eol, changed: [], added: Object.keys(updates) };
  }

  /* 縮排單位取第一個 key 前面的空白；整檔擠在一行時就不縮排 */
  const first = members[0];
  const lead = raw.slice(raw.lastIndexOf('\n', first.keyStart - 1) + 1, first.keyStart);
  const unit = /^[ \t]*$/.test(lead) ? lead : '';
  const fmt = (v) => JSON.stringify(v, null, unit).split('\n').join(eol + unit);

  const changed = [], seen = new Set();
  let text = '', at = 0;
  for (const m of members) {
    if (!Object.prototype.hasOwnProperty.call(updates, m.key)) continue;
    seen.add(m.key);
    if (JSON.stringify(JSON.parse(raw.slice(m.valStart, m.valEnd))) === JSON.stringify(updates[m.key])) continue;
    text += raw.slice(at, m.valStart) + fmt(updates[m.key]);
    at = m.valEnd;
    changed.push(m.key);
  }

  /* 新的 key 接在最後一項後面，分隔與冒號照抄原檔第一、二項之間的寫法 */
  const added = Object.keys(updates).filter((k) => !seen.has(k));
  const last = members[members.length - 1];
  const sep = members.length > 1 ? raw.slice(first.valEnd, members[1].keyStart) : ',' + (unit ? eol + unit : '');
  const colon = raw.slice(first.keyEnd, first.valStart);
  const tail = added.map((k) => sep + JSON.stringify(k) + colon + fmt(updates[k])).join('');
  text += raw.slice(at, last.valEnd) + tail + raw.slice(last.valEnd);

  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(Object.assign({}, base, updates))) {
    throw new Error('併入後的內容與預期不符，已停止');
  }
  return { text, changed, added };
}

module.exports = { mergeBaseline };
