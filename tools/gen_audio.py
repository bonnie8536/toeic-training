# -*- coding: utf-8 -*-
"""用 edge-tts 批量生成聽力音檔 → audio/<題目id>.mp3
v2:選項整段一次合成(斷句自然)+新一代 Multilingual 聲線。
用法: python tools/gen_audio.py  (已存在的檔案會跳過;要重生成請先刪除該 mp3)
"""
import asyncio, glob, json, os
import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw')
OUT = os.path.join(ROOT, 'audio')
os.makedirs(OUT, exist_ok=True)

VOICES = {
    'US': {'M': 'en-US-AndrewMultilingualNeural', 'F': 'en-US-AvaMultilingualNeural'},
    'US2': {'M': 'en-US-BrianMultilingualNeural', 'F': 'en-US-EmmaMultilingualNeural'},
    'GB': {'M': 'en-GB-RyanNeural', 'F': 'en-GB-SoniaNeural'},
    'AU': {'M': 'en-AU-WilliamMultilingualNeural', 'F': 'en-AU-NatashaNeural'},
}
ACCENTS = ['US', 'GB', 'AU', 'US2']

def load(pattern):
    items = []
    for p in sorted(glob.glob(os.path.join(RAW, pattern))):
        with open(p, encoding='utf-8-sig') as f:
            items.extend(json.load(f))
    return items

async def tts(text, voice, rate='-4%'):
    c = edge_tts.Communicate(text, voice, rate=rate)
    buf = b''
    async for chunk in c.stream():
        if chunk['type'] == 'audio':
            buf += chunk['data']
    return buf

async def save(fname, segments):
    path = os.path.join(OUT, fname)
    if os.path.exists(path):
        print('skip', fname, flush=True)
        return
    data = b''
    for text, voice in segments:
        data += await tts(text, voice)
    with open(path, 'wb') as f:
        f.write(data)
    print('ok', fname, len(data) // 1024, 'KB', flush=True)

def letters_block(options, letters='ABCD'):
    """選項合成單一文本,讓引擎自然斷句。句尾補句點確保停頓。"""
    parts = []
    for li, opt in enumerate(options):
        o = opt.strip()
        if not o.endswith(('.', '?', '!')):
            o += '.'
        parts.append('%s. %s' % (letters[li], o))
    return ' '.join(parts)

async def main():
    jobs = []
    # P1:四句描述一段合成,單一聲線
    for i, q in enumerate(load('listening_p1.json')):
        acc = ACCENTS[i % 4]
        voice = VOICES[acc]['M' if i % 2 == 0 else 'F']
        jobs.append((q['id'] + '.mp3', [(letters_block(q['options'], 'ABCD'), voice)]))
    # P2:問句一段(聲線1)+三選項一段(聲線2)
    for i, q in enumerate(load('listening_p2_b*.json')):
        acc = q.get('accent', 'US')
        if acc not in VOICES:
            acc = 'US'
        qv = VOICES[acc]['F' if i % 2 == 0 else 'M']
        ov = VOICES[acc]['M' if i % 2 == 0 else 'F']
        jobs.append((q['id'] + '.mp3', [(q['question'], qv), (letters_block(q['options'], 'ABC'), ov)]))
    # P3:對話逐回合(必須換聲線),同回合內整段
    for i, s in enumerate(load('listening_p3_b*.json')):
        acc = ACCENTS[i % 4]
        segs = [(t['text'], VOICES[acc]['M'] if t['s'] == 'M' else VOICES[acc]['F']) for t in s['dialogue']]
        jobs.append((s['id'] + '.mp3', segs))
    # P4:獨白整段
    for i, s in enumerate(load('listening_p4_b*.json')):
        acc = ACCENTS[i % 4]
        v = VOICES[acc]['M' if s.get('speaker', 'M') == 'M' else 'F']
        jobs.append((s['id'] + '.mp3', [(s['talk'].replace('\n', ' '), v)]))
    # 英語耳(檔案存在才生成)
    for q in load('ear_dictation.json'):
        jobs.append((q['id'] + '.mp3', [(q['text'], VOICES['US']['F' if int(q['id'][2:]) % 2 else 'M'])]))
    for q in load('ear_pairs.json'):
        jobs.append((q['id'] + '.mp3', [(q['audioText'], VOICES['US']['M' if int(q['id'][3:]) % 2 else 'F'])]))
    for q in load('ear_numbers.json'):
        jobs.append((q['id'] + '.mp3', [(q['audioText'], VOICES['US2']['F' if int(q['id'][2:]) % 2 else 'M'])]))

    print('共', len(jobs), '個音檔', flush=True)
    sem = asyncio.Semaphore(5)

    async def run(fname, segs):
        async with sem:
            for attempt in range(3):
                try:
                    await save(fname, segs)
                    return
                except Exception as e:
                    print('retry' if attempt < 2 else 'FAIL', fname, e, flush=True)
                    await asyncio.sleep(2)

    await asyncio.gather(*[run(f, s) for f, s in jobs])
    done = len(glob.glob(os.path.join(OUT, '*.mp3')))
    print('完成:audio/ 內共', done, '個 mp3', flush=True)

asyncio.run(main())
