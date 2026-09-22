export const meta = {
  name: 'visual-system-research',
  description: '研究可愛系學習網站的視覺系統案例 + 稽核單字訓練頁使用流程,提出 3 個可落地的視覺方向',
  phases: [
    { title: 'Research', detail: '三路案例研究(語言學習 App/兒童與遊戲化學習/台日可愛風網站)' },
    { title: 'Audit', detail: '單字訓練頁流程稽核 + 現有樣式盤點' },
    { title: 'Synthesize', detail: '提出 3 個視覺方向與實作計畫' },
  ],
}

const REPO = 'C:\\Users\\bonni\\Desktop\\claude\\toeic-training'
const CTX = `對象網站「刷刷英文」(https://www.shuashualanguage.com/):台灣英文家教邱詩蘋(數位媒體設計碩士,自己會設計)做的免費英文練習站,純前端(HTML/CSS/原生 JS,無框架),學生從國高中到成人多益考生。現況視覺=白底、藍主色 #0b72c4、螢光筆黃、圓角 8px,偏「乾淨的教學網站」。站主現在說:「整個網站好像沒有一個可愛的視覺系統,想美化」,並希望文法區左邊有像 Duolingo 的圈圈路徑導引。她先前明確討厭的東西:AI 模板感(每個標題掛副標、eyebrow 小標、三欄同構卡、漸層紫、emoji 當圖示、口號式文案)。所以目標是「可愛、有辨識度、但不是模板」。品牌名「刷刷」有「刷題」與「刷子刷刷」的雙關。`

const CASE_SCHEMA = { type: 'object', required: ['cases', 'patterns'], properties: { cases: { type: 'array', items: { type: 'object', required: ['name', 'url', 'traits'], properties: { name: { type: 'string' }, url: { type: 'string' }, traits: { type: 'array', items: { type: 'string' } }, borrow: { type: 'string' }, avoid: { type: 'string' } } } }, patterns: { type: 'array', items: { type: 'object', required: ['pattern', 'how'], properties: { pattern: { type: 'string' }, how: { type: 'string' } } } } } }
const AUDIT_SCHEMA = { type: 'object', required: ['flowProblems', 'proposal', 'styleInventory'], properties: { flowProblems: { type: 'array', items: { type: 'string' } }, proposal: { type: 'object', required: ['structure', 'steps'], properties: { structure: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } } }, styleInventory: { type: 'array', items: { type: 'string' } } } }
const DIR_SCHEMA = { type: 'object', required: ['directions', 'recommendation', 'rollout'], properties: { directions: { type: 'array', items: { type: 'object', required: ['name', 'concept', 'palette', 'typography', 'shape', 'components', 'mascot', 'risk'], properties: { name: { type: 'string' }, concept: { type: 'string' }, palette: { type: 'object' }, typography: { type: 'string' }, shape: { type: 'string' }, components: { type: 'array', items: { type: 'string' } }, mascot: { type: 'string' }, grammarPath: { type: 'string' }, risk: { type: 'string' } } } }, recommendation: { type: 'string' }, rollout: { type: 'array', items: { type: 'string' } } } }

phase('Research')
const tracks = [
  { tag: 'langapps', ask: '語言學習產品:Duolingo(設計系統、路徑圈圈、按鈕的立體下緣、圓體字、吉祥物用法)、Drops、Memrise、Busuu、LingoDeer、Cake、VoiceTube Hero、Elsa。' },
  { tag: 'gamified', ask: '遊戲化/親和風學習與工具產品:Khan Academy Kids、Kahoot、Quizlet、Brilliant、Headspace(插畫系統)、Notion 的手繪插畫、Mailchimp 的品牌插畫、Finch、Habitica。' },
  { tag: 'tw-jp', ask: '台灣與日本的可愛風網站與教育品牌:均一教育平台、PaGamO、Hahow、Hello Kitty/San-X 以外的「簡單線條角色」品牌、日本教育 App(mikan、スタディサプリ)、LINE 貼圖式角色運用、jf open 粉圓體/源泉圓體/M PLUS Rounded 等中文圓體字的實際運用案例。' },
]
const research = await parallel(tracks.map(t => () => agent(`${CTX}\n\n請用 WebSearch/WebFetch 研究這一路案例:${t.ask}\n對每個案例整理【可在純 CSS/SVG 落地的具體視覺特徵】(色彩結構、圓角與描邊、按鈕與卡片的做法、字體、圖示與插畫風格、角色/吉祥物怎麼用、進度與路徑的視覺、微互動),以及「值得借的」與「不該學的」。最後歸納 6-10 條跨案例的共通手法(pattern + 在這個站怎麼做)。回傳 {cases, patterns}。`, { label: 'research:' + t.tag, phase: 'Research', schema: CASE_SCHEMA, effort: 'high' })))

phase('Audit')
const audit = await agent(`${CTX}\n\n請 Read ${REPO}\\js\\vocab.js(renderHome 與各遊戲)、${REPO}\\vocab.html、${REPO}\\css\\style.css(看 :root 變數、.part-card、.btn、.module-card、.topbar 等核心元件)。站主說「單字遊戲那邊使用者流程怪怪的,『更多玩法』那張卡很怪」。請:1) 以第一次來的學生視角走一遍單字訓練頁,列出流程上的具體問題(flowProblems);2) 提出重整後的頁面結構與操作步驟(proposal:例如先選字庫來源再選玩法、玩法用同一層級的卡片、我的題庫與片語特訓怎麼擺),要能用現有函式 startGame/startPairs/startToast/startMcq/startDrill 直接接上;3) 盤點現有樣式系統的事實(styleInventory:主色、圓角、陰影、字體、按鈕樣式、卡片樣式、有無插畫/圖示),供之後換視覺系統時知道要改哪些 token。回傳 {flowProblems, proposal, styleInventory}。`, { label: 'audit:vocab', phase: 'Audit', schema: AUDIT_SCHEMA, effort: 'high' })

phase('Synthesize')
const cases = research.filter(Boolean)
const final = await agent(`${CTX}\n\n根據以下案例研究與現況稽核,為「刷刷英文」提出 3 個明顯不同、都能用純 CSS+SVG 落地的可愛視覺方向。每個方向要有:name、concept(一句話)、palette(主色/輔色/背景/文字/成功/錯誤的 hex,確保文字對比足夠)、typography(中英文字體,優先可免費商用且能用 Google Fonts 或自架的圓體)、shape(圓角、描邊、陰影/立體下緣的規則)、components(按鈕/卡片/導覽/進度圈/徽章各怎麼長)、mascot(要不要角色、長什麼樣、用在哪;要能用簡單 SVG 畫出來,可呼應「刷刷」雙關)、grammarPath(文法左側圈圈路徑在這個方向下的樣子)、risk(會不會太幼稚、會不會又像模板)。然後給 recommendation(推薦哪一個與理由,考量學生含成人多益考生)與 rollout(分幾步上線、先改哪些 token 與元件)。\n\n案例研究:\n${JSON.stringify(cases, null, 1).slice(0, 60000)}\n\n現況稽核:\n${JSON.stringify(audit, null, 1)}`, { label: 'synthesize', phase: 'Synthesize', schema: DIR_SCHEMA, effort: 'high' })

return { research: cases, audit, directions: final }
