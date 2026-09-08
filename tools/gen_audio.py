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

# ---------- 靜音段(用 ffmpeg 產生,格式對齊 edge-tts 的 24kHz mono 48kbps mp3) ----------
_SIL_CACHE = {}

def silence(ms):
    """回傳指定毫秒數的靜音 mp3 位元組(快取)。"""
    if ms not in _SIL_CACHE:
        import subprocess, tempfile
        tmp = os.path.join(tempfile.gettempdir(), 'sil_%d.mp3' % ms)
        if not os.path.exists(tmp):
            subprocess.run([
                'ffmpeg', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
                '-t', str(ms / 1000), '-c:a', 'libmp3lame', '-b:a', '48k', tmp,
            ], capture_output=True, check=True)
        with open(tmp, 'rb') as f:
            _SIL_CACHE[ms] = f.read()
    return _SIL_CACHE[ms]

async def save(fname, segments):
    """segments 項目=(text, voice) 或 int(毫秒靜音)。段落間插靜音避免黏在一起。"""
    path = os.path.join(OUT, fname)
    if os.path.exists(path):
        print('skip', fname, flush=True)
        return
    data = b''
    for seg in segments:
        if isinstance(seg, int):
            data += silence(seg)
        else:
            data += await tts(seg[0], seg[1])
    with open(path, 'wb') as f:
        f.write(data)
    print('ok', fname, len(data) // 1024, 'KB', flush=True)

def letter_segments(options, voice, letters='ABCD', gap=700):
    """每個選項獨立合成(各自是完整句,韻律不受影響),選項之間插靜音。"""
    segs = []
    for li, opt in enumerate(options):
        o = opt.strip()
        if not o.endswith(('.', '?', '!')):
            o += '.'
        if li:
            segs.append(gap)
        segs.append(('%s. %s' % (letters[li], o), voice))
    return segs

async def main():
    jobs = []
    # P1:四個選項各自獨立合成,選項間 700ms 靜音
    for i, q in enumerate(load('listening_p1.json')):
        acc = ACCENTS[i % 4]
        voice = VOICES[acc]['M' if i % 2 == 0 else 'F']
        jobs.append((q['id'] + '.mp3', letter_segments(q['options'], voice, 'ABCD')))
    # P2:問句(聲線1)+800ms+三選項(聲線2,選項間 700ms)
    for i, q in enumerate(load('listening_p2_b*.json')):
        acc = q.get('accent', 'US')
        if acc not in VOICES:
            acc = 'US'
        qv = VOICES[acc]['F' if i % 2 == 0 else 'M']
        ov = VOICES[acc]['M' if i % 2 == 0 else 'F']
        jobs.append((q['id'] + '.mp3', [(q['question'], qv), 800] + letter_segments(q['options'], ov, 'ABC')))
    # P3:對話逐回合(必須換聲線),回合間 400ms
    for i, s in enumerate(load('listening_p3_b*.json')):
        acc = ACCENTS[i % 4]
        segs = []
        for ti, t in enumerate(s['dialogue']):
            if ti:
                segs.append(400)
            segs.append((t['text'], VOICES[acc]['M'] if t['s'] == 'M' else VOICES[acc]['F']))
        jobs.append((s['id'] + '.mp3', segs))
    # P4:獨白整段
    for i, s in enumerate(load('listening_p4_b*.json')):
        acc = ACCENTS[i % 4]
        v = VOICES[acc]['M' if s.get('speaker', 'M') == 'M' else 'F']
        jobs.append((s['id'] + '.mp3', [(s['talk'].replace('\n', ' '), v)]))
    # 英語耳(檔案存在才生成)
    for q in load('ear_dictation*.json'):
        jobs.append((q['id'] + '.mp3', [(q['text'], VOICES['US']['F' if int(q['id'][2:]) % 2 else 'M'])]))
    for q in load('ear_pairs*.json'):
        jobs.append((q['id'] + '.mp3', [(q['audioText'], VOICES['US']['M' if int(q['id'][3:]) % 2 else 'F'])]))
    for q in load('ear_numbers*.json'):
        jobs.append((q['id'] + '.mp3', [(q['audioText'], VOICES['US2']['F' if int(q['id'][2:]) % 2 else 'M'])]))
    # 舊跟讀用:基礎聽寫句的中文翻譯音檔(台灣腔) d-01 → dz-01;新批聽寫不用(跟讀已改吃 s- 專用池)
    for q in load('ear_dictation.json'):
        jobs.append(('dz-' + q['id'][2:] + '.mp3', [(q['zh'], 'zh-TW-HsiaoChenNeural')]))
    # 跟讀專用句庫:英文句(四腔輪替)+中文翻譯 s-01 → s-01.mp3 / dz-s-01.mp3
    for i, q in enumerate(load('ear_shadow*.json')):
        acc = ACCENTS[i % 4]
        jobs.append((q['id'] + '.mp3', [(q['text'], VOICES[acc]['F' if i % 2 else 'M'])]))
        jobs.append(('dz-' + q['id'] + '.mp3', [(q['zh'], 'zh-TW-HsiaoChenNeural')]))

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
