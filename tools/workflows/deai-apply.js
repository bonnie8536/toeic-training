export const meta = {
  name: 'deai-apply',
  description: '依 deai_changes.json 逐檔套用去 AI 味修改(分檔平行),再獨立審查 diff 與語法',
  phases: [
    { title: 'Apply', detail: '5 組各自負責不同檔案,套用清單內的文字修改' },
    { title: 'Verify', detail: '語法/merge 檢查 + 逐項比對 diff 是否忠於清單' },
  ],
}

const REPO = 'C:\\Users\\bonni\\Desktop\\claude\\toeic-training'
const LIST = 'C:\\Users\\bonni\\AppData\\Local\\Temp\\claude\\C--\\27c708fc-37e1-4274-ad2f-027fb7f1c0da\\scratchpad\\deai_changes.json'

const GROUPS = [
  { tag: 'g1', files: ['index.html', 'js\\history.js', 'js\\review.js', 'js\\analysis.js', 'history.html', 'review.html', 'analysis.html'] },
  { tag: 'g2', files: ['js\\vocab.js', 'js\\ear.js', 'vocab.html', 'listening.html'] },
  { tag: 'g3', files: ['js\\reading.js', 'js\\grammar.js', 'js\\writing.js', 'reading.html', 'grammar.html', 'writing.html'] },
  { tag: 'g4', files: ['js\\practice.js', 'js\\mock.js', 'js\\diagnostic.js', 'practice.html', 'mock.html', 'diagnostic.html'] },
  { tag: 'g5', files: ['css\\style.css', 'js\\common.js', 'js\\profile.js', 'admin.html', 'js\\admin.js', 'terms.html', 'reset.html'] },
]

const RULES = `你在修「刷刷英文」網站的 AI 味(站主抱怨副標題太多)。專案在 ${REPO}。修改清單在 ${LIST}(JSON 陣列,每項 {file, locator, current, action, replacement, priority});先 Read 它,只處理 file 屬於你負責檔案的項目(file 欄是絕對路徑,比對檔名即可)。另外:清單裡 file 指向 data\\*.js 的項目【不可直接改 data/*.js】,要找到 data/raw/*.json 或 tools/ 裡的來源改那裡,並在回報標明「需 merge」。

作法:
1. 逐項 Read 目標檔,找到 locator/current 描述的位置,用 Edit 做最小修改:cut=整個元素/字串連同其容器節點一起拿掉(不留空的 p 或空字串節點);shorten=換成 replacement;merge=依 replacement 描述合併。
2. 只改文字與其直接容器,不重構程式、不改樣式檔以外的 CSS(g5 負責 style.css 的死樣式清理:只刪清單點名的規則)。刪掉元素後若有變數不再使用也一併移除,避免 lint 噪音。
3. 每改完一個 js 檔就跑 node --check <檔>;html 檔用肉眼確認標籤成對。
4. 找不到 locator 的項目不要硬改,回報 skipped 與原因。
5. 不要順手「改善」清單以外的文字。

回傳 {applied:[{file, locator, note}], skipped:[{file, locator, reason}], needMerge:boolean}。`

const APPLY_SCHEMA = { type: 'object', required: ['applied', 'skipped', 'needMerge'], properties: { applied: { type: 'array', items: { type: 'object', required: ['file', 'locator'], properties: { file: { type: 'string' }, locator: { type: 'string' }, note: { type: 'string' } } } }, skipped: { type: 'array', items: { type: 'object', required: ['file', 'locator', 'reason'], properties: { file: { type: 'string' }, locator: { type: 'string' }, reason: { type: 'string' } } } }, needMerge: { type: 'boolean' } } }
const VERIFY_SCHEMA = { type: 'object', required: ['syntaxOk', 'mergeOk', 'issues'], properties: { syntaxOk: { type: 'boolean' }, mergeOk: { type: 'boolean' }, issues: { type: 'array', items: { type: 'object', required: ['file', 'problem', 'severity'], properties: { file: { type: 'string' }, problem: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, fix: { type: 'string' } } } }, summary: { type: 'string' } } }

phase('Apply')
const results = await parallel(GROUPS.map(g => () =>
  agent(RULES + '\n\n你負責的檔案:' + g.files.join('、'), { label: 'apply:' + g.tag, phase: 'Apply', schema: APPLY_SCHEMA, effort: 'high' })))
const applied = results.filter(Boolean).flatMap(r => r.applied || [])
const skipped = results.filter(Boolean).flatMap(r => r.skipped || [])
const needMerge = results.filter(Boolean).some(r => r.needMerge)
log('套用 ' + applied.length + ' 項,跳過 ' + skipped.length + ' 項,需 merge=' + needMerge)

phase('Verify')
const verify = await agent(`你是獨立審查者。專案 ${REPO} 剛套用了一批「去 AI 味」文字修改,清單在 ${LIST}。請:
1. 在專案目錄跑 \`git diff --stat\` 與 \`git diff\`(Bash),逐一檢視改動。
2. 對每個改動判斷:是否對應清單某一項?有沒有改到清單以外的東西?有沒有把功能性資訊(題數、時間、規則、按鈕)刪掉?有沒有留下空節點、多餘逗號、未使用變數、壞掉的 JSX 類巢狀括號?
3. 跑 \`for f in js/*.js; do node --check $f || echo FAIL $f; done\` 與 \`python tools/merge_data.py\`(看有無硬錯誤)。
4. 對照這份已套用/跳過清單:\n${JSON.stringify({ applied, skipped }, null, 1)}
回傳 {syntaxOk, mergeOk, issues:[{file, problem, severity, fix}], summary}。issues 只列真的問題,沒有就空陣列。`, { label: 'verify', phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'high' })

return { applied: applied.length, skipped, needMerge, verify }
