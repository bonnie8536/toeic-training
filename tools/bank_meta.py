# -*- coding: utf-8 -*-
"""題目索引 data/bank-meta.js(tools/merge_data.py 合併完題庫後呼叫;js/bank.js 讀)。
選題用的公開索引:只有編號與分類欄位,不放題目、選項、詳解、翻譯。七個 Part 依序(1–7),各 Part 照原陣列順序。
欄位:id、part('1'–'7')、difficulty(P1–P5)、category(P2、P5)、type(P4 整組)、types(P6 各小題,照小題順序)、
size(P3、P4、P6、P7 的小題數)、format 與 words(P7;words 是整組文章字數)、canYou(P2 問句是不是 Can you、Could you 開頭)。
字數用空白切詞;結構化文章(blocks)把表格、kv、聊天訊息的文字攤平再算,區塊類型 t、表頭開關 header、訊息時間 time 不算。
"""
import json
import os
import re

SKIP = ('t', 'header', 'time')
CAN_YOU = re.compile(r'^(can|could) you\b', re.I)


def flat_text(v):
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ' '.join(flat_text(x) for x in v)
    if isinstance(v, dict):
        return ' '.join(flat_text(x) for k, x in v.items() if k not in SKIP)
    return ''


def p7_words(s):
    return sum(len((p.get('content') or flat_text(p.get('blocks') or [])).split()) for p in s['passages'])


def rows(lp1, lp2, lp3, lp4, p5, p6, p7):
    out = []
    for q in lp1:
        out.append({'id': q['id'], 'part': '1', 'difficulty': q['difficulty']})
    for q in lp2:
        out.append({'id': q['id'], 'part': '2', 'difficulty': q['difficulty'], 'category': q['category'],
                    'canYou': bool(CAN_YOU.match(q['question'].strip()))})
    for s in lp3:
        out.append({'id': s['id'], 'part': '3', 'difficulty': s['difficulty'], 'size': len(s['questions'])})
    for s in lp4:
        out.append({'id': s['id'], 'part': '4', 'difficulty': s['difficulty'], 'type': s['type'], 'size': len(s['questions'])})
    for q in p5:
        out.append({'id': q['id'], 'part': '5', 'difficulty': q['difficulty'], 'category': q['category']})
    for s in p6:
        out.append({'id': s['id'], 'part': '6', 'types': [q.get('type') for q in s['questions']], 'size': len(s['questions'])})
    for s in p7:
        out.append({'id': s['id'], 'part': '7', 'format': s['format'], 'size': len(s['questions']), 'words': p7_words(s)})
    return out


def write(out_dir, items, fname='bank-meta.js'):
    with open(os.path.join(out_dir, fname), 'w', encoding='utf-8', newline='\n') as f:
        f.write('window.BANK_META = {"v": 1, "items": [\n')
        f.write(',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in items))
        f.write('\n]};\n')
    print(f'  寫出 {fname}')
