import base64
import json
import os
import sys

REPO = r'C:\Users\bonni\Desktop\claude\toeic-training'
S = r'C:\Users\bonni\AppData\Local\Temp\claude\C--\27c708fc-37e1-4274-ad2f-027fb7f1c0da\scratchpad'

path = sys.argv[1]
wrapper = json.load(open(path, encoding='utf-8'))
text = wrapper[0]['text']
end = text.rfind('"')
try:
    batch = json.loads(json.loads(text[:end + 1]))
except Exception:
    batch = json.loads(text)

expected = set(json.load(open(S + r'\regen_map.json', encoding='utf-8'))['map'])
got = set()
for item in batch:
    if 'err' in item and item.get('err'):
        print(item['id'], 'ERR', item['err'])
        continue
    sid = item['id']
    got.add(sid)
    sub = 'img\\listening' if sid.startswith('l1-') else 'img\\articles'
    p = os.path.join(REPO, sub, sid + '.jpg')
    data = base64.b64decode(item['b64'])
    open(p, 'wb').write(data)
    print(sid, '->', p, len(data) // 1024, 'KB')
print('saved', len(got), '/', len(expected), '| missing:', sorted(expected - got))
