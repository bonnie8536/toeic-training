# -*- coding: utf-8 -*-
"""自然發音教材檢查(只讀不寫):python tools/check_phonics.py [data/raw/phonics_chA.json ...]
不給檔名=檢查 data/raw/phonics_ch*.json 全部。有 ERROR 時 exit 1。

單元格式(一個檔=一章,JSON 陣列):
{"id":"pa-01","title":"短母音 a：cat 裡的 a","goal":"一句話說學完會什麼",
 "key":{"word":"cat","kk":"æ"},
 "lesson":[
   {"t":"p","text":"講解"},
   {"t":"words","title":"可省略","items":[{"w":"cat","zh":"貓","mark":"c[a]t"}]},
   {"t":"pairs","title":"可省略","items":[{"a":"cap","az":"帽子","b":"cup","bz":"杯子","note":"可省略"}]},
   {"t":"sent","en":"英文句子(會做音檔)","zh":"中譯"},
   {"t":"tip","text":"一句話提醒"}
 ],
 "quiz":[
   {"type":"listen","word":"cap","options":["cap","cup","cop","cape"],"answer":0,"explanation":"..."},
   {"type":"choose","q":"題目","options":["...","...","...","..."],"answer":1,"explanation":"..."}
 ]}
"""
import glob
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KINDS = {'p', 'words', 'pairs', 'sent', 'tip'}
# 一字多音(TTS 單獨唸時讀法不固定),不可當例字或聽音題選項
HETERONYMS = {
    'read', 'lead', 'live', 'wind', 'close', 'tear', 'bow', 'row', 'wound', 'minute', 'object', 'present',
    'record', 'desert', 'does', 'dove', 'bass', 'sow', 'polish', 'content', 'refuse', 'produce', 'project',
    'permit', 'subject', 'use', 'excuse', 'abuse', 'number', 'invalid', 'console', 'contract', 'entrance',
    'separate', 'estimate', 'graduate', 'alternate', 'appropriate', 'conduct', 'convert', 'address', 'insult',
    'conflict', 'increase', 'decrease', 'house', 'lives', 'used', 'wounded', 'moped', 'axes', 'resume',
    'invite', 'progress', 'export', 'import', 'rebel', 'reject', 'suspect', 'survey', 'upset', 'perfect',
    'compact', 'combat', 'contest', 'convict', 'digest', 'extract', 'incline', 'insert', 'misuse', 'object',
    'august', 'mobile', 'routing', 'sewer', 'slough', 'unionized', 'buffet', 'deliberate', 'elaborate',
    'learned', 'blessed', 'aged', 'crooked', 'ragged', 'wicked', 'dogged', 'putting', 'tarry', 'evening',
}
KK_OK = set('iɪeɛæɑɔoʊuʌəɚɝaɪjwrlmnŋpbtdkgfvθðszʃʒhˋˊ,. ') | {'̩'}  # ̩ 音節符號(table [ˋtebl̩])
CJK = '一-鿿'
HALF = re.compile(r'(?<=[' + CJK + r'])\s*[,;:?!]|[,;:]\s*(?=[' + CJK + r'])|\((?=[^()]*[' + CJK + r'])[^()]*\)')
WORD = re.compile(r"^[A-Za-z][A-Za-z'-]*$")

errors, warns = [], []


def err(w, m):
    errors.append(w + ': ' + m)


def warn(w, m):
    warns.append(w + ': ' + m)


def zh_check(s, w):
    if isinstance(s, str) and HALF.search(s):
        warn(w, '中文裡有半形標點:' + HALF.search(s).group())
    if isinstance(s, str) and re.search('——|—', s):
        warn(w, '有破折號')


def check_file(path):
    name = os.path.basename(path)
    m = re.match(r'phonics_ch([A-I])\.json$', name)
    if not m:
        err(name, '檔名需為 phonics_chA.json ~ phonics_chI.json')
        return []
    letter = m.group(1).lower()
    try:
        data = json.load(io.open(path, encoding='utf-8-sig'))
    except Exception as e:
        err(name, 'JSON 解析失敗:' + str(e))
        return []
    if not isinstance(data, list) or not data:
        err(name, '檔案要是非空陣列')
        return []
    for ui, u in enumerate(data):
        w = name + ' ' + str(u.get('id', '#' + str(ui)))
        for f in ('id', 'title', 'goal', 'key', 'lesson', 'quiz'):
            if f not in u:
                err(w, '缺欄位 ' + f)
        if 'id' in u and not re.match(r'^p' + letter + r'-\d\d$', str(u['id'])):
            err(w, 'id 需為 p' + letter + '-01 格式')
        k = u.get('key') or {}
        if not (isinstance(k, dict) and k.get('word') and k.get('kk')):
            err(w, 'key 需有 word 與 kk')
        else:
            if not WORD.match(k['word']):
                err(w, 'key.word 只能是單字:' + k['word'])
            if k['word'].lower() in HETERONYMS:
                err(w, 'key.word 是一字多音字:' + k['word'])
            bad = set(k['kk']) - KK_OK
            if bad:
                warn(w, 'key.kk 有 KK 以外的符號:' + ''.join(sorted(bad)))
        for f in ('title', 'goal'):
            zh_check(u.get(f), w + ' ' + f)
        n_words = 0
        for bi, b in enumerate(u.get('lesson', [])):
            bw = w + ' 講解' + str(bi + 1)
            t = b.get('t')
            if t not in KINDS:
                err(bw, '未知類型 t=' + repr(t))
                continue
            if t in ('p', 'tip'):
                if not b.get('text'):
                    err(bw, '缺 text')
                zh_check(b.get('text'), bw)
            elif t == 'words':
                items = b.get('items') or []
                if not items:
                    err(bw, 'words 沒有 items')
                seen = set()
                for it in items:
                    ww = bw + ' ' + str(it.get('w'))
                    word, mark = it.get('w', ''), it.get('mark', '')
                    n_words += 1
                    if not WORD.match(word):
                        err(ww, 'w 只能是單一英文字')
                    if word.lower() in HETERONYMS:
                        err(ww, '一字多音字,TTS 讀法不固定,請換字')
                    if word.lower() in seen:
                        err(ww, '同一組重複')
                    seen.add(word.lower())
                    if not it.get('zh'):
                        err(ww, '缺 zh')
                    zh_check(it.get('zh'), ww)
                    if not mark or '[' not in mark:
                        err(ww, '缺 mark(用 [ ] 框出發這個音的字母)')
                    elif mark.replace('[', '').replace(']', '') != word:
                        err(ww, 'mark 去掉括號後跟 w 不一樣:' + mark)
                    elif not re.fullmatch(r"[A-Za-z'-]*(\[[A-Za-z'-]+\][A-Za-z'-]*)+", mark):
                        err(ww, 'mark 括號不成對或是空的:' + mark)
                zh_check(b.get('title'), bw + ' title')
            elif t == 'pairs':
                items = b.get('items') or []
                if not items:
                    err(bw, 'pairs 沒有 items')
                for it in items:
                    ww = bw + ' ' + str(it.get('a')) + '/' + str(it.get('b'))
                    for side in ('a', 'b'):
                        word = it.get(side, '')
                        if not WORD.match(word):
                            err(ww, side + ' 只能是單一英文字')
                        if word.lower() in HETERONYMS:
                            err(ww, word + ' 是一字多音字')
                        if not it.get(side + 'z'):
                            err(ww, '缺 ' + side + 'z(中文意思)')
                        zh_check(it.get(side + 'z'), ww)
                    if it.get('a', '').lower() == it.get('b', '').lower():
                        err(ww, 'a 跟 b 一樣')
                    zh_check(it.get('note'), ww)
                zh_check(b.get('title'), bw + ' title')
            elif t == 'sent':
                if not (b.get('en') and b.get('zh')):
                    err(bw, 'sent 缺 en/zh')
                zh_check(b.get('zh'), bw)
        if n_words < 6:
            warn(w, '例字只有 ' + str(n_words) + ' 個(預期 8 上下)')
        quiz = u.get('quiz') or []
        if not (6 <= len(quiz) <= 8):
            warn(w, '題數 ' + str(len(quiz)) + '(預期 6~8)')
        n_listen = 0
        for qi, q in enumerate(quiz):
            qw = w + ' Q' + str(qi + 1)
            opts = q.get('options') or []
            ans = q.get('answer')
            if len(opts) != 4:
                err(qw, '選項要 4 個')
            if not isinstance(ans, int) or not (0 <= ans < len(opts)):
                err(qw, 'answer 要是 0~3')
            if len({str(o).strip().lower() for o in opts}) != len(opts):
                err(qw, '選項重複')
            if not q.get('explanation'):
                err(qw, '缺 explanation')
            zh_check(q.get('explanation'), qw + ' 解析')
            if q.get('type') == 'listen':
                n_listen += 1
                for o in opts:
                    if not WORD.match(str(o)):
                        err(qw, '聽音題選項只能是單字:' + str(o))
                    elif str(o).lower() in HETERONYMS:
                        err(qw, '聽音題選項是一字多音字:' + str(o))
                if isinstance(ans, int) and 0 <= ans < len(opts) and q.get('word') != opts[ans]:
                    err(qw, 'word 要等於正確選項 options[answer]')
            elif q.get('type') == 'choose':
                if not q.get('q'):
                    err(qw, 'choose 題缺 q')
                zh_check(q.get('q'), qw)
            else:
                err(qw, 'type 只能是 listen 或 choose')
        if quiz and n_listen * 2 < len(quiz):
            warn(w, '聽音題 ' + str(n_listen) + ' 題,少於一半')
        answers = [q.get('answer') for q in quiz if isinstance(q.get('answer'), int)]
        if len(answers) >= 6 and len(set(answers)) <= 2:
            warn(w, '答案位置只用到 ' + str(sorted(set(answers))))
    return data


def main(paths):
    if not paths:
        paths = sorted(glob.glob(os.path.join(ROOT, 'data', 'raw', 'phonics_ch*.json')))
    ids = {}
    for p in paths:
        for u in check_file(p):
            if 'id' in u:
                ids.setdefault(u['id'], []).append(os.path.basename(p))
    for i, fs in ids.items():
        if len(fs) > 1:
            err(i, 'id 重複:' + ','.join(fs))
    for e in errors:
        print('ERROR ' + e)
    for x in warns:
        print('WARN  ' + x)
    print('檢查 %d 個檔、%d 個單元:%d 個錯誤、%d 個提醒' % (len(paths), len(ids), len(errors), len(warns)))
    return 1 if errors else 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
