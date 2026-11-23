# -*- coding: utf-8 -*-
"""技巧卡 data/tips.js（tools/merge_data.py 合併完題庫後呼叫；課程頁讀 window.TIP_CARDS）。
來源 data/raw/tip_cards.json：{"v": 1, "cards": [...]}，每張卡 id、part、title、body、example、source，四個程度共用。
輸出只放這些欄位，照來源的順序；整份用 Object.freeze 凍結。
產生時的檢查（不合格算硬錯誤，merge_data.py 不輸出任何檔）：
  id 照 tip-P<1–7>-<小寫英文與底線> 的格式、part 跟 id 的 Part 一致、id 不重複；
  title ≤16 字、body ≤150 字（不含示例）；example.en 不能空、example.zh 可省略（照片卡要寫照片情境）且 ≤40 字、
  example.kind 是 sentence、script（聽到的句子）或 photo；source 是 original；不能有多的欄位。
  字數用字元算，英文字母也一個字元算一個。
單獨檢查：python tools/tips_build.py [來源檔]（預設 data/raw/tip_cards.json），加 --out 資料夾 會寫出 tips.js；有錯 exit 1。
"""
import argparse
import json
import os
import re
import sys

FIELDS = ('id', 'part', 'title', 'body', 'example', 'source')
EXAMPLE_FIELDS = ('en', 'zh', 'kind')
KINDS = ('sentence', 'script', 'photo')
ID_RE = re.compile(r'tip-P([1-7])-[a-z]+(?:_[a-z]+)*')
TITLE_MAX, BODY_MAX, ZH_MAX = 16, 150, 40
HEAD = ('/* 技巧卡：由 tools/merge_data.py 從 data/raw/tip_cards.json 產生，不要手改。 */\n'
        'window.TIP_CARDS = (function freeze(x) {\n'
        '  Object.keys(x).forEach(function (k) { if (x[k] && typeof x[k] === \'object\') freeze(x[k]); });\n'
        '  return Object.freeze(x);\n'
        '})({"v": 1, "cards": [\n')
TAIL = '\n]});\n'


def text_errors(value, field, limit, required=True):
    """一個文字欄位的錯誤（沒有錯回空字串）。"""
    if value is None and not required:
        return ''
    if not isinstance(value, str) or not value.strip():
        return f'{field} 要是不空的文字'
    if len(value) > limit:
        return f'{field} {len(value)} 字，上限 {limit} 字'
    return ''


def example_errors(ex):
    """example 欄位的錯誤清單。"""
    if not isinstance(ex, dict):
        return ['example 要是 { en, zh, kind }']
    out = [f'example 多了欄位 {k}' for k in ex if k not in EXAMPLE_FIELDS]
    if not isinstance(ex.get('en'), str) or not ex['en'].strip():
        out.append('example.en 不能空')
    if ex.get('kind') not in KINDS:
        out.append(f'example.kind 要是 {"、".join(KINDS)} 其中一個，實際 {ex.get("kind")!r}')
    zh_required = ex.get('kind') == 'photo'
    msg = text_errors(ex.get('zh'), 'example.zh' + ('（照片卡要寫照片情境）' if zh_required else ''), ZH_MAX, zh_required)
    return out + ([msg] if msg else [])


def card_errors(card, seen):
    """一張卡的錯誤清單；seen 是前面出現過的 id。"""
    if not isinstance(card, dict):
        return ['要是 { id, part, title, body, example, source }']
    out = [f'多了欄位 {k}' for k in card if k not in FIELDS]
    out += [f'少了欄位 {k}' for k in FIELDS if k not in card]
    cid = card.get('id')
    m = ID_RE.fullmatch(cid) if isinstance(cid, str) else None
    if not m:
        out.append(f'id {cid!r} 要照 tip-P<1–7>-<小寫英文與底線> 的格式')
    elif cid in seen:
        out.append(f'id {cid} 重複')
    if m and card.get('part') != 'P' + m.group(1):
        out.append(f'part 要是 P{m.group(1)}（跟 id 一致），實際 {card.get("part")!r}')
    for field, limit in (('title', TITLE_MAX), ('body', BODY_MAX)):
        msg = text_errors(card.get(field), field, limit) if field in card else ''
        out += [msg] if msg else []
    if 'example' in card:
        out += example_errors(card['example'])
    if 'source' in card and card['source'] != 'original':
        out.append(f'source 要是 original（示例一律原創），實際 {card["source"]!r}')
    return out


def check(doc, name='tip_cards.json'):
    """整份來源的錯誤清單，每筆寫出哪一張、哪一欄。"""
    if not isinstance(doc, dict) or doc.get('v') != 1 or not isinstance(doc.get('cards'), list) or not doc['cards']:
        return [f'{name}：格式要是 {{"v": 1, "cards": [至少一張卡]}}']
    errors = [f'{name}：多了欄位 {k}' for k in doc if k not in ('v', 'cards')]
    seen = set()
    for i, card in enumerate(doc['cards']):
        cid = card.get('id') if isinstance(card, dict) else None
        errors += [f'{name} 第 {i + 1} 張 {cid if isinstance(cid, str) else "?"}：{e}' for e in card_errors(card, seen)]
        if isinstance(cid, str):
            seen.add(cid)
    return errors


def load(path):
    """讀來源並檢查，回 (cards, errors)。檔案不存在回 (None, [])，由呼叫的一方決定要不要提醒。"""
    if not os.path.exists(path):
        return None, []
    name = os.path.basename(path)
    try:
        with open(path, encoding='utf-8-sig') as f:
            doc = json.load(f)
    except (OSError, ValueError) as e:
        return None, [f'{name}：讀不懂（{e}）']
    errors = check(doc, name)
    return (None if errors else doc['cards']), errors


def pick(card):
    """輸出只放規定的欄位，順序固定。"""
    ex = card['example']
    out_ex = {'en': ex['en']}
    if ex.get('zh') is not None:
        out_ex['zh'] = ex['zh']
    out_ex['kind'] = ex['kind']
    return {'id': card['id'], 'part': card['part'], 'title': card['title'], 'body': card['body'],
            'example': out_ex, 'source': card['source']}


def render(cards):
    return HEAD + ',\n'.join(json.dumps(pick(c), ensure_ascii=False, separators=(',', ':')) for c in cards) + TAIL


def write(out_dir, cards, fname='tips.js'):
    with open(os.path.join(out_dir, fname), 'w', encoding='utf-8', newline='\n') as f:
        f.write(render(cards))
    print(f'  寫出 {fname}')


def main(argv):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description='檢查技巧卡來源；加 --out 會寫出 tips.js')
    ap.add_argument('src', nargs='?', default=os.path.join(root, 'data', 'raw', 'tip_cards.json'))
    ap.add_argument('--out', help='寫出 tips.js 的資料夾')
    args = ap.parse_args(argv)
    if not os.path.exists(args.src):
        print(f'找不到 {args.src}')
        return 1
    cards, errors = load(args.src)
    out_dir = args.out
    for e in errors:
        print('  [E]', e)
    if errors:
        print(f'技巧卡有 {len(errors)} 個錯誤，不輸出。')
        return 1
    if out_dir:
        write(out_dir, cards)
    print(f'技巧卡 {len(cards)} 張，檢查通過。')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
