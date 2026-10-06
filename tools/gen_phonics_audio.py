# -*- coding: utf-8 -*-
"""自然發音音檔:讀 data/raw/phonics_ch*.json,用 edge-tts 產生
  audio/ph-<單字>.mp3        例字、對比字、代表字、聽音題的四個選項、規則題裡的單字選項
  audio/ph-s-<課id>-<n>.mp3  每課第 n 個 sent 句子
已經有的檔會跳過(要重做先刪掉)。用法:python tools/gen_phonics_audio.py [--list]
聲線用單一語言的美式女聲 Aria:Multilingual 聲線會自己判斷語言,pan、den 這種短字可能被唸成別的語言;
2026-10-06 用 faster-whisper 聽寫比對過,Jenny 單字的 hot、dead、thin、vase 等容易被聽成別的字,Aria 清楚得多。"""
import asyncio
import glob
import io
import json
import os
import re
import sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'audio')
VOICE = 'en-US-AriaNeural'
WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'-]*$")
# 少數字 Aria 唸得含糊(兩個 whisper 模型都聽成別的字),改用 Jenny,文字可加句點讓語調收尾
OVERRIDE = {
    'ago': ('en-US-JennyNeural', 'ago.'), 'bets': ('en-US-JennyNeural', 'bets'), 'cat': ('en-US-JennyNeural', 'cat'),
    'chore': ('en-US-JennyNeural', 'chore'), 'fin': ('en-US-JennyNeural', 'fin'), 'keep': ('en-US-JennyNeural', 'keep'),
}


def slug(w):
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', w.lower()))


def collect():
    words, sents = {}, {}
    for p in sorted(glob.glob(os.path.join(ROOT, 'data', 'raw', 'phonics_ch*.json'))):
        for u in json.load(io.open(p, encoding='utf-8-sig')):
            add = lambda w: words.setdefault(slug(w), w) if w and WORD_RE.match(w) else None
            add((u.get('key') or {}).get('word'))
            n = 0
            for b in u.get('lesson', []):
                if b.get('t') == 'words':
                    for it in b.get('items', []):
                        add(it.get('w'))
                elif b.get('t') == 'pairs':
                    for it in b.get('items', []):
                        add(it.get('a'))
                        add(it.get('b'))
                elif b.get('t') == 'sent':
                    n += 1
                    sents['s-' + u['id'] + '-' + str(n)] = b['en']
            for q in u.get('quiz', []):
                add(q.get('word'))
                opts = q.get('options') or []
                if all(WORD_RE.match(str(o)) for o in opts):
                    for o in opts:
                        add(o)
    return words, sents


async def tts(text, path, rate):
    voice = VOICE
    if text.lower() in OVERRIDE:
        voice, text = OVERRIDE[text.lower()]
    for attempt in range(4):
        try:
            c = edge_tts.Communicate(text, voice, rate=rate)
            buf = b''
            async for chunk in c.stream():
                if chunk['type'] == 'audio':
                    buf += chunk['data']
            if len(buf) < 1500:
                raise RuntimeError('音檔太小')
            with open(path, 'wb') as f:
                f.write(buf)
            return True
        except Exception as e:
            await asyncio.sleep(1.5 * (attempt + 1))
            last = e
    print('失敗', os.path.basename(path), text, last)
    return False


async def main():
    words, sents = collect()
    jobs = [('ph-' + k, w, '-8%') for k, w in sorted(words.items())] + [('ph-' + k, s, '-6%') for k, s in sorted(sents.items())]
    if '--list' in sys.argv:
        print('單字 %d 個、句子 %d 句' % (len(words), len(sents)))
        return
    todo = [j for j in jobs if not os.path.exists(os.path.join(OUT, j[0] + '.mp3'))]
    print('全部 %d 個,要產生 %d 個' % (len(jobs), len(todo)))
    sem = asyncio.Semaphore(6)
    done = 0

    async def one(j):
        nonlocal done
        async with sem:
            ok = await tts(j[1], os.path.join(OUT, j[0] + '.mp3'), j[2])
            done += 1
            if done % 50 == 0:
                print('  %d / %d' % (done, len(todo)))
            return ok

    res = await asyncio.gather(*(one(j) for j in todo))
    print('完成 %d 個,失敗 %d 個' % (sum(res), len(res) - sum(res)))


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    asyncio.run(main())
