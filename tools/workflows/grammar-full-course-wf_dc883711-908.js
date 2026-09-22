export const meta = {
  name: 'grammar-full-course',
  description: '文法課全面擴編:劍橋式八章 94 單元,每單元 8 題,產審分離',
  phases: [
    { title: '編寫', detail: '八章各一位命題老師' },
    { title: '審查', detail: '文法正確性+全題盲解' },
  ],
}

const ROOT = 'C:\\Users\\bonni\\Desktop\\claude\\toeic-training'

const SCHEMA = `【單元 JSON 規格】檔案=陣列,每單元:
{"id":"ga-01","title":"單元標題(格式:主題:一句白話)","goal":"一句話說學完會什麼",
 "lesson":[
   {"t":"p","text":"白話講解段落"},
   {"t":"ex","en":"例句","zh":"中譯","focus":"要標黃的字(必須原樣出現在 en 裡,可省略)"},
   {"t":"table","header":["欄1","欄2"],"rows":[["值","值"]]},
   {"t":"tip","text":"一句話小提醒(常見錯誤)"}
 ],
 "quiz":[{"q":"題目(可含 ___ 空格)","options":[4個字串],"answer":0到3(0-based!),"explanation":"台灣繁中解析,要講到為什麼錯的選項錯"}]}
lesson 6-10 個區塊,例句至少 4 個(講解-例句交錯);規則有變化形的一定給 table。quiz 每單元 8 題(7-9 可接受):前面 4-5 題直接考當課規則,後面 3-4 題進階(易混情境對比、跟前面單元的觀念對照)。`

const STYLE = `【寫作風格鐵則(違反=退件)】
- 這是完整的文法自學課,不是考試衝刺班:講解要「詳細」——規則講完要講「為什麼」或「跟中文哪裡不一樣」,常見誤區點名。
- 編排精神參考劍橋 Grammar in Use 系列:一單元只講一個文法點、講解配足量練習、由淺入深。**內容必須全部原創,禁止抄襲任何教科書的句子或例子**。
- 對象從零基礎讀起:白話、像家教面對面講話。術語第一次出現要用生活例子講懂;不可使用你的章節還沒教到、也不在「可用術語」清單的術語。
- 台灣英語教學慣用術語(現在簡單式/第三人稱單數/助動詞/不定詞/動名詞/關係代名詞/被動語態/附加問句)。禁自創術語。
- 禁 emoji、禁排比對仗、禁冒號小標式文案;tip 是自然的一句話。
- 例句生活化,前四章限基礎常用字,後四章可用一般高頻字;中文一律台灣繁體與台灣用語。
- quiz 干擾項=台灣學習者真實錯誤(三單漏 s、He is play、much/many 錯配、假設語氣用錯時態)。
- answer 0-based;整檔答案分布均勻無規律。
- 舊教材在 ${ROOT}\\data\\raw\\grammar_s1.json ~ grammar_s4.json(已審查過的 41 個單元):先讀,凡與你的單元主題重疊的,吸收它的講解與題目再擴充(改成新 id、題數補到 8),不要從頭亂寫;不重疊的主題才全新寫。
- 檔案 UTF-8。**檔案很大,分兩次寫**:先 Write 前半單元(合法 JSON 陣列),再 Read 回來用 Write 寫完整版;最後 python json.loads 驗證。`

function gen(prompt, label) {
  return agent(prompt, { label, phase: '編寫', model: 'opus' })
    .then(r => r || agent(prompt, { label: label + ':retry', phase: '編寫', model: 'opus' }))
}
function ver(prompt, label) {
  return agent(prompt, { label, phase: '審查', model: 'opus' })
    .then(r => r || agent(prompt, { label: label + ':retry', phase: '審查', model: 'opus' }))
}

const CHAPTERS = [
  { key: 'A', file: 'grammar_chA.json', outline: `第一章「名詞、冠詞與代名詞」12 單元(id ga-01~ga-12)。可用術語:名詞/代名詞/冠詞/單數複數/可數不可數/所有格。
ga-01 名詞與複數:s、es、ies 和常見不規則(man-men 等)
ga-02 可數與不可數:water 為什麼不能加 a
ga-03 a 和 an:看發音不是看字母
ga-04 the:講到「那一個」的時候
ga-05 不加冠詞的時候:通稱與專有名詞
ga-06 some 和 any:肯定句、否定句、問句
ga-07 much、many、a lot of
ga-08 little、few 和 a little、a few
ga-09 代名詞:主格與受格(I-me、he-him)
ga-10 所有格:my/mine 和名詞加 's
ga-11 this、that、these、those
ga-12 something、anyone、nothing 那一家人` },
  { key: 'B', file: 'grammar_chB.json', outline: `第二章「be 動詞與現在時態」11 單元(id gb-01~gb-11)。可用術語:第一章全部+be 動詞/一般動詞/主詞/受詞/動詞原形/現在簡單式/現在進行式/第三人稱單數/頻率副詞。
gb-01 am、is、are:配對規則與縮寫
gb-02 be 動詞的否定與疑問
gb-03 there is、there are:講「有」
gb-04 現在簡單式:習慣與事實
gb-05 第三人稱單數:加 s 的規則(s/es/ies)
gb-06 現在簡單式否定:don't、doesn't
gb-07 現在簡單式疑問:Do、Does
gb-08 現在進行式:be+V-ing(含 ing 拼字規則)
gb-09 現在簡單 vs 現在進行:習慣還是現在正在
gb-10 狀態動詞:like、know、want 為什麼不用進行式
gb-11 頻率副詞:always 到 never,擺在哪裡` },
  { key: 'C', file: 'grammar_chC.json', outline: `第三章「過去與完成時態」12 單元(id gc-01~gc-12)。可用術語:前兩章全部+過去簡單式/過去進行式/現在完成式/過去分詞。
gc-01 was、were
gc-02 過去簡單式:規則動詞 -ed(含發音三種)
gc-03 過去簡單式:高頻不規則動詞
gc-04 過去簡單式的否定與疑問:didn't、Did
gc-05 過去進行式:was/were+V-ing
gc-06 過去簡單 vs 過去進行:講完的事 vs 當時正在
gc-07 used to:以前會、現在不會了
gc-08 現在完成式:have+過去分詞的結構
gc-09 現在完成式:just、already、yet
gc-10 現在完成式:ever、never 講經驗
gc-11 for 和 since:持續多久 vs 從何時起
gc-12 現在完成 vs 過去簡單:有沒有講「什麼時候」` },
  { key: 'D', file: 'grammar_chD.json', outline: `第四章「未來與助動詞」12 單元(id gd-01~gd-12)。可用術語:前三章全部+助動詞。
gd-01 be going to:打算好的事
gd-02 will:當場決定與預測
gd-03 will vs be going to
gd-04 現在進行式表未來:約好的事
gd-05 can、could:能力與客氣的請求
gd-06 may、might:可能發生
gd-07 must 和 have to:必須
gd-08 mustn't vs don't have to:不可以 vs 不必
gd-09 should:建議
gd-10 would like:想要的客氣說法(跟 like 的差別)
gd-11 Shall we、Let's:提議
gd-12 助動詞總整理:一張表看差別(強度與情境)` },
  { key: 'E', file: 'grammar_chE.json', outline: `第五章「疑問、否定與祈使」10 單元(id ge-01~ge-10)。可用術語:前四章全部+附加問句/間接問句/祈使句。
ge-01 Yes/No 問句總整理:be、Do、助動詞三家
ge-02 WH 疑問詞:what/where/when/who/why/how
ge-03 who 當主詞的問句:為什麼不加 do
ge-04 疑問詞組合:How long、How often、What kind of
ge-05 附加問句:..., isn't it?
ge-06 間接問句:Could you tell me where...(不倒裝)
ge-07 否定句總整理:not 放哪裡
ge-08 祈使句:叫人做事與禮貌版
ge-09 too、either 和 So do I、Neither do I:我也是
ge-10 感嘆句:What a...!、How...!` },
  { key: 'F', file: 'grammar_chF.json', outline: `第六章「形容詞、副詞與比較」11 單元(id gf-01~gf-11)。可用術語:前五章全部+形容詞/副詞/比較級/最高級。
gf-01 形容詞的位置:名詞前、be 動詞後
gf-02 -ed 和 -ing 形容詞:bored vs boring
gf-03 副詞的構成與位置:-ly 與例外
gf-04 形容詞還是副詞:good/well、fast/hard
gf-05 比較級:-er 和 more(含拼字規則)
gf-06 最高級:-est 和 most
gf-07 as...as:一樣的比法
gf-08 too 和 enough:太…與夠…(位置相反)
gf-09 so 和 such:so tired、such a long day
gf-10 比較慣用:the same as、different from、like
gf-11 形容詞排序:a nice small leather bag` },
  { key: 'G', file: 'grammar_chG.json', outline: `第七章「介系詞、連接詞與子句」13 單元(id gg-01~gg-13)。可用術語:前六章全部+介系詞/連接詞/不定詞/動名詞/子句/條件句。
gg-01 時間介系詞:in、on、at
gg-02 地點介系詞:in、on、at
gg-03 方向與位置:to/from/under/next to/between
gg-04 by、with、about、for 的常見用法
gg-05 介系詞後面接 V-ing:good at cooking
gg-06 動詞+介系詞固定搭配:listen to、wait for
gg-07 形容詞+介系詞:afraid of、good at
gg-08 and、but、or、so、because
gg-09 when、while、before、after、until
gg-10 if 條件句:第 0 型與第 1 型
gg-11 不定詞 to V:want、plan、decide
gg-12 動名詞 V-ing:enjoy、finish、mind
gg-13 兩個都可以但意思不同:stop、remember、try` },
  { key: 'H', file: 'grammar_chH.json', outline: `第八章「進階句型」13 單元(id gh-01~gh-13)。可用術語:前七章全部+被動語態/關係代名詞/假設語氣/名詞子句/使役動詞。
gh-01 被動語態:現在與過去(be+過去分詞)
gh-02 被動語態:各時態與 by 的取捨
gh-03 關係代名詞:who、which、that
gh-04 關係代名詞當受詞可以省略
gh-05 whose、where、when 的關係用法
gh-06 名詞子句 that:I think (that)...
gh-07 say 和 tell:間接引述入門
gh-08 第二型條件句:If I had more time...
gh-09 第三型條件句:If I had known...
gh-10 wish:真希望…
gh-11 使役動詞:make、let、have
gh-12 感官動詞:see、hear 接 V 或 V-ing
gh-13 it 開頭句型:It takes...、It's important to...` },
]

const verPrompt = (ch) => `你是獨立審查員(英語教學專家,不可信任編寫者)。審查 ${ROOT}\\data\\raw\\${ch.file}(文法課單元,大綱如下)。
${ch.outline}
${SCHEMA}
${STYLE}
審查程序:
1. python 驗證:JSON 可解析、id 連號、欄位齊全、lesson 區塊型別合法(p/ex/table/tip)、table 欄數一致、ex 的 focus 原樣出現在 en、quiz options 恰 4 個、answer 0-3、每單元 7-9 題。
2. 文法正確性逐條核對(最重要):每一句規則陳述是否精確、例句是否文法正確且自然、表格(動詞變化/比較級拼字)是否無誤。發現錯誤直接改檔。
3. 循序檢查:是否用到該章「可用術語」以外的術語;例句字彙是否符合該章難度。
4. quiz 全部盲解:先遮 answer 逐題自己作答再比對;兩解/無解直接修;干擾項是否為真實學習者錯誤;整檔答案分布均勻無規律(不可循環)。
5. 風格:AI 味(emoji/排比/冒號小標)、簡體字、大陸用語掃描;是否有抄襲既有教科書知名例句之虞(有印象的句子就改寫)。
6. 改完 python json.loads 再驗一次。
直接編輯檔案修正,回報:單元數/總題數/修正幾處/每處一行。`

phase('編寫')
const results = await pipeline(
  CHAPTERS,
  ch => gen(`你是把零基礎學生一路教到高階的英文家教,現在把教法寫成完整自學教材。在 ${ROOT}\\data\\raw\\ 新建 ${ch.file}(UTF-8)。
${ch.outline}
${SCHEMA}
${STYLE}
講解開場優先用中文語感對比(中文怎麼說、英文差在哪),規則後馬上例句;「vs 對比型」單元一定要有對照表格或成對例句。
寫完 python 驗證 json.loads+統計單元數與題數。回報:單元清單+總題數。`, 'gen:' + ch.key),
  (genReport, ch) => ver(verPrompt(ch), 'ver:' + ch.key).then(v => ({ key: ch.key, report: v })),
)

return { results: results.filter(Boolean) }