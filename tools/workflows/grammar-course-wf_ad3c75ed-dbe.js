export const meta = {
  name: 'grammar-course',
  description: '文法基礎課程:四階 41 單元從零到多益,產審分離',
  phases: [
    { title: '編寫', detail: '四階課程內容' },
    { title: '審查', detail: '文法正確性+盲解+風格' },
  ],
}

const ROOT = 'C:\\Users\\bonni\\Desktop\\claude\\toeic-training'

const SCHEMA = `【單元 JSON 規格】檔案=陣列,每單元:
{"id":"g1-01","title":"單元標題(格式:主題:一句白話,如「名詞:人、事、物的名字」)","goal":"一句話說學完會什麼",
 "lesson":[
   {"t":"p","text":"白話講解段落"},
   {"t":"ex","en":"例句","zh":"中譯","focus":"要標黃的字(必須原樣出現在 en 裡,可省略)"},
   {"t":"table","header":["欄1","欄2"],"rows":[["值","值"]]},
   {"t":"tip","text":"一句話的小提醒(常見錯誤或口訣)"}
 ],
 "quiz":[{"q":"題目(可含 ___ 空格)","options":[4個字串],"answer":0到3(0-based!answer:0=第一個選項),"explanation":"台灣繁中解析"}]}
lesson 5-10 個區塊,例句至少 3 個(講解-例句交錯,不要全部講解堆一起再全部例句);適合時用 table(如動詞變化表)與 tip。quiz 每單元 4-6 題。`

const STYLE = `【寫作風格鐵則(違反=退件)】
- 對象是完全零基礎的人:白話、像家教面對面講話,不像課本。每個術語第一次出現要用生活例子講懂。
- 循序漸進:不可使用還沒教到的術語(教名詞時不能說「子句」「詞性變化」)。你會拿到「已教清單」。
- 台灣英語教學慣用術語:現在簡單式/過去簡單式/現在進行式/第三人稱單數/助動詞/不定詞/動名詞/關係代名詞/被動語態。禁自創術語。
- 禁 emoji、禁排比對仗文案、禁「冒號小標」式條列(她的網站全站去 AI 味標準);tip 是自然的一句話不是格言。
- 例句用字:第一二階限最基礎 500 常用字(family/eat/happy 等級);第三四階可用多益核心字。例句內容生活化。
- 中文一律台灣繁體與台灣用語,禁簡體字、禁大陸用語(視頻/信息/軟件/質量)。
- quiz 干擾項=台灣學習者真實會犯的錯(三單漏 s、a/an 搞混、be 動詞和一般動詞並用「He is play」),不是隨機湊。
- answer 0-based;整檔答案分布均勻無規律。
- 檔案 UTF-8,寫完自己 python json.loads 驗證。`

function gen(prompt, label) {
  return agent(prompt, { label, phase: '編寫', model: 'opus' })
    .then(r => r || agent(prompt, { label: label + ':retry', phase: '編寫', model: 'opus' }))
}
function ver(prompt, label) {
  return agent(prompt, { label, phase: '審查', model: 'opus' })
    .then(r => r || agent(prompt, { label: label + ':retry', phase: '審查', model: 'opus' }))
}

const STAGES = [
  {
    key: 's1', file: 'grammar_s1.json',
    outline: `第一階「句子的零件」10 單元(id g1-01~g1-10),已教清單=無(全部從零):
g1-01 名詞:人、事、物的名字(含複數 s 的概念)
g1-02 代名詞:I、you、he、she、it、we、they(含受格 me/him/her 簡介)
g1-03 be 動詞:am、is、are(含 I'm/it's 縮寫)
g1-04 一般動詞:表示動作的字(eat/go/like)
g1-05 形容詞:描述樣子的字(放名詞前、放 be 動詞後)
g1-06 副詞:描述怎麼做(slowly/well/very)
g1-07 冠詞:a、an、the 什麼時候用哪個
g1-08 介系詞:in、on、at(地點與時間各自的慣用)
g1-09 句子的骨架:主詞+動詞(什麼是完整的句子)
g1-10 加上受詞:主詞+動詞+受詞(I like coffee 的結構)`,
  },
  {
    key: 's2', file: 'grammar_s2.json',
    outline: `第二階「把句子變化」11 單元(id g2-01~g2-11),已教清單=第一階全部(名詞/代名詞/be動詞/一般動詞/形容詞/副詞/冠詞/介系詞/主詞受詞):
g2-01 現在簡單式:講習慣和事實
g2-02 第三人稱單數:動詞加 s 的規則(含 es/ies)
g2-03 否定句:don't 和 doesn't
g2-04 Yes/No 疑問句:Do 和 Does 開頭
g2-05 現在進行式:be+V-ing 講「正在」
g2-06 過去簡單式:規則變化 -ed(含發音三種)
g2-07 過去簡單式:常見不規則動詞(go-went 等 12 個高頻)
g2-08 was 和 were:be 動詞的過去
g2-09 未來:will 和 be going to 的差別
g2-10 WH 疑問句:what/where/when/who/why/how
g2-11 祈使句與 Let's:叫人做事和提議`,
  },
  {
    key: 's3', file: 'grammar_s3.json',
    outline: `第三階「加長句子」10 單元(id g3-01~g3-10),已教清單=前兩階全部(詞性/句子骨架/各時態/否定疑問):
g3-01 and、but、or:把兩件事接起來
g3-02 because 和 so:講原因和結果
g3-03 when 和 if:講時間和條件
g3-04 不定詞:to+動詞(want to go 的結構)
g3-05 動名詞:V-ing 當名詞用(enjoy reading)
g3-06 助動詞:can、should、must
g3-07 頻率副詞:always 到 never(位置擺哪裡)
g3-08 there is、there are:講「有」
g3-09 比較級:-er 和 more
g3-10 最高級:-est 和 most`,
  },
  {
    key: 's4', file: 'grammar_s4.json',
    outline: `第四階「接軌多益」10 單元(id g4-01~g4-10),已教清單=前三階全部;這一階可自然銜接多益 Part 5 考點,例句可用多益商業情境(會議/訂單/出差):
g4-01 現在完成式:have+過去分詞(經驗與到現在為止)
g4-02 被動語態:be+過去分詞(多益最愛)
g4-03 關係代名詞:who、which、that
g4-04 分詞當形容詞:interesting 和 interested 的差別
g4-05 名詞子句:I think that...
g4-06 間接問句:Could you tell me where...(語序不倒裝)
g4-07 連接詞對介系詞:although 對 despite(多益高頻考點)
g4-08 詞性變化:看字尾判斷詞性(-tion/-ful/-ly/-ment)
g4-09 時態綜合:看時間副詞選時態(yesterday/already/next week)
g4-10 假設語氣入門:If I were you`,
  },
]

const verPrompt = (st) => `你是獨立審查員(英語教學專家,不可信任編寫者)。審查 ${ROOT}\\data\\raw\\${st.file}(文法課程單元,規格與大綱如下)。
${st.outline}
${SCHEMA}
${STYLE}
審查程序:
1. python 驗證:JSON 可解析、id 連號、欄位齊全、lesson 區塊類型合法(p/ex/table/tip)、table 欄數一致、ex 的 focus 原樣出現在 en、quiz options 恰 4 個、answer 0-3。
2. 文法正確性逐條核對(最重要):講解的每一句規則陳述是否精確?(如 a/an 依「發音」非字母、不可數名詞不加 a、三單 es 規則、不規則動詞表正確性、was/were 對應、比較級雙寫規則)。例句是否文法正確且自然?發現錯誤直接改檔。
3. 循序檢查:是否用到「已教清單」以外的術語?例句是否用到超出該階的字彙難度?
4. quiz 盲解:先遮 answer 自己作答再比對;兩解/無解/超綱直接修;干擾項是否為真實學習者錯誤;整檔答案分布均勻無規律。
5. 風格:AI 味掃描(emoji/排比/冒號小標)、簡體字、大陸用語、術語是否用台灣慣用。
6. 改完 python json.loads 再驗一次。
直接編輯檔案修正,回報:單元數/修正幾處/每處一行。`

phase('編寫')
const results = await pipeline(
  STAGES,
  st => gen(`你是把零基礎學生教到會的英文家教,現在把你的教法寫成自學教材。在 ${ROOT}\\data\\raw\\ 新建 ${st.file}(UTF-8)。
${st.outline}
${SCHEMA}
${STYLE}
每單元的講解要能讓「完全沒學過英文的人」自己讀懂:先用中文的語感類比開場(如:中文說「我吃飯」,英文也是「誰+做什麼」的順序),再給規則,馬上例句,每個新概念都有例句對照。
寫完 python json.loads 驗證+統計各單元題數。回報:單元清單+總題數。`, 'gen:' + st.key),
  (genReport, st) => ver(verPrompt(st), 'ver:' + st.key).then(v => ({ key: st.key, report: v })),
)

return { results: results.filter(Boolean) }