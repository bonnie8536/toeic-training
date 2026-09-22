export const meta = {
  name: 'p1-expand-art-prompts',
  description: 'P1 照片題+13/文章配圖提示詞 40 筆,產審分離',
  phases: [
    { title: '編寫', detail: 'P1 題目與圖片提示詞' },
    { title: '審查', detail: '盲解+提示詞可拍性' },
  ],
}

const ROOT = 'C:\\Users\\bonni\\Desktop\\claude\\toeic-training'
const SCRATCH = 'C:\\Users\\bonni\\AppData\\Local\\Temp\\claude\\C--\\27c708fc-37e1-4274-ad2f-027fb7f1c0da\\scratchpad'

function gen(prompt, label) {
  return agent(prompt, { label, phase: '編寫', model: 'opus' })
    .then(r => r || agent(prompt, { label: label + ':retry', phase: '編寫', model: 'opus' }))
}
function ver(prompt, label) {
  return agent(prompt, { label, phase: '審查', model: 'opus' })
    .then(r => r || agent(prompt, { label: label + ':retry', phase: '審查', model: 'opus' }))
}

const JOBS = [
  {
    key: 'p1',
    gen: `任務:擴充聽力 Part 1 照片描述題。先讀 ${ROOT}\\data\\raw\\listening_p1.json(既有 12 題,格式照抄:id/difficulty/photoPrompt/photoAlt/options(4)/answer(0-based)/explanation/transcriptZh),新建 ${ROOT}\\data\\raw\\listening_p1_b2.json:陣列 13 題,id "l1-13"~"l1-25"。
場景避開既有 12 題(影印機/上餐/講電話/文件櫃/會議室/掃地/超市/機場/腳踏車/行李員/梯子/漁港),新場景輪替:倉庫堆貨/咖啡師做飲料/園丁澆花/工地(安全帽+圖紙)/圖書館上架/診所候診室(空)/加油/洗車/搬家搬箱/麵包店陳列/公車站候車/辦公室白板前討論/市場攤位擺蔬果。
命題規格(照正式 P1 出法):四個選項都是簡短現在式描述句(is V-ing / are p.p.),正解描述照片主要動作/狀態,干擾項=「相似動作但對象錯」「照片沒有的東西」「狀態說反」;photoPrompt=英文攝影指令(photorealistic candid documentary,構圖必須讓正解可辨識、干擾項明確不成立,no text or logos);photoAlt=中文一句話描述照片;難度 基礎5/中級5/進階3。
【詞彙鐵則】選項與 transcript 限多益核心詞彙;中文=台灣繁體。answer 分布均勻無規律。UTF-8,寫完 python json.loads 驗證。
回報:13 題場景+answer 序列。`,
    verify: `你是獨立審查員。審查 ${ROOT}\\data\\raw\\listening_p1_b2.json(13 題 P1,l1-13~l1-25)。程序:
1. python 驗證:JSON、id 連號、欄位齊全(對照 listening_p1.json 的鍵)、options 恰 4、answer 0-3。
2. 逐題盲解:只看 photoPrompt 想像照片,再判斷四個選項——正解必須唯一且照片可證,干擾項必須「照片明確不成立」(不能是照片裡可能存在的);photoPrompt 是否會生出讓干擾項變成立的元素(如干擾項說 no people 但 prompt 沒排除路人)。矛盾直接改檔(改 prompt 或改選項)。
3. 場景與既有 12 題查重;answer 分布無規律;超綱字;簡體字/大陸用語。
4. photoAlt 與 photoPrompt 相符。
直接改檔修正,回報:修正幾處/每處一行。`,
  },
  {
    key: 'artimg',
    gen: `任務:為閱讀文章產生配圖提示詞。讀 ${ROOT}\\data\\raw\\articles_*.json 全部檔案(40 篇,每篇有 id/title/titleZh/category/level/paragraphs),為每篇寫一個 GPT 生圖提示詞,輸出 ${SCRATCH}\\article_img_prompts.json:陣列 40 筆 {"id":"art-XX","title":"英文標題","prompt":"英文攝影指令"}。
提示詞規格:photorealistic documentary/editorial photograph,對應文章主題的「一個具體場景」(讀 title+第一段抓主題;敘事型抓故事關鍵場景,新聞科普型抓主題意象),landscape 3:2,natural light,candid style,**no text, no logos, no readable signage**;不可出現可辨識真實品牌/人物;科普主題用中性意象(如晶片文章=電路板特寫)。每筆 60-90 個英文字,細節具體(誰/在哪/做什麼/光線)。
寫完 python json.loads 驗證+確認 40 筆 id 與 articles 檔一一對應。回報:40 筆主題摘要清單。`,
    verify: `你是獨立審查員。審查 ${SCRATCH}\\article_img_prompts.json(40 筆文章配圖提示詞)。程序:
1. python 驗證:JSON、40 筆、id 與 ${ROOT}\\data\\raw\\articles_*.json 的文章 id 一一對應無缺漏。
2. 逐筆:提示詞是否對應該文章主題(抽讀文章 title+首段核對);是否含 no text/no logos 約束;是否可能生出可辨識真實品牌、名人、敏感內容;科普篇意象是否中性不誤導;照片風格是否統一(documentary/editorial)。
3. 不符者直接改檔。回報:修正幾筆/每筆一行。`,
  },
]

phase('編寫')
const results = await pipeline(
  JOBS,
  j => gen(j.gen, 'gen:' + j.key),
  (genReport, j) => ver(j.verify, 'ver:' + j.key).then(v => ({ key: j.key, report: v })),
)
return { results: results.filter(Boolean) }