/* 從 SVG 產生全站的網站圖示(2026-11-05,搜尋結果上的網站圖示是灰色地球)。
   Google 搜尋結果的網站圖示支援 BMP、GIF、ICO、PNG、JPEG、PPM、TIFF,不支援 SVG,建議大於 48×48;
   所以除了 img/favicon.svg,還要有點陣圖。檔名固定(Google 要求圖示網址不要常換),之後換 logo 只要再跑一次。
   產出(--out 底下,預設網站根目錄):
     favicon.ico                    16、32、48(32 位元 BMP,透明的地方照留)
     img/favicon-48.png、favicon-96.png、favicon-192.png   透明的地方照留;PNG 裡記下來源 SVG 的雜湊(tools/test_seo.js 用它確認跟 img/favicon.svg 是同一張)
     img/favicon.svg                輸入的 SVG 複製一份(本來就是它就不動)
     img/icon-180.png               apple-touch-icon:鋪滿底色、沒有透明通道(透明的地方在 iPhone 上會變黑)
     img/icon-192.png、icon-512.png  manifest 用,鋪滿底色
     img/icon-maskable-512.png      manifest 的 maskable:有給 --maskable 就用那張;沒給就把 App 圖縮進安全區(中間直徑 80% 的圓),四周補底色
     App 圖示四張的 PNG 裡記同一個組合記號(App 圖、maskable、底色),tools/test_seo.js 用它確認四張是同一次產生的。
   所有檔先在記憶體裡做好、檢查都過了才寫(先寫成暫存檔再改名蓋過去);maskable 安全區不過就整批不寫,網站上的圖示不會新舊混在一起。
   算圖用本機的 Chrome 無頭模式(跟 tools/check_layout.js 一樣不用裝套件),所有尺寸畫在同一頁、開一次 Chrome 再切開;
   每個尺寸直接用 Chrome 畫成那個大小,不是大圖縮小(跟瀏覽器分頁畫 SVG 的方式一樣)。Chrome 的使用者資料放在 --tmp 底下,用完就刪。
   用法:
     node tools/build_icons.js <favicon.svg> [--app <App 圖示.svg>] [--apple <滿版.svg>] [--maskable <maskable.svg>] [--bg '#0b72c4'] [--only favicon|app] [--out <資料夾>] [--tmp <資料夾>]
       --app       apple-touch-icon 與 manifest 另用一張(例如有白底、有速度線的版本);沒給就用 favicon 那張
       --apple     apple-touch-icon(icon-180)另用一張(要鋪滿、不透明的正方形,例如 logo_full.svg);沒給就跟 --app 同一張
       --maskable  maskable 另用一張(要自己留好安全邊界,程式會檢查);沒給就自動縮
       --bg        App 圖示鋪的底色;沒給就取 App 圖上緣正中間的顏色,那裡透明就用白色
       --only      只產 favicon 系列(favicon.ico、favicon-*.png、favicon.svg)或只產 App 系列(icon-*.png)
       --out       寫到別的資料夾試跑,不動網站
       --tmp       Chrome 暫存資料放哪(預設系統暫存)
   例:換正式 logo
     node tools/build_icons.js <logo資料夾>/favicon.svg --app <logo資料夾>/app_icon.svg --maskable <logo資料夾>/app_icon_maskable.svg --tmp <暫存資料夾>
   換完跑 node tools/test_seo.js;PNG、ICO 不算網頁檔案,sw.js 的 V 不用換(圖片是先給快取、背景更新)。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
const FAVICON_PNG = [48, 96, 192];
const ICO_SIZES = [16, 32, 48];
const SAFE = 0.4;   // maskable 安全區:半徑是邊長的 40%

/* ---------- PNG(8 位元、不交錯) ---------- */
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}
function chunks(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('不是 PNG');
  const out = [];
  for (let pos = 8; pos + 8 <= buf.length;) {
    const len = buf.readUInt32BE(pos);
    out.push({ type: buf.toString('latin1', pos + 4, pos + 8), data: buf.subarray(pos + 8, pos + 8 + len) });
    pos += 12 + len;
  }
  return out;
}
/* 讀成 { w, h, data: RGBA } */
function decodePng(buf) {
  const cs = chunks(buf);
  const ih = cs.find((c) => c.type === 'IHDR').data;
  const w = ih.readUInt32BE(0), h = ih.readUInt32BE(4), depth = ih[8], ctype = ih[9];
  if (depth !== 8 || ih[12] !== 0) throw new Error('只讀 8 位元、不交錯的 PNG');
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error('不支援的 PNG 色彩型態 ' + ctype);
  const raw = zlib.inflateSync(Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride), prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[i - ch] : 0, b = prev ? prev[i] : 0, c = prev && i >= ch ? prev[i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[i] = v & 255;
    }
  }
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ch === 4) px.copy(data, i * 4, i * 4, i * 4 + 4);
    else if (ch === 3) data.set([px[i * 3], px[i * 3 + 1], px[i * 3 + 2], 255], i * 4);
    else if (ch === 2) data.set([px[i * 2], px[i * 2], px[i * 2], px[i * 2 + 1]], i * 4);
    else data.set([px[i], px[i], px[i], 255], i * 4);
  }
  return { w, h, data };
}
/* 寫 PNG:opaque 就存 RGB(沒有透明通道);source 寫進 tEXt 的 Source。每列挑一種濾波(總和最小的),檔案小一點 */
function encodePng(img, opts) {
  const o = opts || {};
  const ch = o.opaque ? 3 : 4, stride = img.w * ch;
  const px = Buffer.alloc(img.h * stride);
  for (let i = 0; i < img.w * img.h; i++) for (let k = 0; k < ch; k++) px[i * ch + k] = img.data[i * 4 + k];
  const raw = Buffer.alloc(img.h * (stride + 1));
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < img.h; y++) {
    const cur = px.subarray(y * stride, (y + 1) * stride), prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? cur[i - ch] : 0, b = prev ? prev[i] : 0, c = prev && i >= ch ? prev[i - ch] : 0;
        let p = 0;
        if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (cur[i] - p) & 255;
        cand[f][i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = o.opaque ? 2 : 6;
  const parts = [SIG, chunk('IHDR', ihdr)];
  if (o.source) parts.push(chunk('tEXt', Buffer.concat([Buffer.from('Source\0', 'latin1'), Buffer.from(String(o.source), 'latin1')])));
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
function readSourceTag(buf) {
  const t = chunks(buf).find((c) => c.type === 'tEXt' && c.data.toString('latin1').indexOf('Source\0') === 0);
  return t ? t.data.toString('latin1').slice(7) : null;
}
/* 來源 SVG 的記號:換行統一成 \n 再算 sha256(Windows 取出來是 CRLF 也一樣) */
const lf = (s) => String(s).replace(/\r\n/g, '\n');
function sourceTag(svgText) {
  return 'build_icons sha256:' + crypto.createHash('sha256').update(lf(svgText)).digest('hex');
}
/* App 圖示四張(180、192、512、maskable)共用的記號:App 圖、maskable(沒給是自動縮)、底色的組合。
   tools/test_seo.js 用它確認四張是同一次產生的,不是新舊混在一起 */
function appTag(appSvg, maskSvg, bg, appleSvg) {
  const parts = [lf(appSvg), maskSvg == null ? '(auto)' : lf(maskSvg), bg.join(',')];
  if (appleSvg != null && lf(appleSvg) !== lf(appSvg)) parts.push(lf(appleSvg));   // 沒另給 apple 圖的組合記號跟以前一樣
  return 'build_icons app sha256:' + crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
}

/* ---------- ICO(每個尺寸一張 32 位元 BMP,加上 1 位元的透明遮罩) ---------- */
function writeIco(imgs) {
  const dir = Buffer.alloc(6 + 16 * imgs.length);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(imgs.length, 4);
  let off = dir.length;
  const bodies = imgs.map((im, k) => {
    if (im.w !== im.h || im.w > 256) throw new Error('ICO 只放 256 以內的正方形');
    const maskRow = Math.ceil(im.w / 32) * 4, xor = im.w * im.h * 4, and = maskRow * im.h;
    const b = Buffer.alloc(40 + xor + and);
    b.writeUInt32LE(40, 0); b.writeInt32LE(im.w, 4); b.writeInt32LE(im.h * 2, 8); b.writeUInt16LE(1, 12); b.writeUInt16LE(32, 14); b.writeUInt32LE(xor + and, 20);
    for (let y = 0; y < im.h; y++) {
      const row = im.h - 1 - y;   // BMP 由下往上
      for (let x = 0; x < im.w; x++) {
        const s = (row * im.w + x) * 4, d = 40 + (y * im.w + x) * 4;
        b[d] = im.data[s + 2]; b[d + 1] = im.data[s + 1]; b[d + 2] = im.data[s]; b[d + 3] = im.data[s + 3];
        if (im.data[s + 3] === 0) b[40 + xor + y * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    const e = 6 + 16 * k;
    dir[e] = im.w & 255; dir[e + 1] = im.h & 255; dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(b.length, e + 8); dir.writeUInt32LE(off, e + 12);
    off += b.length;
    return b;
  });
  return Buffer.concat([dir].concat(bodies));
}
function readIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('不是 ICO');
  const out = [];
  for (let k = 0; k < buf.readUInt16LE(4); k++) {
    const e = 6 + 16 * k, size = buf.readUInt32LE(e + 8), off = buf.readUInt32LE(e + 12);
    const body = buf.subarray(off, off + size);
    if (body.subarray(0, 8).equals(SIG)) { const im = decodePng(body); out.push(Object.assign(im, { bpp: 32, png: true })); continue; }
    const w = body.readInt32LE(4), h = body.readInt32LE(8) / 2, bpp = body.readUInt16LE(14);
    if (bpp !== 32) { out.push({ w, h, bpp, data: null }); continue; }
    const data = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = 40 + (y * w + x) * 4, d = ((h - 1 - y) * w + x) * 4;
      data[d] = body[s + 2]; data[d + 1] = body[s + 1]; data[d + 2] = body[s]; data[d + 3] = body[s + 3];
    }
    out.push({ w, h, bpp, data });
  }
  return out;
}

/* ---------- 圖的小工具 ---------- */
/* SVG 要有正方形的 viewBox(img 裡縮放才準);回傳 viewBox 的邊長 */
function svgSquare(text) {
  const tag = /<svg\b[^>]*>/.exec(String(text));
  if (!tag) throw new Error('不是 SVG 檔');
  const vb = /\bviewBox\s*=\s*"([^"]+)"/.exec(tag[0]);
  if (!vb) throw new Error('SVG 要有 viewBox,縮放才準');
  const n = vb[1].trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || n.some((v) => !isFinite(v)) || n[2] <= 0) throw new Error('看不懂 viewBox:' + vb[1]);
  if (Math.abs(n[2] - n[3]) > 1e-6) throw new Error('圖示要正方形,viewBox 是 ' + n[2] + '×' + n[3]);
  return n[2];
}
const hex = (s) => { const m = /^#([0-9a-f]{6})$/i.exec(s); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
/* 把有透明的圖鋪到底色上(結果不透明) */
function flatten(img, bg) {
  const data = Buffer.alloc(img.data.length);
  for (let i = 0; i < img.w * img.h; i++) {
    const a = img.data[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round(img.data[i * 4 + k] * a + bg[k] * (1 - a));
    data[i * 4 + 3] = 255;
  }
  return { w: img.w, h: img.h, data };
}
/* 面積平均縮小(含透明度,先乘 alpha 再平均) */
function shrink(img, n) {
  const out = Buffer.alloc(n * n * 4), s = img.w / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const ax = i * s, bx = ax + s, ay = j * s, by = ay + s;
    let r = 0, g = 0, b = 0, a = 0, wsum = 0;
    for (let y = Math.floor(ay); y < Math.ceil(by); y++) {
      const wy = Math.min(by, y + 1) - Math.max(ay, y); if (wy <= 0) continue;
      for (let x = Math.floor(ax); x < Math.ceil(bx); x++) {
        const wx = Math.min(bx, x + 1) - Math.max(ax, x); if (wx <= 0) continue;
        const p = (y * img.w + x) * 4, w = wx * wy, al = img.data[p + 3] / 255;
        r += img.data[p] * al * w; g += img.data[p + 1] * al * w; b += img.data[p + 2] * al * w; a += al * w; wsum += w;
      }
    }
    const o = (j * n + i) * 4;
    out[o] = a ? Math.round(r / a) : 0; out[o + 1] = a ? Math.round(g / a) : 0; out[o + 2] = a ? Math.round(b / a) : 0; out[o + 3] = Math.round(a / wsum * 255);
  }
  return { w: n, h: n, data: out };
}
const differs = (d, i, c) => Math.abs(d[i] - c[0]) > 16 || Math.abs(d[i + 1] - c[1]) > 16 || Math.abs(d[i + 2] - c[2]) > 16;
/* maskable 的安全區:中間直徑 80% 的圓外面要全是同一個底色(取左上角),而且不透明。沒問題回傳 null */
function safeZoneProblem(img) {
  const n = img.w, c = n / 2, r = SAFE * n, bg = [img.data[0], img.data[1], img.data[2]];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (Math.hypot(x + 0.5 - c, y + 0.5 - c) <= r) continue;
    const i = (y * n + x) * 4;
    if (img.data[i + 3] !== 255) return '(' + x + ',' + y + ') 透明';
    if (differs(img.data, i, bg)) return '(' + x + ',' + y + ') 不是底色';
  }
  return null;
}
/* 自動 maskable:App 圖鋪上底色,量出跟底色不一樣的部分離中心最遠多少,縮到安全區裡(本來就在裡面就不縮),四周補底色 */
function maskable(art, bg) {
  const n = art.w, flat = flatten(art, bg), c = n / 2;
  let far = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (differs(flat.data, (y * n + x) * 4, bg)) far = Math.max(far, Math.hypot(x + 0.5 - c, y + 0.5 - c));
  }
  const scale = far ? Math.min(1, (SAFE * n - 2) / (far + 1)) : 1;
  const out = { w: n, h: n, data: Buffer.alloc(n * n * 4) };
  for (let i = 0; i < n * n; i++) out.data.set([bg[0], bg[1], bg[2], 255], i * 4);
  const small = scale < 1 ? flatten(shrink(flat, Math.max(1, Math.round(n * scale))), bg) : flat;
  const o = Math.floor((n - small.w) / 2);
  for (let y = 0; y < small.h; y++) small.data.copy(out.data, ((y + o) * n + o) * 4, y * small.w * 4, (y + 1) * small.w * 4);
  return out;
}

/* ---------- Chrome 算圖:所有 { svg, size } 畫在同一頁(透明底),截一張圖再切開 ---------- */
function render(jobs, tmpRoot) {
  if (!CHROME) throw new Error('找不到 Chrome 或 Edge');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'icons-'));
  try {
    let x = 0;
    const pos = jobs.map((j) => { const p = x; x += j.size + 4; return p; });
    const W = x, H = Math.max(...jobs.map((j) => j.size));
    const imgs = jobs.map((j, k) => '<img alt="" src="data:image/svg+xml;base64,' + Buffer.from(j.svg).toString('base64') +
      '" style="left:' + pos[k] + 'px;width:' + j.size + 'px;height:' + j.size + 'px">').join('');
    const page = path.join(dir, 'page.html'), shot = path.join(dir, 'shot.png');
    fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}' +
      'img{position:absolute;top:0;display:block}</style></head><body>' + imgs + '</body></html>');
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--user-data-dir=' + path.join(dir, 'ud'), '--window-size=' + W + ',' + H, '--force-device-scale-factor=1', '--default-background-color=00000000',
      '--screenshot=' + shot, 'file:///' + page.split(path.sep).join('/')], { stdio: 'ignore', timeout: 120000 });
    if (!fs.existsSync(shot)) throw new Error('Chrome 沒有截到圖');
    const all = decodePng(fs.readFileSync(shot));
    if (all.w !== W || all.h !== H) throw new Error('Chrome 截圖是 ' + all.w + '×' + all.h + ',應該是 ' + W + '×' + H);
    return jobs.map((j, k) => {
      const n = j.size, data = Buffer.alloc(n * n * 4);
      for (let y = 0; y < n; y++) all.data.copy(data, y * n * 4, (y * W + pos[k]) * 4, (y * W + pos[k] + n) * 4);
      return { w: n, h: n, data };
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------- 參數與主程式 ---------- */
const USAGE = "用法:node tools/build_icons.js <favicon.svg> [--app <App 圖示.svg>] [--apple <滿版.svg>] [--maskable <maskable.svg>] [--bg '#rrggbb'] [--only favicon|app] [--out <資料夾>] [--tmp <資料夾>]";
function parseArgs(argv) {
  const o = { svg: null, app: null, apple: null, maskable: null, bg: null, only: null, out: null, tmp: null };
  const keys = { '--app': 'app', '--apple': 'apple', '--maskable': 'maskable', '--bg': 'bg', '--only': 'only', '--out': 'out', '--tmp': 'tmp' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (keys[a]) { if (i + 1 >= argv.length) throw new Error(a + ' 後面要接值\n' + USAGE); o[keys[a]] = argv[++i]; }
    else if (/^--/.test(a)) throw new Error('不認得的參數 ' + a + '\n' + USAGE);
    else if (o.svg) throw new Error('只能給一張 favicon SVG\n' + USAGE);
    else o.svg = a;
  }
  if (!o.svg) throw new Error(USAGE);
  if (o.only && ['favicon', 'app'].indexOf(o.only) < 0) throw new Error('--only 只能是 favicon 或 app');
  if (o.bg && !hex(o.bg)) throw new Error("--bg 要寫成 '#0b72c4' 這樣");
  return o;
}
function readSvg(file) {
  const text = fs.readFileSync(file, 'utf8');
  svgSquare(text);
  return text;
}
function main(argv, deps) {
  const d = Object.assign({ render, log: console.log }, deps);
  const o = parseArgs(argv);
  const out = path.resolve(o.out || REPO), tmp = path.resolve(o.tmp || os.tmpdir());
  const fav = readSvg(o.svg);
  const doFav = o.only !== 'app', doApp = o.only !== 'favicon';
  const app = doApp ? (o.app ? readSvg(o.app) : fav) : null;
  const apple = doApp && o.apple ? readSvg(o.apple) : app;
  const mask = doApp && o.maskable ? readSvg(o.maskable) : null;
  const jobs = [];
  if (doFav) ICO_SIZES.concat(FAVICON_PNG).forEach((n) => jobs.push({ key: 'f' + n, svg: fav, size: n }));
  if (doApp) [180, 192, 512].forEach((n) => jobs.push({ key: 'a' + n, svg: n === 180 ? apple : app, size: n }));
  if (mask) jobs.push({ key: 'm512', svg: mask, size: 512 });
  const got = {};
  d.render(jobs, tmp).forEach((im, k) => { got[jobs[k].key] = im; });
  /* 每個檔先在記憶體裡做好、檢查都過了才寫:maskable 安全區不過時網站上的圖示一個都不動,不會新舊混在一起 */
  const files = [];
  const put = (rel, buf) => files.push({ rel, buf });
  let bg = null;
  if (doFav) {
    const tag = sourceTag(fav);
    put('favicon.ico', writeIco(ICO_SIZES.map((n) => got['f' + n])));
    FAVICON_PNG.forEach((n) => put('img/favicon-' + n + '.png', encodePng(got['f' + n], { source: tag })));
    const dest = path.join(out, 'img', 'favicon.svg');
    if (path.resolve(o.svg) !== dest && !(fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === fav)) put('img/favicon.svg', Buffer.from(fav));
  }
  if (doApp) {
    const a = got.a512, top = (2 * a.w + a.w / 2) * 4;
    bg = o.bg ? hex(o.bg) : a.data[top + 3] === 255 ? [a.data[top], a.data[top + 1], a.data[top + 2]] : [255, 255, 255];
    const m = mask ? flatten(got.m512, bg) : maskable(a, bg);
    const bad = safeZoneProblem(m);
    if (bad) throw new Error('maskable 安全區(中間直徑 80% 的圓)外有圖案:' + bad + '。換一張留好邊界的 --maskable,或拿掉 --maskable 讓程式自動縮。沒有寫入任何檔案');
    const tag = appTag(app, mask, bg, apple);
    [180, 192, 512].forEach((n) => put('img/icon-' + n + '.png', encodePng(flatten(got['a' + n], bg), { opaque: true, source: tag })));
    put('img/icon-maskable-512.png', encodePng(m, { opaque: true, source: tag }));
  }
  writeAll(out, files);
  if (bg) d.log('App 圖示底色 #' + bg.map((v) => v.toString(16).padStart(2, '0')).join(''));
  d.log('寫入 ' + out + ':\n  ' + files.map((f) => f.rel + '(' + f.buf.length.toLocaleString('en-US') + ' bytes)').join('\n  '));
}
/* 先全部寫成同資料夾裡的暫存檔,都寫成功才改名蓋過去;寫到一半失敗就刪掉暫存檔,原本的圖示不動 */
function writeAll(out, files) {
  const stamp = '.build_icons-' + process.pid + '.tmp';
  const list = files.map((f) => { const dest = path.join(out, f.rel); return { dest, tmp: dest + stamp, buf: f.buf }; });
  /* 刪掉自己寫的暫存檔(不是檔案的不碰);回傳刪不掉的,寫進錯誤訊息 */
  const clean = (js) => js.filter((j) => { try { if (fs.lstatSync(j.tmp).isFile()) fs.unlinkSync(j.tmp); return false; } catch (e) { return e.code !== 'ENOENT'; } });
  const leftNote = (js) => { const left = clean(js); return left.length ? '(這些暫存檔刪不掉,要手動刪:' + left.map((j) => j.tmp).join('、') + ')' : ''; };
  const started = [];
  try {
    list.forEach((j) => { fs.mkdirSync(path.dirname(j.dest), { recursive: true }); started.push(j); fs.writeFileSync(j.tmp, j.buf); });
  } catch (e) {
    throw new Error('寫暫存檔失敗,沒有換掉任何圖示:' + e.message + leftNote(started));
  }
  let k = 0;
  try {
    for (; k < list.length; k++) fs.renameSync(list[k].tmp, list[k].dest);
  } catch (e) {
    throw new Error('換 ' + path.relative(out, list[k].dest) + ' 時失敗(' + e.message + '),前面 ' + k + ' 個已經換掉,排除原因後重跑一次' + leftNote(list.slice(k)));
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { main, appTag, decodePng, encodePng, readSourceTag, sourceTag, writeIco, readIco, svgSquare, flatten, shrink, maskable, safeZoneProblem, parseArgs, render };
