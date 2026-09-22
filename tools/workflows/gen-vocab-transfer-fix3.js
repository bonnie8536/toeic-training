export const meta = {
  name: 'gen-vocab-transfer-fix3',
  description: '補寫 3 篇未通過的單字移轉考題(art-4a/9b/12b),針對上輪失敗理由重寫,盲解+歧義+規範三線驗證',
  phases: [
    { title: 'Generate', detail: '3 篇各自重寫' },
    { title: 'Verify', detail: '盲解/歧義攻擊/規範檢查' },
    { title: 'Regen', detail: '未過的再重寫+複驗' },
  ],
}

const PAYLOAD = 'C:\\Users\\bonni\\AppData\\Local\\Temp\\claude\\C--\\27c708fc-37e1-4274-ad2f-027fb7f1c0da\\scratchpad\\transfer_payload.json'
const IDS = ['art-4a', 'art-9b', 'art-12b']
const PRIOR = {
  'art-4a': '上一版失敗原因:(1)劇情換皮——原文是「舊咖啡機壞→網購新機→箱子送達→缺件→看說明書→打客服」,你寫成裁紙機卻沿用一模一樣的骨幹;這次情境必須完全不同(例如:健身房新會員第一天報到、社區公寓管委會處理停電、學校辦校外教學),不可再是「買機器→缺件→打客服」。(2)歧義——三個母音開頭的人稱名詞(employee/intern/agent)都接 an,可互換;每格必須用搭配詞釘死(例如 intern 前面放「summer」「two-month」、agent 前放「travel」「customer service」、employee 用「full-time」「of the month」)。(3)instructions 的正本 zh 是「使用說明」,只能用在說明書/產品指示語境,不可當「某人的指示」。',
  'art-9b': '上一版失敗原因:boss 與 manager 兩格可互換(「sales boss」讀得通)。這次 boss 只能出現在「my boss」「the boss of the company / owns the company」這類指最高負責人、且不可被 manager 替換的位置;manager 要接部門名(「the sales manager」「a store manager」)並讓該人物明顯位階較低(reports to)。product 與 package 也要各自釘死(product=可買賣的東西本身,package=包裝/包裹,用「open the package」「the product inside」區分)。',
  'art-12b': '上一版失敗原因:(1)譯文增譯(「市裡」原文沒有)——passageZh 必須逐句忠實,不加原文沒有的地名/修飾;(2)該篇 vocab 有 15 個,依規則只需挑 12 個,但請優先保留 harvest/crop/warning 這類承載力高的字並只用正本 zh 義項。情境要與原文(醜蔬菜/農民/超市退貨)明顯不同。',
}

const ITEM_PROPS = {
  articleId: { type: 'string' },
  passage: { type: 'string' },
  passageZh: { type: 'string' },
  words: { type: 'array', items: { type: 'object', required: ['word','base','zh'], properties: { word:{type:'string'}, base:{type:'string'}, zh:{type:'string'} } } },
}
const ONE_SCHEMA = { type:'object', required:['articleId','passage','passageZh','words'], properties: ITEM_PROPS }
const SOLVE_SCHEMA = { type:'object', required:['solutions'], properties:{ solutions:{ type:'array', items:{ type:'object', required:['articleId','assignment','uncertainPairs'], properties:{ articleId:{type:'string'}, assignment:{type:'object'}, uncertainPairs:{type:'array', items:{type:'array', items:{type:'string'}}} } } } } }
const AMBIG_SCHEMA = { type:'object', required:['results'], properties:{ results:{ type:'array', items:{ type:'object', required:['articleId','ambiguous','detail'], properties:{ articleId:{type:'string'}, ambiguous:{type:'boolean'}, detail:{type:'string'} } } } } }
const COMP_SCHEMA = { type:'object', required:['results'], properties:{ results:{ type:'array', items:{ type:'object', required:['articleId','ok','problems'], properties:{ articleId:{type:'string'}, ok:{type:'boolean'}, problems:{type:'array', items:{type:'string'}} } } } } }

const RULES = `你在為「刷刷英文」多益學習網站產出「單字移轉考題」:給定一篇已學文章的標記單字,寫一篇【全新情境】短文,把這些單字挖空,讓學生靠文意把單字放回正確位置。

先用 Read 讀 ${PAYLOAD}(JSON 陣列,每篇有 id/title/titleZh/category/level/summary(原文情境)/vocab[{word,base,pos,hint,zh}])。

每篇規則:
1. 從該篇 vocab 挑單字:vocab ≤12 個就全用;>12 個挑 12 個最有內容承載力的(名/動/形兼顧,棄虛詞感重的)。
2. 寫一篇全新短文,情境必須與原文(見 title/titleZh/summary)完全不同:換產業、換場景、換人物、換劇情骨幹(不可只是把物件換名字)。單字語意必須用 hint/zh 教過的那個義項。
3. 長度:一般 90-170 個英文字;level 為「初級」的:70-130 字、句子平均 ≤12 字、挖空字以外全用最常見的 2000 字內詞彙。可 1-3 段(段落間用 \\n\\n)。
4. 每個選中的單字在文中恰好出現一次,以 [[形態]] 標記;可依文法屈折變化(用實際出現的形態);標記外的內文不得出現任何選中單字(含其原形與變形)。
5. 【反歧義,最重要】拿掉所有標記後,每格必須能由上下文唯一決定:同詞性的字兩兩檢查——互換後必須在語意上明顯錯誤;用搭配詞、指涉對象、前後因果把每格釘死。特別注意:接同一冠詞(a/an)的同類名詞、同義近義的人稱名詞(boss/manager/employee/intern/agent)、包裝與內容物(package/product)這類最容易互換,必須各自加上專屬搭配詞。想像學生看著字卡列表逐格推理,不能有兩格可對調。
6. 詞彙全程限多益範圍(NGSL 3000+商業高頻);禁捏造統計數據/研究/機構名/真實品牌;人名用一般化姓名。英文用半形標點。
7. passageZh:全文逐句忠實繁體翻譯,全形標點,不增譯、不加原文沒有的地點或修飾。
8. words 陣列:每個挑中的字 {word: 文中實際形態, base: 照抄 vocab 的 base, zh: 照抄 vocab 的 zh(一字不改)}。`

function structCheck(item) {
  const errs = []
  const words = item.words || []
  if (words.length < 8 || words.length > 12) errs.push('words 數量 ' + words.length + ' 不在 8-12')
  const markers = [...String(item.passage).matchAll(/\[\[(.+?)\]\]/g)].map(m => m[1])
  const wset = words.map(w => w.word)
  if (markers.length !== wset.length) errs.push('標記數 ' + markers.length + ' != words 數 ' + wset.length)
  const mCount = {}
  markers.forEach(m => { mCount[m] = (mCount[m] || 0) + 1 })
  wset.forEach(w => { if ((mCount[w] || 0) !== 1) errs.push('單字 [' + w + '] 標記次數 ' + (mCount[w] || 0) + ' != 1') })
  const plain = String(item.passage).replace(/\[\[.+?\]\]/g, ' ').toLowerCase()
  words.forEach(w => {
    for (const f of [w.word, w.base]) {
      if (f && new RegExp('\\b' + f.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(plain)) { errs.push('單字 ' + f + ' 洩漏在標記外'); break }
    }
  })
  const wc = String(item.passage).replace(/\[\[|\]\]/g, '').split(/\s+/).filter(Boolean).length
  if (wc < 60 || wc > 230) errs.push('全文 ' + wc + ' 字超出 60-230')
  if (!/[一-鿿]/.test(item.passageZh || '')) errs.push('passageZh 缺中文')
  if (/[一-鿿]/.test(item.passage || '')) errs.push('passage 含中文')
  return errs
}

function blanked(item) {
  let n = 0
  const p = String(item.passage).replace(/\[\[(.+?)\]\]/g, () => { n++; return '【' + n + '】' })
  const bank = [...item.words.map(w => w.word)].sort((a, b) => {
    const ra = a.split('').reverse().join(''), rb = b.split('').reverse().join('')
    return ra < rb ? -1 : ra > rb ? 1 : 0
  })
  return { p, bank }
}

function keyOf(item) {
  const key = {}
  let n = 0
  String(item.passage).replace(/\[\[(.+?)\]\]/g, (_, w) => { n++; key[String(n)] = w; return '' })
  return key
}

async function verifyGroup(items, tag) {
  const solveInput = items.map(it => { const b = blanked(it); return { articleId: it.articleId, passage: b.p, bank: b.bank } })
  const [solved, ambig, comp] = await parallel([
    () => agent('你是英文完形測驗的受試者。以下每題給你一篇挖空短文(【1】..【N】)與字卡(可能是屈折後形態)。純靠上下文與文法把每張字卡放進唯一正確的格子,每張恰用一次。若某兩格你猶豫可互換,照樣填出最佳解,但把那組字放進 uncertainPairs。不要读取任何檔案,只用題面資訊。題目:\n' + JSON.stringify(solveInput, null, 1) + '\n回傳 solutions:[{articleId, assignment:{"1":"字",...}, uncertainPairs:[["字1","字2"],...]}]', { label: 'solve:' + tag, phase: 'Verify', schema: SOLVE_SCHEMA, effort: 'high' }),
    () => agent('你是出題審查者,任務是【攻擊】完形題的唯一性。每題給你挖空短文、字卡、與標準答案。請刻意尋找「另一組完整填法」或「兩格互換後仍讀得通」的情形(文法正確且語意不明顯錯誤即算)。找得到=ambiguous:true 並在 detail 說明哪幾格哪幾字;真的找不到才回 false。題目:\n' + JSON.stringify(items.map(it => { const b = blanked(it); return { articleId: it.articleId, passage: b.p, bank: b.bank, answerKey: keyOf(it) } }), null, 1) + '\n回傳 results:[{articleId, ambiguous, detail}]', { label: 'ambig:' + tag, phase: 'Verify', schema: AMBIG_SCHEMA, effort: 'high' }),
    () => agent('你是規範審查者。先 Read ' + PAYLOAD + ' 取得各篇原文資訊與 vocab 正本。逐篇檢查以下生成品:\n' + JSON.stringify(items, null, 1) + '\n檢查項:1) words 每項 base 與 zh 必須與 payload 該篇 vocab 完全一致(zh 一字不差),word 是該 base 的合理屈折形;【注意】規格允許 vocab 超過 12 個時只挑 12 個,漏用其餘字不算問題;2) 情境必須與原文 title/summary 明顯不同(同劇情骨幹只換物件名=不過);3) 全文(含挖空字外)詞彙在多益範圍(NGSL3000+商業高頻),超綱字列出;4) 無捏造統計/研究/機構/真實品牌;5) level 初級者句子明顯簡短;6) passageZh 是逐句忠實繁體翻譯(不增譯、不漏譯)且標點全形、英文 passage 標點半形;7) 挖空處填回答案後每句文法正確;8) 每個挖空字的用法必須符合正本 zh 的義項(例如 instructions=使用說明 不可當「某人的指示」)。全部通過= ok:true,否則列 problems。回傳 results:[{articleId, ok, problems}]', { label: 'comp:' + tag, phase: 'Verify', schema: COMP_SCHEMA, effort: 'high' }),
  ])
  const fails = {}
  for (const it of items) {
    const reasons = []
    const key = keyOf(it)
    const sol = solved && (solved.solutions || []).find(s => s.articleId === it.articleId)
    if (!sol) reasons.push('盲解者未回傳')
    else {
      const wrong = Object.entries(key).filter(([n, w]) => (sol.assignment || {})[n] !== w)
      if (wrong.length) reasons.push('盲解錯 ' + wrong.length + ' 格: ' + wrong.map(([n, w]) => n + '應為' + w + '實為' + ((sol.assignment || {})[n] || '空')).join('; '))
      if ((sol.uncertainPairs || []).length) reasons.push('盲解者猶豫可互換: ' + JSON.stringify(sol.uncertainPairs))
    }
    const am = ambig && (ambig.results || []).find(r => r.articleId === it.articleId)
    if (am && am.ambiguous) reasons.push('歧義攻擊成功: ' + am.detail)
    if (!am && ambig) reasons.push('歧義審查未回傳')
    const cp = comp && (comp.results || []).find(r => r.articleId === it.articleId)
    if (cp && !cp.ok) reasons.push('規範: ' + (cp.problems || []).join(' | '))
    if (!cp && comp) reasons.push('規範審查未回傳')
    if (!solved || !ambig || !comp) reasons.push('驗證線路缺席(' + [!solved && '盲解', !ambig && '歧義', !comp && '規範'].filter(Boolean).join('/') + ')')
    if (reasons.length) fails[it.articleId] = reasons
  }
  return fails
}

phase('Generate')
const genResults = await parallel(IDS.map(id => () =>
  agent(RULES + '\n\n你只負責這一篇:' + id + '\n' + PRIOR[id] + '\n回傳單篇物件。', { label: 'gen:' + id, phase: 'Generate', schema: ONE_SCHEMA, effort: 'high' })))

let pool = {}
let failed = {}
genResults.filter(Boolean).forEach(it => {
  const errs = structCheck(it)
  if (errs.length) failed[it.articleId] = ['結構: ' + errs.join('; ')]
  else pool[it.articleId] = it
})
IDS.forEach(id => { if (!pool[id] && !failed[id]) failed[id] = ['生成缺漏'] })
log('初生成通過結構檢查 ' + Object.keys(pool).length + '/3')

phase('Verify')
{
  const items = IDS.map(id => pool[id]).filter(Boolean)
  if (items.length) {
    const f = await verifyGroup(items, 'g0')
    Object.entries(f).forEach(([id, rs]) => { failed[id] = rs; delete pool[id] })
  }
}
log('首輪通過 ' + Object.keys(pool).length + '/3,待重生成 ' + Object.keys(failed).length)

phase('Regen')
for (let round = 1; round <= 3 && Object.keys(failed).length; round++) {
  const targets = Object.entries(failed)
  failed = {}
  const regenned = await parallel(targets.map(([id, reasons]) => () =>
    agent(RULES + '\n\n你只負責重寫這一篇:' + id + '\n' + PRIOR[id] + '\n最新一版仍未通過,原因:\n- ' + reasons.join('\n- ') + '\n請針對原因徹底改寫(歧義問題=加強每格的搭配詞/指涉錨定,或換掉難以錨定的字)。回傳單篇物件。', { label: 'regen' + round + ':' + id, phase: 'Regen', schema: ONE_SCHEMA, effort: 'high' })))
  const reverify = []
  regenned.filter(Boolean).forEach(it => {
    const errs = structCheck(it)
    if (errs.length) failed[it.articleId] = ['結構: ' + errs.join('; ')]
    else reverify.push(it)
  })
  targets.forEach(([id]) => { if (!regenned.filter(Boolean).some(r => r.articleId === id) && !failed[id]) failed[id] = ['重生成未回傳'] })
  if (reverify.length) {
    const f = await verifyGroup(reverify, 'r' + round)
    reverify.forEach(it => { if (f[it.articleId]) failed[it.articleId] = f[it.articleId]; else pool[it.articleId] = it })
  }
  log('重生成第 ' + round + ' 輪後通過 ' + Object.keys(pool).length + '/3,仍失敗 ' + Object.keys(failed).length)
}

return { passed: Object.keys(pool).length, failedIds: failed, items: Object.values(pool) }
