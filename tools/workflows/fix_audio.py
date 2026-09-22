# -*- coding: utf-8 -*-
"""一次性修復:重新編碼所有「串接生成」的聽力音檔(l1/l2/l3 前綴)。
串接殘留的中段 ID3/Xing 標頭會讓瀏覽器 seek 表壞掉 → 重播只播到一半。
先用 ffprobe 比對「容器估計長度 vs 實際解碼長度」,只修真的壞的也可以,
但為求一致全部重編碼(48k CBR / 24kHz / mono,與 edge-tts 原格式相同)。"""
import glob
import os
import subprocess
import sys

AUDIO = r'C:\Users\bonni\Desktop\claude\toeic-training\audio'

def probe_duration(path):
    p = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=nw=1:nk=1', path], capture_output=True, text=True)
    try:
        return float(p.stdout.strip())
    except ValueError:
        return -1

files = []
for pref in ('l1-', 'l2-', 'l3-'):
    files += sorted(glob.glob(os.path.join(AUDIO, pref + '*.mp3')))
print('target files:', len(files))

fixed = bad = 0
for f in files:
    before = probe_duration(f)
    tmp = f + '.tmp.mp3'
    p = subprocess.run(
        ['ffmpeg', '-y', '-i', f, '-c:a', 'libmp3lame', '-b:a', '48k',
         '-ar', '24000', '-ac', '1', tmp], capture_output=True)
    if p.returncode != 0 or not os.path.exists(tmp) or os.path.getsize(tmp) < 1000:
        print('FAIL', os.path.basename(f), p.stderr.decode('utf-8', 'replace')[-150:])
        if os.path.exists(tmp):
            os.remove(tmp)
        bad += 1
        continue
    after = probe_duration(tmp)
    os.replace(tmp, f)
    fixed += 1
    # 長度差 >1.5 秒 = 原本 seek 表確實壞掉的檔案,列出來
    if before > 0 and abs(after - before) > 1.5:
        print('WAS-BROKEN %-12s est %.1fs -> real %.1fs' % (os.path.basename(f), before, after))
print('reencoded:', fixed, '| failed:', bad)
