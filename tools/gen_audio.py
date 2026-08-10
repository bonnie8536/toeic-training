# -*- coding: utf-8 -*-
"""用 edge-tts 批量生成聽力音檔 → audio/<題目id>.mp3
用法: python tools/gen_audio.py  (已存在的檔案會跳過;要重生成請先刪除該 mp3)
聲線: 美/英/澳 × 男/女輪替;P2 問句與選項不同聲線;P3 對話 M/W 分角色。
"""
import asyncio, glob, json, os
import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw')
OUT = os.path.join(ROOT, 'audio')
os.makedirs(OUT, exist_ok=True)

VOICES = {
    'US': {'M': 'en-US-GuyNeural', 'F': 'en-US-JennyNeural'},
    'GB': {'M': 'en-GB-RyanNeural', 'F': 'en-GB-SoniaNeural'},
    'AU': {'M': 'en-AU-WilliamNeural', 'F': 'en-AU-NatashaNeural'},
}
ACCENTS = ['US', 'GB', 'AU']

def load(pattern):
    items = []
    for p in sorted(glob.glob(os.path.join(RAW, pattern))):
        with open(p, encoding='utf-8-sig') as f:
            items.extend(json.load(f))
    return items

async def tts(text, voice):
    c = edge_tts.Communicate(text, voice)
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

async def main():
    jobs = []
    for i, q in enumerate(load('listening_p1.json')):
        acc = ACCENTS[i % 3]
        voice = VOICES[acc]['M' if i % 2 == 0 else 'F']
        segs = [('%s. %s' % ('ABCD'[li], opt), voice) for li, opt in enumerate(q['options'])]
        jobs.append((q['id'] + '.mp3', segs))
    for i, q in enumerate(load('listening_p2_b*.json')):
        acc = q.get('accent', 'US')
        if acc not in VOICES:
            acc = 'US'
        qv = VOICES[acc]['F' if i % 2 == 0 else 'M']
        ov = VOICES[acc]['M' if i % 2 == 0 else 'F']
        segs = [(q['question'], qv)]
        segs += [('%s. %s' % ('ABC'[li], opt), ov) for li, opt in enumerate(q['options'])]
        jobs.append((q['id'] + '.mp3', segs))
    for i, s in enumerate(load('listening_p3_b*.json')):
        acc = ACCENTS[i % 3]
        segs = [(t['text'], VOICES[acc]['M'] if t['s'] == 'M' else VOICES[acc]['F']) for t in s['dialogue']]
        jobs.append((s['id'] + '.mp3', segs))
    for i, s in enumerate(load('listening_p4_b*.json')):
        acc = ACCENTS[i % 3]
        v = VOICES[acc]['M' if s.get('speaker', 'M') == 'M' else 'F']
        jobs.append((s['id'] + '.mp3', [(s['talk'].replace('\n', ' '), v)]))

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
