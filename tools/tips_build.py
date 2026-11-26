# -*- coding: utf-8 -*-
"""技巧卡 data/tips.js（tools/merge_data.py 合併完題庫後呼叫；課程頁讀 window.TIP_CARDS）。
來源 data/raw/tip_cards.json：{"v": 1, "cards": [...]}，每張卡 id、part、title、body、example、source，四個程度共用。
輸出只放這些欄位，照來源的順序；整份用 Object.freeze 凍結。
產生時的檢查（不合格算硬錯誤，merge_data.py 不輸出任何檔）：
  id 照 tip-P<1–7>-<小寫英文與底線> 的格式、part 跟 id 的 Part 一致、id 不重複；
  title ≤16 字、body ≤150 字（不含示例）；example.en 不能空、example.zh 可省略（照片卡要寫照片情境）且 ≤40 字、
  example.kind 是 sentence、script（聽到的句子）或 photo，而且跟 Part 對得上（P1 photo、P2–P4 script、P5–P7 sentence）；
  source 是 original；不能有多的欄位；示例英文照下面的排法。
  字數用字元算，英文字母也一個字元算一個。
示例英文的排法與顯示規則（課程頁照這個標出哪些是聽到的、哪些是題本印的）：
  photo（P1）：en 每一行是一句聽到的描述，(A)、(B) 開頭；zh 第一句寫照片情境（「照片是」開頭），後面是說明。
  script（P2）：en 第一行是聽到的問句，下面每一行是聽到的回答，(A)、(B) 開頭；全部都是聽到的句子。
  script（P3、P4）：en 先寫聽到的對話或獨白，再一行「Question: 題目」，下面每一行是 (A)、(B) 開頭的選項；
    從 Question: 那一行起顯示成題本印的題目與選項（題目也會播出，選項只印不播），前面的才標成聽到的句子。
  sentence（P5–P7）：全部是題本印的文字。
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
KIND_OF_PART = {'P1': 'photo', 'P2': 'script', 'P3': 'script', 'P4': 'script', 'P5': 'sentence', 'P6': 'sentence', 'P7': 'sentence'}
ID_RE = re.compile(r'tip-P([1-7])-[a-z]+(?:_[a-z]+)*')
OPTION_RE = re.compile(r'\([A-D]\) \S')
QUESTION = 'Question: '
TITLE_MAX, BODY_MAX, ZH_MAX = 16, 150, 40
HEAD = ('/* 技巧卡：由 tools/merge_data.py 從 data/raw/tip_cards.json 產生，不要手改。'
        '欄位、示例的排法與顯示規則見 tools/tips_build.py。 */\n'
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


def photo_errors(lines, zh):
    """P1：每一行是 (A) 開頭的描述；zh 第一句寫照片情境。"""
    out = [] if all(OPTION_RE.match(s) for s in lines) else ['example.en 照片卡每一行要是 (A)、(B) 開頭的描述']
    if isinstance(zh, str) and zh.strip() and not zh.startswith('照片是'):
        out.append('example.zh 第一句要寫照片情境（「照片是」開頭）')
    return out


def script_errors(part, lines):
    """P2：問句一行加回答；P3、P4：聽到的內容、一行 Question:、選項。選項至少兩個。"""
    is_opt = [bool(OPTION_RE.match(s)) for s in lines]
    if part == 'P2':
        ok = len(lines) >= 3 and not is_opt[0] and all(is_opt[1:])
        return [] if ok else ['example.en 第一行是問句，下面每一行是 (A)、(B) 開頭的回答，至少兩個']
    q = [i for i, s in enumerate(lines) if s.startswith(QUESTION)]
    ok = (len(q) == 1 and q[0] >= 1 and not any(is_opt[:q[0]])
          and len(lines) - q[0] >= 3 and all(is_opt[q[0] + 1:]))
    return [] if ok else ['example.en 要先寫聽到的內容，再一行 Question: 題目，下面每一行是 (A)、(B) 開頭的選項，至少兩個']


def layout_errors(part, ex):
    """示例的種類要跟 Part 對得上、英文照檔頭的排法；種類不認得或英文是空的，前面已經列錯，這裡不再查。"""
    if not isinstance(ex, dict) or ex.get('kind') not in KINDS or not isinstance(ex.get('en'), str) or not ex['en'].strip():
        return []
    want = KIND_OF_PART[part]
    if ex['kind'] != want:
        return [f'example.kind 在 {part} 要是 {want}，實際 {ex["kind"]!r}']
    lines = ex['en'].split('\n')
    if want == 'photo':
        return photo_errors(lines, ex.get('zh'))
    return script_errors(part, lines) if want == 'script' else []


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
        out += layout_errors('P' + m.group(1), card['example']) if m else []
    if 'source' in card and card['source'] != 'original':
        out.append(f'source 要是 original（示例一律原創），實際 {card["source"]!r}')
    return out


def check(doc, name='tip_cards.json'):
    """整份來源的錯誤清單，每筆寫出哪一張、哪一欄。"""
    # type 要剛好是 int：True、1.0 跟 1 相等，但不是版本號
    if not isinstance(doc, dict) or type(doc.get('v')) is not int or doc['v'] != 1 \
            or not isinstance(doc.get('cards'), list) or not doc['cards']:
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


def load_for_merge(src, explicit, out_dir):
    """merge_data.py 用，回 (cards, errors, warnings)。
    來源不存在時：MERGE_TIPS 指定的來源（explicit）或輸出資料夾還留著舊的 tips.js 算錯誤（不然舊檔會一直被當成最新的），
    兩者都不是只提醒。"""
    cards, errors = load(src)
    if cards is not None or errors:
        return cards, errors, []
    if explicit:
        return None, [f'MERGE_TIPS 指定的來源不存在：{src}'], []
    if os.path.exists(os.path.join(out_dir, 'tips.js')):
        return None, ['tip_cards.json 不見了，輸出資料夾還留著舊的 tips.js：把來源放回 data/raw，或把 tips.js 一起刪掉'], []
    return None, [], ['tip_cards.json 還沒有，不輸出 tips.js']


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
