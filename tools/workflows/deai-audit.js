export const meta = {
  name: 'deai-audit',
  description: '研究「AI 感網站」特徵 + 逐頁盤點刷刷英文的副標題/說明文,產出留/刪/縮清單',
  phases: [
    { title: 'Research', detail: '上網整理 AI 生成網站的典型特徵' },
    { title: 'Audit', detail: '4 組逐頁列出標題與其下說明文' },
    { title: 'Consolidate', detail: '合併成可執行的修改清單' },
  ],
}

const REPO = 'C:\\Users\\bonni\\Desktop\\claude\\toeic-training'
const PREF = `站主(英文家教)的既有偏好,視為硬規則:不要長頁塞滿、不要擠;禁冗餘說明文、禁裝飾性英文小標(READING 這種 eyebrow tag)、禁對仗標語、禁 emoji;禁「冒號小標」「破折號堆疊」這類 AI 寫法;她這次明講:「網站看起來很 AI,主因是副標題太多」。參考對象=真實教學網站(Engoo/VoiceTube 那種):標題直接、說明文極少、內容本身就是頁面。`

const RESEARCH_SCHEMA = { type: 'object', required: ['markers'], properties: { markers: { type: 'array', items: { type: 'object', required: ['marker', 'why', 'fix'], properties: { marker: { type: 'string' }, why: { type: 'string' }, fix: { type: 'string' }, source: { type: 'string' } } } } } }
const AUDIT_SCHEMA = { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: { type: 'object', required: ['file', 'locator', 'heading', 'subtext', 'action', 'replacement', 'reason'], properties: { file: { type: 'string' }, locator: { type: 'string' }, heading: { type: 'string' }, subtext: { type: 'string' }, action: { type: 'string', enum: ['keep', 'cut', 'shorten', 'merge'] }, replacement: { type: 'string' }, reason: { type: 'string' } } } } } }
const FINAL_SCHEMA = { type: 'object', required: ['summary', 'changes'], properties: { summary: { type: 'string' }, changes: { type: 'array', items: { type: 'object', required: ['file', 'locator', 'current', 'action', 'replacement', 'priority'], properties: { file: { type: 'string' }, locator: { type: 'string' }, current: { type: 'string' }, action: { type: 'string' }, replacement: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] } } } } } }

const GROUPS = [
  { tag: 'home', files: ['index.html', 'css/style.css(只看 .hero/.module-card 區)', 'history.html', 'js/history.js', 'review.html', 'js/review.js', 'analysis.html', 'js/analysis.js'] },
  { tag: 'learn1', files: ['vocab.html', 'js/vocab.js', 'listening.html', 'js/ear.js'] },
  { tag: 'learn2', files: ['reading.html', 'js/reading.js', 'grammar.html', 'js/grammar.js', 'writing.html', 'js/writing.js'] },
  { tag: 'test', files: ['practice.html', 'js/practice.js', 'mock.html', 'js/mock.js', 'diagnostic.html', 'js/diagnostic.js'] },
]

phase('Research')
const research = await agent(`用 WebSearch 查 6-10 篇談「AI 生成/AI 味網站長什麼樣、為什麼一眼看出是 AI 做的、怎麼避免」的文章(英文中文都可,例如 "AI generated website look", "why AI websites look the same", "generic SaaS landing page tells", "AI slop web design"),整理出 10-15 個【具體、可在頁面上檢查】的特徵,每條給:marker(特徵)、why(為何顯得 AI)、fix(具體改法)、source(網址)。特別關注:每個標題底下都有一句副標/說明文、卡片格三欄同構、eyebrow 小標+大標+副標三件套、口號式對仗、冒號小標、emoji、漸層與紫色、「為什麼選擇我們」段落、每段長度一致、通用形容詞(全面/專業/高效)。\n${PREF}`, { label: 'research', phase: 'Research', schema: RESEARCH_SCHEMA, effort: 'high' })

phase('Audit')
const audits = await parallel(GROUPS.map(g => () => agent(`你在審查「刷刷英文」(多益/英文練習網站,純前端)的頁面文字是否有 AI 味。專案在 ${REPO}。請 Read 這些檔案:${g.files.join('、')}(js 檔請找 renderHome/首頁/卡片/page-head/exercise-head/result-note/band-note/modal-sub 等產生標題與說明文的地方)。\n\n把【每一個】標題(h1/h2/h3/卡片標題)底下的說明文字、副標、提示句、result-note 全部列出來,逐條決定 action:keep(真的有功能性資訊,例如題數/時間/規則)、cut(刪掉不影響理解)、shorten(留必要資訊,給 replacement)、merge(併進標題或按鈕文字)。原則:說明文能刪就刪;規則性資訊留最短一句;不要「這裡是…」「你可以…」式導覽句;不要重複標題已說的事;不要形容詞堆疊。\n\n研究得到的 AI 感特徵:\n${JSON.stringify(research.markers, null, 1)}\n${PREF}\n\n回傳 findings:[{file, locator(能定位的字串,例如原文前 20 字或函式名), heading, subtext(原文), action, replacement(cut 時給空字串), reason}]。務必完整,不要只挑幾個。`, { label: 'audit:' + g.tag, phase: 'Audit', schema: AUDIT_SCHEMA, effort: 'high' })))

phase('Consolidate')
const all = audits.filter(Boolean).flatMap(a => a.findings || [])
const final = await agent(`把以下逐頁盤點結果整理成可執行的修改清單。只保留 action 為 cut/shorten/merge 的項目;同一頁同類的合併;每項給 priority(high=首頁與各區首頁一眼可見的副標/說明;medium=功能頁內;low=細節)。summary 用 5 句以內說明整體 AI 感來源與改法方向。\n${PREF}\n盤點結果:\n${JSON.stringify(all, null, 1)}\n回傳 {summary, changes:[{file, locator, current, action, replacement, priority}]}`, { label: 'consolidate', phase: 'Consolidate', schema: FINAL_SCHEMA, effort: 'high' })

return { markers: research.markers, summary: final.summary, changes: final.changes, rawCount: all.length }
