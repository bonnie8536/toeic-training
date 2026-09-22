export const meta = {
  name: 'grammar-verify-c',
  description: '補審文法第三章(過去與完成時態)',
  phases: [{ title: '審查', detail: '1 位審查員' }],
}

const ROOT = 'C:\\Users\\bonni\\Desktop\\claude\\toeic-training'

const prompt = `你是獨立審查員(英語教學專家,不可信任編寫者)。審查 ${ROOT}\\data\\raw\\grammar_chC.json(文法課第三章「過去與完成時態」12 單元,id gc-01~gc-12:was/were、過去簡單規則與不規則、過去否定疑問、過去進行、過去簡單vs過去進行、used to、現在完成結構、just/already/yet、ever/never、for/since、現在完成vs過去簡單)。
【注意】上一位審查員中途斷線,檔案可能被改到一半——先 python json.loads 確認可解析,若壞掉先修好結構再審。
【規格】每單元 {"id","title","goal","lesson":[{"t":"p|ex|table|tip",...}],"quiz":[8題,{"q","options"(4),"answer"(0-based),"explanation"}]};ex 的 focus 需原樣出現在 en。
【風格】零基礎白話家教口吻;可用術語=第一二章(名詞/冠詞/代名詞/be動詞/一般動詞/現在簡單式/現在進行式/第三人稱單數/頻率副詞/動詞原形)+本章(過去簡單式/過去進行式/現在完成式/過去分詞);不可用未教術語(形容詞/副詞/被動語態/子句等第六章以後才教);台灣繁中、禁 emoji/排比/冒號小標/簡體/大陸用語;內容原創,發現疑似教科書名句就改寫。
審查程序:
1. python 驗證:JSON、id 連號、欄位齊全、區塊型別、table 欄數、focus、options 4 個、answer 0-3、每單元 7-9 題。
2. 文法正確性逐條核對:規則陳述精確性(不規則動詞表、-ed 發音三種、for/since 判準、完成式與明確過去時間不共存等)、例句正確自然、中譯時態相符。錯誤直接改檔。
3. 循序:超前術語掃描;例句字彙難度。
4. quiz 96 題全部盲解(先遮 answer):兩解/無解直接修;干擾項須為真實學習者錯誤;整檔答案分布均勻無規律。
5. 風格掃描。6. 改完 json.loads 複驗。
直接編輯檔案修正,回報:單元數/總題數/修正幾處/每處一行。`

phase('審查')
const r = await agent(prompt, { label: 'ver:C', phase: '審查', model: 'opus' })
  .then(x => x || agent(prompt, { label: 'ver:C:retry', phase: '審查', model: 'opus' }))
return { report: r }