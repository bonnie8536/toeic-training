export const meta = {
  name: 'gen-shadow-b3',
  description: '句子跟讀題庫擴充 120 句(s-101~s-220):四組分主題生成,獨立審查自然度/發音提示/翻譯/重複,未過重寫',
  phases: [
    { title: 'Generate', detail: '4 組各 30 句,分主題避免重複' },
    { title: 'Verify', detail: '每組獨立審查' },
    { title: 'Regen', detail: '未過的句子重寫並複驗' },
  ],
}

const REPO = 'C:\\Users\\bonni\\Desktop\\claude\\toeic-training'
const GROUPS = [
  { tag: 'g1', from: 101, theme: '居家日常、家人室友、家事、睡眠作息、手機與網路', levels: '初級 12、中級 11、進階 7' },
  { tag: 'g2', from: 131, theme: '餐廳點餐、咖啡店、超市與購物、付款退換貨、外送', levels: '初級 10、中級 12、進階 8' },
  { tag: 'g3', from: 161, theme: '交通(捷運公車計程車)、問路、旅行住宿、機場、天氣', levels: '初級 9、中級 12、進階 9' },
  { tag: 'g4', from: 191, theme: '職場與學校:開會、請假、約時間、請同事幫忙、電話與訊息、看醫生與身體狀況', levels: '初級 9、中級 10、進階 11' },
]

const RULES = `你在為「刷刷英文」的「句子跟讀」(shadowing)題庫寫新句子。學生會聽一句、跟著唸兩遍,所以句子要短、口語、生活中真的會講。
先 Read ${REPO}\\data\\raw\\ear_shadow.json 與 ${REPO}\\data\\raw\\ear_shadow_b2.json(既有 100 句),新句子不可與既有句子重複或只換一兩個字。

每句格式 {id, level, text, zh, note},規則:
1. text:4-10 個英文字(以空白分隔計,縮寫 I'd / don't 算一個字);母語者日常真的會說的完整句子(可問句/祈使句/回應句);不要書面語、不要多益考題腔、不要諺語;詞彙限常用 3000 字;禁人名地名品牌。
2. level:初級=4-6 字、結構簡單;中級=6-8 字、含常見連音或弱讀;進階=8-10 字、含子句或多處連音/省音。
3. zh:自然的台灣口語翻譯(不是逐字翻),標點照既有檔案風格(句號用「。」,問號用半形「?」)。
4. note:一句中文,指出這句跟讀時最該注意的 1-2 個發音現象(連音、弱讀、t/d 省音、重音位置),要寫出具體的字,像既有檔案那樣;發音描述必須正確(美式一般發音),不確定就挑確定的現象講;不要用 IPA 以外的奇怪符號,可用「tə」「ən」這種簡單標示。
5. 同一組內句型要多樣:陳述/疑問/請求/回應交錯,不要連續用同一開頭。

回傳 items(30 句)。`

const ITEM = { type: 'object', required: ['id', 'level', 'text', 'zh', 'note'], properties: { id: { type: 'string' }, level: { type: 'string', enum: ['初級', '中級', '進階'] }, text: { type: 'string' }, zh: { type: 'string' }, note: { type: 'string' } } }
const GEN_SCHEMA = { type: 'object', required: ['items'], properties: { items: { type: 'array', items: ITEM } } }
const VER_SCHEMA = { type: 'object', required: ['results'], properties: { results: { type: 'array', items: { type: 'object', required: ['id', 'ok', 'problems'], properties: { id: { type: 'string' }, ok: { type: 'boolean' }, problems: { type: 'array', items: { type: 'string' } } } } } } }

function structErrs(it) {
  const e = []
  const wc = String(it.text || '').trim().split(/\s+/).length
  if (wc < 4 || wc > 10) e.push('字數 ' + wc + ' 不在 4-10')
  if (!/^s-\d+$/.test(it.id || '')) e.push('id 格式')
  if (/[一-鿿]/.test(it.text || '')) e.push('text 含中文')
  if (!/[一-鿿]/.test(it.zh || '')) e.push('zh 缺中文')
  if (!it.note || it.note.length < 8) e.push('note 太短')
  return e
}

async function verify(items, tag) {
  const r = await agent(`你是英語教學審查者(母語程度),審查以下「句子跟讀」新句子。先 Read ${REPO}\\data\\raw\\ear_shadow.json 與 ear_shadow_b2.json 以便比對重複。逐句檢查:1) 是不是母語者日常真的會說的自然口語(生硬、書面、教科書腔=不過);2) 與既有 100 句或本批其他句是否重複/近似;3) zh 是否準確且是自然的台灣口語;4) note 的發音描述是否正確(連音、弱讀、省音、重音位置有沒有講錯;講錯=不過,並指出哪裡錯);5) level 與句長/難度是否相符(初級4-6字、中級6-8、進階8-10);6) 有無人名地名品牌、超出常用 3000 字的字。\n句子:\n${JSON.stringify(items, null, 1)}\n回傳 results:[{id, ok, problems}],ok=false 要寫具體問題。`, { label: 'verify:' + tag, phase: 'Verify', schema: VER_SCHEMA, effort: 'high' })
  const fails = {}
  for (const it of items) {
    const s = structErrs(it)
    const v = r && (r.results || []).find(x => x.id === it.id)
    const reasons = [...s]
    if (!v) reasons.push('審查未回傳')
    else if (!v.ok) reasons.push(...(v.problems || ['未說明']))
    if (reasons.length) fails[it.id] = reasons
  }
  return fails
}

phase('Generate')
const gens = await parallel(GROUPS.map(g => () => agent(RULES + `\n\n你這一組:主題=${g.theme};id 從 s-${g.from} 連號到 s-${g.from + 29};難度分配=${g.levels}。`, { label: 'gen:' + g.tag, phase: 'Generate', schema: GEN_SCHEMA, effort: 'high' })))

let pool = {}
let failed = {}
phase('Verify')
const vres = await parallel(GROUPS.map((g, i) => async () => {
  const items = (gens[i] && gens[i].items) || []
  if (!items.length) return { items: [], fails: {} }
  return { items, fails: await verify(items, g.tag) }
}))
vres.filter(Boolean).forEach(r => r.items.forEach(it => { if (r.fails[it.id]) failed[it.id] = { it, reasons: r.fails[it.id] }; else pool[it.id] = it }))
log('首輪通過 ' + Object.keys(pool).length + ',待重寫 ' + Object.keys(failed).length)

phase('Regen')
for (let round = 1; round <= 2 && Object.keys(failed).length; round++) {
  const targets = Object.values(failed)
  failed = {}
  const chunks = []
  for (let i = 0; i < targets.length; i += 15) chunks.push(targets.slice(i, i + 15))
  const redo = await parallel(chunks.map((ch, ci) => () => agent(RULES + `\n\n以下句子未通過審查,請逐句重寫(保留原 id 與大致主題,可整句換掉);已通過的句子如下,不要與它們重複:\n${JSON.stringify(Object.values(pool).map(x => x.text))}\n\n待重寫:\n${JSON.stringify(ch.map(t => ({ id: t.it.id, level: t.it.level, old: t.it.text, problems: t.reasons })), null, 1)}\n回傳 items(每個 id 一句)。`, { label: 'regen' + round + ':c' + ci, phase: 'Regen', schema: GEN_SCHEMA, effort: 'high' })))
  const items = redo.filter(Boolean).flatMap(r => r.items || [])
  if (items.length) {
    const fails = await verify(items, 'r' + round)
    items.forEach(it => { if (fails[it.id]) failed[it.id] = { it, reasons: fails[it.id] }; else pool[it.id] = it })
  }
  targets.forEach(t => { if (!pool[t.it.id] && !failed[t.it.id]) failed[t.it.id] = t })
  log('重寫第 ' + round + ' 輪後通過 ' + Object.keys(pool).length + ',仍未過 ' + Object.keys(failed).length)
}

return { passed: Object.keys(pool).length, failed: Object.fromEntries(Object.entries(failed).map(([k, v]) => [k, v.reasons])), items: Object.values(pool) }
