import re
import json
import urllib.request

SHARE = 'https://chatgpt.com/share/6aa52d46-6354-83ee-bf2f-58fe5310d384'
OUT = r'C:\Users\bonni\AppData\Local\Temp\claude\C--\27c708fc-37e1-4274-ad2f-027fb7f1c0da\scratchpad'

KEYS = {
    'art-5a': 'lifting numbered trays',
    'art-5b': 'airport departure gate with a laptop bag',
    'art-6a': 'brown paper parcel tied with string',
    'art-7a': 'housekeeper in soft flat shoes',
    'art-7b': 'trays of lettuce',
    'art-8a': 'self-checkout kiosks',
    'art-9a': 'Tainan train station',
    'art-9b': 'ten seated colleagues',
    'art-10a': 'folded umbrellas',
    'art-11a': 'wearing headsets',
    'art-11b': 'folded blazers',
    'art-12a': 'no name tags',
    'art-15a': 'mid-yawn',
    'art-15b': 'thin white plastic bag',
    'art-16a': 'shared electric scooters',
    'l1-14': 'garden shears',
    'l1-15': 'librarian',
    'l1-16': 'fuel nozzle',
    'l1-17': 'soapy sponge',
    'l1-19': 'clinic waiting room',
    'l1-20': 'gray sofa',
    'l1-21': 'metal tongs',
    'l1-22': 'striped fabric awning',
    'l1-24': 'long-handled roller',
    'l1-25': 'six framed pictures',
}

req = urllib.request.Request(SHARE, headers={'User-Agent': 'Mozilla/5.0'})
html = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
with open(OUT + r'\share_new.html', 'w', encoding='utf-8') as f:
    f.write(html)

# token stream: markers / keywords / sediment ids, in order of appearance
pats = [('MARK', re.escape('ONE new standalone image'))]
pats += [(k, re.escape(v)) for k, v in KEYS.items()]
pats.append(('SED', r'sediment://file_[0-9a-f]+'))
big = re.compile('|'.join('(?P<%s>%s)' % (n.replace('-', '_'), p) for n, p in pats))

seq = []
for m in big.finditer(html):
    name = m.lastgroup.replace('_', '-', 1) if m.lastgroup.startswith(('art', 'l1')) else m.lastgroup
    val = m.group(0)[11:] if m.lastgroup == 'SED' else ''
    if seq and seq[-1] == (name, val):
        continue
    seq.append((name, val))

print('tokens:', len(seq))
for i, (n, v) in enumerate(seq):
    print('%3d %-8s %s' % (i, n, v))
