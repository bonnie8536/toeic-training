# -*- coding: utf-8 -*-
"""中文標點一律全形:把「中文旁邊」的半形 , ; : ? ! 與包住中文的 ( ) 換成全形。
英文句子、公式、網址、時間(15:29)、數字(1,200)、只包英文的括號((A)、(sit-sat-sat))不動。

只處理網站看得到的文字:
  - js/*.js 的字串內容(含樣板字串的文字段;註解、正規表示式不碰)
  - *.html 的內文與屬性值(<script> 照 JS 規則,<style>、註解不碰)
  - data/raw/*.json 的字串值(改完要跑 merge_data.py / build_dialogues.js 重產 data/*.js)

用法:
  python tools/fullwidth_punct.py            只列出會改的地方(不寫檔),有就 exit 1(可當上線前檢查)
  python tools/fullwidth_punct.py --fix      直接改檔
  python tools/fullwidth_punct.py --fix js/vocab.js data/raw/part5_b1.json   只處理指定檔
字串裡同時出現半形與全形同一種標點(多半是比對用的規則,例如 '[、,，]')或像正規表示式的,不自動改,列在 SKIP 讓人工看。
"""
import glob
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FW = {',': '，', ';': '；', ':': '：', '?': '？', '!': '！'}
SPACE = ' ' + chr(9) + chr(10)
FW_PUNCT = set('，；：？！。、（）「」『』…')


def is_cjk(ch):
    if not ch:
        return False
    o = ord(ch)
    return (0x4e00 <= o <= 0x9fff or 0x3400 <= o <= 0x4dbf or 0x3000 <= o <= 0x303f or
            0xff00 <= o <= 0xffef or 0x3100 <= o <= 0x312f or 0xf900 <= o <= 0xfaff)


def has_cjk(s):
    return any(is_cjk(c) and c not in '　' for c in s)


def has_han(s):
    """有沒有真正的漢字(全形符號如 ＋＝ 不算)。"""
    return any(0x4e00 <= ord(c) <= 0x9fff or 0x3400 <= ord(c) <= 0x4dbf or 0xf900 <= ord(c) <= 0xfaff for c in s)


# 英文寫法裡本來就有的逗號(句型公式、信件格式),不轉
PROTECT = ['How about + 動詞加 ing?', 'Yes, 主詞', '比較級, the', 'Hi Ian,', 'Dear Mr. Wu,', 'Best regards,']


def near(chars, i, step):
    j = i + step
    while 0 <= j < len(chars) and chars[j] in ' \t':
        j += step
    return chars[j] if 0 <= j < len(chars) else ''


def convert(seg):
    """回傳轉換後字串。seg 是一段純文字(字串內容或 HTML 內文)。"""
    if not seg or not has_cjk(seg):
        return seg
    keep = []
    for k, pat in enumerate(PROTECT):
        if pat in seg:
            keep.append((chr(0xE000 + k), pat))
            seg = seg.replace(pat, chr(0xE000 + k))
    out = _convert(seg)
    for mark, pat in keep:
        out = out.replace(mark, pat)
    return out


def _convert(seg):
    chars = list(seg)
    # 括號:成對且裡面有中文才換
    stack = []
    for i, c in enumerate(chars):
        if c == '(':
            stack.append(i)
        elif c == ')' and stack:
            a = stack.pop()
            if has_han(seg[a + 1:i]):
                chars[a], chars[i] = '（', '）'
    changed = set()
    for i, c in enumerate(chars):
        if c not in FW:
            continue
        p, n = near(chars, i, -1), near(chars, i, 1)
        if c in '?!':
            ok = is_cjk(p)
            # 中文問句剛好用英文字結尾(例:最適合用 used to?):問號在字串最後,往前找最後一個漢字,中間只有兩個以內的英文字
            if not ok and c == '?' and n == '':
                j = max((k for k in range(i) if has_han(chars[k])), default=-1)
                tail = ''.join(chars[j + 1:i]) if j >= 0 else ''
                ok = j >= 0 and re.fullmatch(r"[ A-Za-z'-]+", tail) is not None and len(tail.split()) <= 2
        else:
            ok = is_cjk(p) or is_cjk(n)
            # 中文解析裡夾在兩個英文字中間、後面沒空格的 , ; :(例:用 was;work 是一般動詞、renew,(D) 正確)。
            # 英文句子的標點後面一定有空格,所以「緊貼」就是中文的分句標點。
            if not ok and 0 < i < len(chars) - 1 and chars[i - 1] not in SPACE and chars[i + 1] not in SPACE + '"' + "'":
                ok = not (p.isdigit() and n.isdigit())
        if ok and c in ':,' and p.isdigit() and n.isdigit():
            ok = False
        if ok and c == ':' and n == '/':
            ok = False
        # 英文字後面緊接全形標點的逗號屬於英文寫法(例:稱呼 Hi Ian,，開頭…),不轉
        if ok and c == ',' and p.isascii() and p.isalpha() and (n in FW_PUNCT or n in '／」'):
            ok = False
        if ok:
            chars[i] = FW[c]
            changed.add(i)
    # 全形標點旁邊不留空白(只刪空格與 tab,不刪換行)
    out = []
    for i, c in enumerate(chars):
        if c in ' \t':
            p = next((chars[j] for j in range(i - 1, -1, -1) if chars[j] not in ' \t'), '')
            n = next((chars[j] for j in range(i + 1, len(chars)) if chars[j] not in ' \t'), '')
            pi = next((j for j in range(i - 1, -1, -1) if chars[j] not in ' \t'), -1)
            ni = next((j for j in range(i + 1, len(chars)) if chars[j] not in ' \t'), -1)
            if (pi in changed) or (ni in changed):
                continue
            if n == '（' and seg[ni] == '(':
                continue
            if p == '）' and seg[pi] == ')' and (is_cjk(n) or n in FW_PUNCT):
                continue
        out.append(c)
    return ''.join(out)


def suspicious(s):
    """像比對規則或正規表示式的短字串:不自動改(只用在 JS)。"""
    if len(s) <= 20 and any(h in s and f in s for h, f in FW.items()):
        return True
    if re.search(r'\[[^\]]*[,;:][^\]]*\]', s) and ('\\' in s or '|' in s or re.search(r'\[[、，,;；/ ]+\]', s)):
        return True
    return False


# ---------------- JS:找出字串內容的範圍 ----------------
REGEX_PREV = set('(,=:[!&|?{};+-*%<>~^')
REGEX_KW = {'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await'}


def js_spans(src, i=0, end_brace=False):
    """回傳 [(start, end)] 字串內容範圍,與停止位置。end_brace=True 時遇到對應的 } 就停(樣板 ${ } 用)。"""
    spans = []
    n = len(src)
    depth = 0
    last = ''      # 上一個有意義的字元
    last_word = ''
    while i < n:
        c = src[i]
        if c in ' \t\r\n':
            i += 1
            continue
        if src.startswith('//', i):
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in '\'"':
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == '\\':
                    j += 1
                elif src[j] == '\n':
                    break
                j += 1
            spans.append((i + 1, j))
            i = j + 1
            last, last_word = '"', ''
            continue
        if c == '`':
            j = i + 1
            seg_start = j
            while j < n and src[j] != '`':
                if src[j] == '\\':
                    j += 2
                    continue
                if src.startswith('${', j):
                    spans.append((seg_start, j))
                    inner, j = js_spans(src, j + 2, end_brace=True)
                    spans.extend(inner)
                    seg_start = j
                    continue
                j += 1
            spans.append((seg_start, j))
            i = j + 1
            last, last_word = '"', ''
            continue
        if c == '/':
            if last == '' or last in REGEX_PREV or last_word in REGEX_KW:
                j = i + 1
                in_cls = False
                while j < n:
                    if src[j] == '\\':
                        j += 2
                        continue
                    if src[j] == '[':
                        in_cls = True
                    elif src[j] == ']':
                        in_cls = False
                    elif src[j] == '/' and not in_cls:
                        break
                    elif src[j] == '\n':
                        break
                    j += 1
                j += 1
                while j < n and src[j].isalpha():
                    j += 1
                i = j
                last, last_word = 'r', ''
                continue
        if end_brace:
            if c == '{':
                depth += 1
            elif c == '}':
                if depth == 0:
                    return spans, i + 1
                depth -= 1
        m = re.match(r'[A-Za-z_$][\w$]*', src[i:])
        if m:
            last_word = m.group()
            last = 'w'
            i += len(last_word)
            continue
        last, last_word = c, ''
        i += 1
    return spans, i


def fix_js(src):
    spans, _ = js_spans(src)
    return apply_spans(src, spans)


def apply_spans(src, spans, js=True):
    out, pos, changes, skips = [], 0, [], []
    for a, b in sorted(spans):
        if a < pos:
            continue
        seg = src[a:b]
        new = seg
        if has_cjk(seg) and re.search(r'[,;:?!()]', seg):
            if js and suspicious(seg):
                skips.append(seg)
            else:
                new = convert(seg)
        out.append(src[pos:a])
        out.append(new)
        if new != seg:
            changes.append((seg, new))
        pos = b
    out.append(src[pos:])
    return ''.join(out), changes, skips


# ---------------- JSON:字串值 ----------------
def fix_json(src):
    spans = [(m.start() + 1, m.end() - 1) for m in re.finditer(r'"(?:[^"\\\n]|\\.)*"', src)]
    return apply_spans(src, spans, js=False)


# ---------------- HTML ----------------
def fix_html(src):
    spans = []
    i, n = 0, len(src)
    while i < n:
        if src.startswith('<!--', i):
            j = src.find('-->', i)
            i = n if j < 0 else j + 3
            continue
        if src[i] == '<':
            j = src.find('>', i)
            if j < 0:
                break
            tag = src[i:j + 1]
            name = (re.match(r'<\s*([A-Za-z0-9]+)', tag) or [None, ''])[1].lower()
            for m in re.finditer(r'([\w:-]+)\s*=\s*("([^"]*)"|\'([^\']*)\')', tag):
                attr = m.group(1).lower()
                if attr in ('style', 'href', 'src', 'class', 'id', 'rel', 'type') or attr.startswith('on'):
                    continue
                g = 3 if m.group(3) is not None else 4
                spans.append((i + m.start(g), i + m.end(g)))
            if name in ('script', 'style') and not tag.endswith('/>'):
                k = src.lower().find('</' + name, j)
                k = n if k < 0 else k
                body = src[j + 1:k]
                if name == 'script':
                    if 'ld+json' in tag:
                        inner = [(j + 1 + a, j + 1 + b) for a, b in
                                 [(m.start() + 1, m.end() - 1) for m in re.finditer(r'"(?:[^"\\\n]|\\.)*"', body)]]
                    else:
                        inner = [(j + 1 + a, j + 1 + b) for a, b in js_spans(body)[0]]
                    spans.extend(inner)
                i = k
                continue
            i = j + 1
            continue
        j = src.find('<', i)
        j = n if j < 0 else j
        spans.append((i, j))
        i = j
    return apply_spans(src, spans)


def targets():
    fs = sorted(glob.glob(os.path.join(ROOT, '*.html')) + glob.glob(os.path.join(ROOT, 'js', '*.js')) +
                [f for f in glob.glob(os.path.join(ROOT, 'data', 'raw', '*.json')) if 'phonics_' not in f])
    return fs


def process(path, write):
    src = io.open(path, encoding='utf-8-sig').read()
    ext = os.path.splitext(path)[1].lower()
    fn = {'.js': fix_js, '.json': fix_json, '.html': fix_html}.get(ext)
    if not fn:
        return [], []
    new, changes, skips = fn(src)
    if write and new != src:
        bom = io.open(path, 'rb').read(3) == b'\xef\xbb\xbf'
        io.open(path, 'w', encoding='utf-8-sig' if bom else 'utf-8', newline='').write(new)
    return changes, skips


def main(argv):
    write = '--fix' in argv
    verbose = '-v' in argv
    files = [a for a in argv if not a.startswith('-')]
    files = [os.path.join(ROOT, f) if not os.path.isabs(f) else f for f in files] or targets()
    total = 0
    for f in files:
        changes, skips = process(f, write)
        rel = os.path.relpath(f, ROOT)
        if changes:
            total += len(changes)
            print('%s:%d 處' % (rel, len(changes)))
            if verbose:
                for a, b in changes:
                    print('   - ' + a.replace('\n', '⏎')[:160])
                    print('   + ' + b.replace('\n', '⏎')[:160])
        for s in skips:
            print('SKIP %s: %s' % (rel, s.replace('\n', '⏎')[:160]))
    print(('已改 ' if write else '需要改 ') + str(total) + ' 處')
    return 0 if (write or not total) else 1


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
