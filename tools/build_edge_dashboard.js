/* 沒有 Supabase CLI、要用 Supabase 後台的函式編輯器部署時用。
   後台編輯器的一支函式只看得到自己資料夾裡的檔案,讀不到 supabase/functions/_shared/。
   這支把每支函式需要的檔案攤平到同一個資料夾,並把 '../_shared/xxx.ts' 改成 './xxx.ts',其他內容一字不改。
   用法:node tools/build_edge_dashboard.js <輸出資料夾>
     例:node tools/build_edge_dashboard.js D:/claudecode/刷刷英文開發/收費/newebpay/後台貼上用
   輸出:<輸出資料夾>/newebpay-checkout/*.ts、<輸出資料夾>/newebpay-notify/*.ts
   每個檔案在後台編輯器新增一個同名檔案、整份貼上;index.ts 是進入點。 */
const fs = require('fs');
const path = require('path');

const FN = path.join(__dirname, '..', 'supabase', 'functions');
const FUNCTIONS = ['newebpay-checkout', 'newebpay-notify'];
const IMPORT_RE = /from '(\.\.\/_shared\/|\.\/)([a-z_]+\.ts)'/g;

function collect(fnName) {
  const out = new Map(); // 檔名 → 內容
  const queue = [path.join(FN, fnName, 'index.ts')];
  while (queue.length) {
    const file = queue.shift();
    const name = path.basename(file);
    if (out.has(name)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const dep = m[1] === './' ? path.join(path.dirname(file), m[2]) : path.join(FN, '_shared', m[2]);
      queue.push(dep);
    }
    if (/from '\.\.\/(?!_shared\/)/.test(src)) throw new Error(`${file}:有沒處理到的上層 import`);
    out.set(name, src.replace(IMPORT_RE, (_, _dir, f) => `from './${f}'`));
  }
  return out;
}

function build(outDir) {
  const result = {};
  for (const fnName of FUNCTIONS) {
    const files = collect(fnName);
    const dir = path.join(outDir, fnName);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, src] of files) fs.writeFileSync(path.join(dir, name), src, 'utf8');
    result[fnName] = [...files.keys()].sort();
  }
  return result;
}

module.exports = { build, collect };

if (require.main === module) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('用法:node tools/build_edge_dashboard.js <輸出資料夾>');
    process.exit(1);
  }
  const r = build(path.resolve(outDir));
  for (const [fnName, files] of Object.entries(r)) console.log(`${fnName}: ${files.join('、')}`);
}
