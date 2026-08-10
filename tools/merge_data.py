# -*- coding: utf-8 -*-
"""合併 data/raw/*.json → data/*.js,並做機械驗證。
用法: python tools/merge_data.py
硬錯誤(缺欄位/JSON 壞/對應不上)會列出並以 exit code 1 結束;警告不擋。
"""
import json, re, sys, glob, os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw')
OUT = os.path.join(ROOT, 'data')

errors, warnings = [], []

# 簡體字表(只收簡體獨有字形;家/里/台/干/雇/徽/凰 等正體共用字已剔除)
SIMP = set('们这来对时会为动经发说读应见观让问长张历传贝钱务车软网络备则风飞马鸟条页题词语单证据认识议论记设访许诉调贵资费购贸办协组织级红给约统继续维绿练线细终结绝丝营处变态压厂厉励医卫战胜败财货质销锁错钟镜关闭闻阅际陈险随隐邮乡邓凤刘剑势劲区华卖贴赛赶趋达运还进远违连迟适选逊递逻遗释针钓铁银门闲间闷闹阶阳阴陆隶难双叙号叶吓吗吨听启员呜咨响哑哟唤啸国园圆图团坏块坚垫报场壶复够头夹夺奋妆娄娱婶学孙宁宝实审宫寻导层属岁岗岛币师带帮并广庄库庙开异弃弹归当录彻径忆怀总恒恼悬惊惯愿'
           )
# 大陸用語(以正體字形出現也要抓)
CN_WORDS = ['視頻', '質量', '信息', '網絡', '軟件', '硬件', '默認', '打印', '登錄', '用戶體驗差']

def read_json(path):
    with open(path, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def scan_simplified(obj, where):
    text = json.dumps(obj, ensure_ascii=False)
    hits = sorted(set(c for c in text if c in SIMP))
    if hits:
        warnings.append(f'{where}: 疑似簡體字 {" ".join(hits)}')
    for w in CN_WORDS:
        if w in text:
            warnings.append(f'{where}: 大陸用語「{w}」')

def need(obj, fields, where):
    ok = True
    for f in fields:
        if f not in obj or obj[f] in (None, '', []):
            errors.append(f'{where}: 缺欄位 {f}')
            ok = False
    return ok

def check_options(q, where):
    if not isinstance(q.get('options'), list) or len(q['options']) != 4:
        errors.append(f'{where}: options 需為 4 個'); return
    if not isinstance(q.get('answer'), int) or not (0 <= q['answer'] <= 3):
        errors.append(f'{where}: answer 需為 0-3 整數')

def load_kind(pattern, kind):
    items = []
    files = sorted(glob.glob(os.path.join(RAW, pattern)))
    if not files:
        warnings.append(f'{kind}: 找不到 {pattern}')
    for path in files:
        name = os.path.basename(path)
        try:
            data = read_json(path)
        except Exception as e:
            errors.append(f'{name}: JSON 解析失敗 — {e}')
            continue
        if not isinstance(data, list):
            errors.append(f'{name}: 頂層需為陣列'); continue
        items.extend(data)
    return items

# ---------- Part 5 ----------
p5 = load_kind('part5_b*.json', 'part5')
dist5 = Counter()
for q in p5:
    w = f"part5 {q.get('id','?')}"
    if need(q, ['id','difficulty','category','question','options','translation','explanation'], w):
        check_options(q, w)
        if '-------' not in q['question']:
            errors.append(f'{w}: question 缺 ------- 空格標記')
        dist5[q.get('answer')] += 1
    scan_simplified(q, w)

# ---------- Part 6 ----------
p6 = load_kind('part6_b*.json', 'part6')
p6_qs = 0
for s in p6:
    w = f"part6 {s.get('id','?')}"
    if need(s, ['id','passageType','title','passage','questions','translation'], w):
        nums = sorted(re.findall(r'\{\{(\d)\}\}', s['passage']))
        qnums = sorted(str(q.get('num')) for q in s['questions'])
        if nums != qnums:
            errors.append(f'{w}: 空格標記 {nums} 與題號 {qnums} 不一致')
        for q in s['questions']:
            p6_qs += 1
            check_options(q, f"{w} 第{q.get('num','?')}格")
    scan_simplified(s, w)

# ---------- Part 7 ----------
p7 = load_kind('part7_b*.json', 'part7')
p7_qs = 0
for s in p7:
    w = f"part7 {s.get('id','?')}"
    if need(s, ['id','format','passages','questions','translation'], w):
        np_, nt = len(s['passages']), len(s['translation'])
        if np_ != nt:
            errors.append(f'{w}: passages({np_}) 與 translation({nt}) 數量不符')
        if s['format'] == 'double' and np_ != 2:
            errors.append(f'{w}: double 需 2 篇,實得 {np_}')
        for p_ in s['passages']:
            need(p_, ['type','content'], f'{w} passage')
        for qi, q in enumerate(s['questions']):
            p7_qs += 1
            need(q, ['q','options','explanation'], f'{w} Q{qi+1}')
            check_options(q, f'{w} Q{qi+1}')
    scan_simplified(s, w)

# ---------- 文章 ----------
arts = load_kind('articles_b*.json', 'articles')
total_vocab = 0
for a in arts:
    w = f"article {a.get('id','?')}"
    if not need(a, ['id','title','titleZh','category','level','readTime','paragraphs','vocab','questions'], w):
        continue
    marks = []
    for i, p_ in enumerate(a['paragraphs']):
        need(p_, ['en','zh'], f'{w} 段{i+1}')
        marks += re.findall(r'\[\[(.+?)\]\]', p_.get('en',''))
        if '[[' in p_.get('zh',''):
            errors.append(f'{w} 段{i+1}: zh 殘留 [[ ]] 標記')
    total_vocab += len(marks)
    vocab_words = {}
    for v in a['vocab']:
        need(v, ['word','base','pos','hint','zh'], f"{w} vocab {v.get('word','?')}")
        vocab_words[v.get('word','').lower()] = v
        hint = v.get('hint','').lower()
        for form in {v.get('word','').lower(), v.get('base','').lower()}:
            if form and re.search(r'\b' + re.escape(form) + r'\b', hint):
                warnings.append(f"{w}: hint 含單字本身 — {v.get('word')}")
    for m in marks:
        if m.lower() not in vocab_words:
            errors.append(f'{w}: 標記 [[{m}]] 在 vocab 中無對應')
    marks_lower = {m.lower() for m in marks}
    for vw in vocab_words:
        if vw not in marks_lower:
            warnings.append(f'{w}: vocab "{vw}" 未在文中標記')
    if len(a['questions']) < 5:
        warnings.append(f"{w}: 題目僅 {len(a['questions'])} 題(預期 5)")
    for qi, q in enumerate(a['questions']):
        need(q, ['q','options','explanation'], f'{w} Q{qi+1}')
        check_options(q, f'{w} Q{qi+1}')
    scan_simplified(a, w)

# ---------- 程度檢測 ----------
diag = None
dpath = os.path.join(RAW, 'diagnostic.json')
if os.path.exists(dpath):
    try:
        diag = read_json(dpath)
    except Exception as e:
        errors.append(f'diagnostic.json: JSON 解析失敗 — {e}')
    if isinstance(diag, dict):
        w = 'diagnostic'
        p5d = diag.get('p5') or []
        if len(p5d) != 20:
            warnings.append(f'{w}: p5 題數 {len(p5d)}(預期 20)')
        for q in p5d:
            wq = f"{w} {q.get('id','?')}"
            if need(q, ['id','category','difficulty','skill','question','options','translation','explanation'], wq):
                check_options(q, wq)
                if '-------' not in q['question']:
                    errors.append(f'{wq}: question 缺 ------- 空格標記')
        p6d = diag.get('p6')
        if not p6d:
            errors.append(f'{w}: 缺 p6')
        else:
            nums = sorted(re.findall(r'\{\{(\d)\}\}', p6d.get('passage','')))
            qnums = sorted(str(q.get('num')) for q in p6d.get('questions', []))
            if nums != qnums:
                errors.append(f'{w} p6: 空格 {nums} 與題號 {qnums} 不一致')
            for q in p6d.get('questions', []):
                wq = f"{w} p6 第{q.get('num','?')}格"
                need(q, ['category','difficulty','skill','options','explanation'], wq)
                check_options(q, wq)
        p7d = diag.get('p7')
        if not p7d:
            errors.append(f'{w}: 缺 p7')
        else:
            if len(p7d.get('passages', [])) != len(p7d.get('translation', [])):
                errors.append(f'{w} p7: passages 與 translation 數量不符')
            for qi, q in enumerate(p7d.get('questions', [])):
                wq = f'{w} p7 Q{qi+1}'
                need(q, ['q','category','difficulty','skill','options','explanation'], wq)
                check_options(q, wq)
        n_diag = len(p5d) + len((p6d or {}).get('questions', [])) + len((p7d or {}).get('questions', []))
        scan_simplified(diag, w)
else:
    warnings.append('diagnostic.json 尚未生成(程度檢測頁會顯示未載入)')
    n_diag = 0

# ---------- 寫作區 ----------
writing = {}
for lv in ['l1', 'l2', 'l3']:
    wpath = os.path.join(RAW, f'writing_{lv}.json')
    if not os.path.exists(wpath):
        warnings.append(f'writing_{lv}.json 尚未生成')
        continue
    try:
        wd = read_json(wpath)
    except Exception as e:
        errors.append(f'writing_{lv}.json: JSON 解析失敗 — {e}')
        continue
    w = f'writing {lv}'
    need(wd, ['title', 'lessons'], w)
    for les in wd.get('lessons', []):
        need(les, ['id', 'title', 'intro', 'points'], f"{w} {les.get('id','?')}")
        for pt in les.get('points', []):
            need(pt, ['tip', 'example', 'exampleZh'], f"{w} {les.get('id','?')} point")
    if lv == 'l1':
        for s in wd.get('scramble', []):
            ws = f"{w} {s.get('id','?')}"
            if need(s, ['id', 'zh', 'words', 'answer', 'note'], ws):
                if ' '.join(s['words']) != s['answer']:
                    errors.append(f'{ws}: words 拼接與 answer 不一致')
        for b in wd.get('build', []):
            need(b, ['id', 'scenario', 'keywords', 'models', 'checkpoints'], f"{w} {b.get('id','?')}")
        if len(wd.get('scramble', [])) < 20: warnings.append(f'{w}: 重組題僅 {len(wd.get("scramble", []))}')
        if len(wd.get('build', [])) < 12: warnings.append(f'{w}: 造句題僅 {len(wd.get("build", []))}')
    if lv == 'l2':
        for e_ in wd.get('emails', []):
            we = f"{w} {e_.get('id','?')}"
            if need(e_, ['id', 'incoming', 'tasksZh', 'checklist', 'model', 'modelNotes'], we):
                need(e_['incoming'], ['from', 'subject', 'body'], we + ' incoming')
        if len(wd.get('emails', [])) < 8: warnings.append(f'{w}: email 任務僅 {len(wd.get("emails", []))}')
    if lv == 'l3':
        for e_ in wd.get('essays', []):
            we = f"{w} {e_.get('id','?')}"
            if need(e_, ['id', 'question', 'questionZh', 'outline', 'transitions', 'model', 'modelNotes'], we):
                if len(e_['outline']) != 4:
                    errors.append(f'{we}: outline 需 4 格,實得 {len(e_["outline"])}')
        if len(wd.get('essays', [])) < 6: warnings.append(f'{w}: 論述題僅 {len(wd.get("essays", []))}')
    scan_simplified(wd, w)
    writing[lv] = wd

# ---------- 聽力 ----------
listening = {}
lp1 = load_kind('listening_p1.json', 'listening p1')
for q in lp1:
    w = f"listening {q.get('id','?')}"
    if need(q, ['id','difficulty','photoPrompt','photoAlt','options','explanation','transcriptZh'], w):
        check_options(q, w)
lp2 = load_kind('listening_p2_b*.json', 'listening p2')
for q in lp2:
    w = f"listening {q.get('id','?')}"
    if need(q, ['id','difficulty','category','accent','question','options','explanation','transcriptZh'], w):
        if not isinstance(q.get('options'), list) or len(q['options']) != 3:
            errors.append(f'{w}: P2 options 需為 3 個')
        if not isinstance(q.get('answer'), int) or not (0 <= q['answer'] <= 2):
            errors.append(f'{w}: answer 需為 0-2')
lp3 = load_kind('listening_p3_b*.json', 'listening p3')
for s in lp3:
    w = f"listening {s.get('id','?')}"
    if need(s, ['id','difficulty','title','dialogue','questions','transcriptZh'], w):
        for turn in s['dialogue']:
            if turn.get('s') not in ('M', 'W'):
                errors.append(f'{w}: dialogue s 需為 M/W')
        for qi, q in enumerate(s['questions']):
            need(q, ['q','options','explanation'], f'{w} Q{qi+1}')
            check_options(q, f'{w} Q{qi+1}')
lp4 = load_kind('listening_p4_b*.json', 'listening p4')
for s in lp4:
    w = f"listening {s.get('id','?')}"
    if need(s, ['id','difficulty','type','speaker','talk','questions','transcriptZh'], w):
        for qi, q in enumerate(s['questions']):
            need(q, ['q','options','explanation'], f'{w} Q{qi+1}')
            check_options(q, f'{w} Q{qi+1}')
for kind_name, items_ in [('listening', lp1 + lp2 + lp3 + lp4)]:
    scan_simplified(items_, kind_name)
if lp1 or lp2 or lp3 or lp4:
    listening = {'p1': lp1, 'p2': lp2, 'p3': lp3, 'p4': lp4}

# ---------- id 重複 ----------
for kind, items in [('part5', p5), ('part6', p6), ('part7', p7), ('articles', arts)]:
    ids = [x.get('id') for x in items]
    for dup, n in Counter(ids).items():
        if n > 1:
            errors.append(f'{kind}: id 重複 {dup} ×{n}')

# ---------- 輸出 ----------
def write_js(fname, varname, data):
    path = os.path.join(OUT, fname)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('window.TOEIC = window.TOEIC || {};\n')
        f.write('TOEIC.' + varname + ' = ')
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write(';\n')
    print(f'  寫出 {fname}')

print('=== 驗證結果 ===')
print(f'Part 5: {len(p5)} 題 | Part 6: {len(p6)} 組 {p6_qs} 題 | Part 7: {len(p7)} 組 {p7_qs} 題 | 文章: {len(arts)} 篇 {total_vocab} 個標記單字 | 檢測卷: {n_diag} 題')
print(f'Part 5 答案分布: {dict(sorted(dist5.items()))}')
if errors:
    print(f'\n-- 硬錯誤 {len(errors)} 筆 --')
    for e in errors: print('  [E]', e)
if warnings:
    print(f'\n-- 警告 {len(warnings)} 筆 --')
    for wn in warnings: print('  [W]', wn)

if errors:
    print('\n有硬錯誤,不輸出 data/*.js。')
    sys.exit(1)

print('\n=== 輸出 ===')
write_js('part5.js', 'part5', p5)
write_js('part6.js', 'part6', p6)
write_js('part7.js', 'part7', p7)
write_js('articles.js', 'articles', arts)
if diag is not None:
    write_js('diagnostic.js', 'diagnostic', diag)
if writing:
    write_js('writing.js', 'writing', writing)
if listening:
    write_js('listening.js', 'listening', listening)
print('完成。')
