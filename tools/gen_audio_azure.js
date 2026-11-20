/* 用 Azure AI Speech（REST）產全站音檔。不需要安裝套件；需要 ffmpeg。
   金鑰只從環境變數 AZURE_SPEECH_KEY、AZURE_SPEECH_REGION 讀（讀不到時再讀 Windows 使用者環境變數）；
   任何輸出、紀錄檔都不含金鑰。
   用法：
     node tools/gen_audio_azure.js --dry-run [--category p3,p4] [--only l3-11,l4-*] [--verbose]
     node tools/gen_audio_azure.js --list-voices            把這個區域的聲音存成 audio_voices_list.json 並核對設定的聲音
     node tools/gen_audio_azure.js [--category ...] [--only ...] [--out audio_azure] [--force] [--max-chars N]
   類別：p1 p2 p3 p4 dictation pairs numbers shadow zh dialogue phonics-word phonics-sentence，或群組 listening ear phonics。
   輸出到 --out（預設 audio_azure/，不碰 audio/）；已存在就跳過，--force 重產。
   每檔寫一行到 <out>/manifest.jsonl。多段檔在 PCM 階段接靜音，最後只編碼一次 mp3（24 kHz、48 kbps、單聲道）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const W = require('./audio_worklist.js');

const ENGINE_TAG = 'azure-neural-tts';
const BYTES_PER_SEC = 24000 * 2;

/* ---------- 引數 ---------- */
function parseArgs(argv) {
  const o = { _: [] };
  const withValue = new Set(['category', 'only', 'out', 'max-chars', 'voices-out', 'worklist-out', 'voices-config', 'limit']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (withValue.has(k)) o[k] = argv[++i]; else o[k] = true;
  }
  return o;
}

/* ---------- 金鑰：絕不印出 ---------- */
function readRegistry(name) {
  if (process.platform !== 'win32') return '';
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = new RegExp('^\\s*' + name + '\\s+REG_(?:EXPAND_)?SZ\\s+(.*?)\\s*$', 'mi').exec(out);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}
function loadCredentials(env, regReader) {
  const get = (n) => (env[n] && String(env[n]).trim()) || (regReader ? String(regReader(n) || '').trim() : '');
  return { key: get('AZURE_SPEECH_KEY'), region: get('AZURE_SPEECH_REGION') };
}
const MISSING_MSG = '找不到 Azure 語音的金鑰或區域。請在 Windows「編輯系統環境變數」的使用者變數裡新增 AZURE_SPEECH_KEY 與 AZURE_SPEECH_REGION'
  + '（區域例如 eastus、southeastasia；金鑰請從 Azure 入口網站複製，不要貼到聊天或檔案），存好後重開終端機或桌面程式再執行。';

function makeRedactor(secrets) {
  const list = secrets.filter((s) => s && s.length >= 8);
  return (text) => {
    let t = String(text);
    for (const s of list) t = t.split(s).join('***');
    return t;
  };
}

/* ---------- WAV 與靜音 ---------- */
function wavToPcm(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('回傳的不是 WAV（' + buf.length + ' 位元組）');
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'data') {
      const end = size === 0 || size === 0xFFFFFFFF || p + 8 + size > buf.length ? buf.length : p + 8 + size;
      return buf.subarray(p + 8, end);
    }
    p += 8 + size + (size % 2);
  }
  throw new Error('WAV 找不到 data 區塊');
}
const silencePcm = (ms) => Buffer.alloc(Math.round((ms / 1000) * 24000) * 2);

/* ---------- 預設相依（測試會換掉）---------- */
function defaultDeps() {
  return {
    fetch: (...a) => fetch(...a),
    env: process.env,
    readRegistry,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
    log: (s) => process.stdout.write(s + '\n'),
    /* 單一 ffmpeg 呼叫：stdin 給位元組，回傳 stdout 位元組 */
    ffmpeg: (args, input) => new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const out = [], err = [];
      p.stdout.on('data', (c) => out.push(c));
      p.stderr.on('data', (c) => err.push(c));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg 失敗：' + Buffer.concat(err).toString('utf8').slice(-200)))));
      p.stdin.on('error', () => {});
      p.stdin.end(input);
    }),
  };
}
const MP3_ARGS = ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
  '-c:a', 'libmp3lame', '-b:a', '48k', '-ar', '24000', '-ac', '1', '-f', 'mp3', 'pipe:1'];

/* ---------- Azure 呼叫 ---------- */
function makeClient(ctx) {
  const { deps, cfg, key, region, redact } = ctx;
  const base = 'https://' + region + '.tts.speech.microsoft.com/cognitiveservices/';
  let fatalErr = null, lastStart = 0, chain = Promise.resolve();
  /* 每次請求之間至少隔 intervalMs（所有工作共用） */
  const throttle = () => {
    const turn = chain.then(async () => {
      const wait = lastStart + cfg.request.intervalMs - Date.now();
      if (wait > 0) await deps.sleep(wait);
      lastStart = Date.now();
    });
    chain = turn.catch(() => {});
    return turn;
  };
  async function call(url, init, what) {
    const r = cfg.request;
    let lastErr;
    if (fatalErr) throw fatalErr;
    for (let attempt = 0; attempt <= r.maxRetries; attempt++) {
      await throttle();
      if (fatalErr) throw fatalErr;
      try {
        const res = await deps.fetch(url, Object.assign({ signal: AbortSignal.timeout(r.timeoutMs) }, init));
        if (res.ok) return res;
        const body = redact(String(await res.text().catch(() => '')).slice(0, 200));
        const err = new Error(what + ' 失敗：HTTP ' + res.status + (body ? ' ' + body : ''));
        err.status = res.status;
        if (res.status === 401 || res.status === 403) { err.fatal = true; err.message = what + ' 被拒絕（HTTP ' + res.status + '），請檢查金鑰與區域是否正確。'; fatalErr = err; throw err; }
        if (res.status !== 429 && res.status < 500) { err.fatal = false; err.noRetry = true; throw err; }
        lastErr = err;
        const ra = parseFloat(res.headers && res.headers.get ? res.headers.get('retry-after') : '');
        const back = Math.min(r.backoffMaxMs, r.backoffBaseMs * Math.pow(2, attempt));
        await deps.sleep(res.status === 429 && ra > 0 ? Math.min(r.backoffMaxMs, ra * 1000) : back);
      } catch (e) {
        if (e.fatal || e.noRetry) throw e;
        lastErr = new Error(what + ' 連線失敗：' + redact(e.message));
        await deps.sleep(Math.min(r.backoffMaxMs, r.backoffBaseMs * Math.pow(2, attempt)));
      }
    }
    throw lastErr || new Error(what + ' 失敗');
  }
  return {
    async synth(seg) {
      const res = await call(base + 'v1', {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': cfg.output.format,
          'User-Agent': 'rushup-audio-tool',
        },
        body: W.ssmlFor(seg),
      }, '合成');
      return Buffer.from(await res.arrayBuffer());
    },
    async listVoices() {
      const res = await call(base + 'voices/list', { method: 'GET', headers: { 'Ocp-Apim-Subscription-Key': key } }, '聲音清單');
      return JSON.parse(await res.text());
    },
  };
}

/* ---------- 一個檔：合成、校準語速、串接、編碼 ---------- */
async function produce(item, ctx) {
  const { client, cfg, deps } = ctx;
  let cur = item, rate = item.segments.find((s) => s.text !== undefined).rate, attempts = 0, billed = 0;
  const target = item.speed;
  let pcm, seconds, wpm = null, speedOk = null, note = '';
  for (let round = 0; ; round++) {
    const parts = [];
    for (const seg of cur.segments) {
      if (seg.text === undefined) { parts.push(silencePcm(seg.gapMs)); continue; }
      if (ctx.spent + billed + seg.text.length > ctx.maxChars) { const e = new Error('累計字元超過上限 ' + ctx.maxChars); e.budget = true; throw e; }
      const wav = await client.synth(seg);
      parts.push(wavToPcm(wav));
      billed += W.azureChars(seg.text) + W.escXml(seg.text).length - seg.text.length + W.rateTagLen(seg.rate);
      attempts++;
    }
    pcm = Buffer.concat(parts);
    seconds = Math.round((pcm.length / BYTES_PER_SEC) * 100) / 100;
    if (!target || !item.words) break;
    wpm = Math.round((item.words / seconds) * 6000) / 100;
    speedOk = wpm >= target.min && wpm <= target.max;
    if (speedOk) break;
    if (round >= cfg.speed.maxRetries) { note = '語速校準 ' + cfg.speed.maxRetries + ' 次後仍不在 ' + target.min + '-' + target.max; break; }
    const nr = W.nextRate(rate, wpm, target.aim, cfg);
    if (nr === rate) { note = '語速已到上下限 ' + rate + '，建議換聲音'; break; }
    rate = nr;
    cur = W.withRate(item, rate);
  }
  if (!pcm.length || seconds < 0.2) throw new Error('合成結果是空的');
  const mp3 = await deps.ffmpeg(MP3_ARGS, pcm);
  if (!mp3 || mp3.length < 500) throw new Error('mp3 編碼結果太小');
  return { mp3, seconds, wpm, speedOk, rate, note, attempts, billed, voices: item.voices };
}

/* ---------- 主流程 ---------- */
function selectItems(args, cfg) {
  const all = W.build(W.REPO, cfg);
  let list = W.filterItems(all, { category: args.category, only: args.only });
  if (args.limit) list = list.slice(0, parseInt(args.limit, 10));
  return { all, list };
}
const fmt = (n) => n.toLocaleString('en-US');

function dryRun(args, cfg, deps, outDir) {
  const { all, list } = selectItems(args, cfg);
  const existing = (it) => fs.existsSync(path.join(outDir, it.file));
  const todo = args.force ? list : list.filter((it) => !existing(it));
  const S = W.summarize(todo);
  deps.log('【乾跑】不連線。輸出資料夾 ' + outDir + '；選到 ' + list.length + ' 個檔，其中 ' + (list.length - todo.length) + ' 個已存在會跳過，要產 ' + todo.length + ' 個。');
  if (args.verbose || todo.length <= 20) {
    for (const it of todo) {
      deps.log('- ' + it.file + '  [' + it.category + '] ' + it.voices.join(' / ') + '  ' + it.segments.find((s) => s.text !== undefined).rate
        + '  字元 ' + it.billChars + '+' + it.ssmlChars + (it.speed ? '  目標 ' + it.speed.aim + ' wpm' : ''));
      if (args.verbose) it.segments.forEach((s) => deps.log('    ' + (s.text === undefined ? '（靜音 ' + s.gapMs + ' ms）' : W.ssmlFor(s))));
    }
  }
  deps.log('類別\t檔數\t請求\t文字字元\tSSML標記\t合計');
  for (const [c, v] of Object.entries(S.cats)) deps.log([c, v.files, v.requests, fmt(v.billChars), fmt(v.ssmlChars), fmt(v.billChars + v.ssmlChars)].join('\t'));
  const t = S.total, sum = t.billChars + t.ssmlChars;
  deps.log(['合計', t.files, t.requests, fmt(t.billChars), fmt(t.ssmlChars), fmt(sum)].join('\t'));
  deps.log('估價（每百萬字元 ' + cfg.pricePerMillionChars + ' 美元）：' + W.usd(sum, cfg) + ' 美元；若跳脫字元（&apos; 等）也計費，上限 '
    + W.usd(sum + t.escExtraChars, cfg) + ' 美元（多 ' + fmt(t.escExtraChars) + ' 字元）。語速校準重產另計，Part 3、4 最多再 ' + cfg.speed.maxRetries + ' 輪。');
  const q = W.quotaReport(all, cfg);
  for (const [c, r] of Object.entries(q)) {
    deps.log(c + ' 配額 口音 ' + Object.entries(r.accentPct).map(([a, p]) => a + ' ' + p + '%').join('、') + '；性別 男 ' + r.genderPct.M + '% 女 ' + r.genderPct.F + '%' + (r.problems.length ? '  超出容差：' + r.problems.join('、') : '  通過'));
  }
  if (args['worklist-out']) {
    const out = todo.map((it) => ({ id: it.id, file: it.file, category: it.category, voices: it.voices, requests: it.requests, billChars: it.billChars,
      ssmlChars: it.ssmlChars, words: it.words, target: it.speed, segments: it.segments.map((s) => (s.text === undefined ? s : Object.assign({ ssml: W.ssmlFor(s) }, s))) }));
    fs.writeFileSync(args['worklist-out'], JSON.stringify(out, null, 1));
    deps.log('工作清單已寫到 ' + args['worklist-out']);
  }
  return { list, todo, summary: S, quota: q };
}

async function listVoices(args, cfg, deps, creds, redact) {
  const client = makeClient({ deps, cfg, key: creds.key, region: creds.region, redact });
  const voices = await client.listVoices();
  const slim = voices.map((v) => ({ ShortName: v.ShortName, Locale: v.Locale, Gender: v.Gender, VoiceType: v.VoiceType, Status: v.Status, LocaleName: v.LocaleName }));
  const outPath = args['voices-out'] || path.join(W.REPO, 'audio_voices_list.json');
  fs.writeFileSync(outPath, JSON.stringify({ region: creds.region, fetched: deps.now().toISOString(), count: slim.length, voices: slim }, null, 1));
  const names = new Set(slim.map((v) => v.ShortName));
  const wanted = new Set();
  for (const a of Object.values(cfg.listeningPools)) for (const g of Object.values(a)) g.forEach((v) => wanted.add(v));
  for (const k of ['US', 'US2', 'GB', 'AU']) Object.values(cfg.legacy[k]).forEach((v) => wanted.add(v));
  [cfg.legacy.zh, cfg.legacy.phonics, cfg.legacy.phonicsAlt].forEach((v) => wanted.add(v));
  const missing = [...wanted].filter((v) => !names.has(v));
  deps.log('區域 ' + creds.region + ' 共 ' + slim.length + ' 個聲音，已存到 ' + outPath);
  deps.log(missing.length ? '設定裡有 ' + missing.length + ' 個聲音在這個區域找不到：' + missing.join('、') : '設定裡的 ' + wanted.size + ' 個聲音都找得到。');
  const ca = slim.filter((v) => v.Locale === 'en-CA').map((v) => v.ShortName);
  deps.log('en-CA 聲音：' + (ca.join('、') || '（無）'));
  return { count: slim.length, missing };
}

async function generate(args, cfg, deps, creds, redact, outDir) {
  const { all, list } = selectItems(args, cfg);
  const q = W.quotaReport(all, cfg);
  const bad = Object.entries(q).filter(([, r]) => r.problems.length);
  if (bad.length && !args['allow-quota-miss']) throw new Error('口音或性別配額超出容差：' + bad.map(([c, r]) => c + ' ' + r.problems.join('、')).join('；') + '（確認無誤可加 --allow-quota-miss）');
  fs.mkdirSync(outDir, { recursive: true });
  const todo = args.force ? list : list.filter((it) => { const p = path.join(outDir, it.file); return !(fs.existsSync(p) && fs.statSync(p).size > 500); });
  deps.log('選到 ' + list.length + ' 個檔，跳過已存在 ' + (list.length - todo.length) + '，要產 ' + todo.length + ' 個 → ' + outDir);
  const client = makeClient({ deps, cfg, key: creds.key, region: creds.region, redact });
  const maxChars = parseInt(args['max-chars'] || cfg.request.maxCharsPerRun, 10);
  const ctx = { client, cfg, deps, maxChars, spent: 0 };
  const manifest = path.join(outDir, 'manifest.jsonl');
  const stat = { ok: 0, fail: 0, slow: 0, failed: [] };
  let next = 0, stop = null;
  async function worker() {
    while (!stop) {
      const it = todo[next++];
      if (!it) return;
      try {
        const r = await produce(it, ctx);
        ctx.spent += r.billed;
        const dest = path.join(outDir, it.file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, r.mp3);
        const rec = { id: it.id, file: it.file, category: it.category, voices: r.voices, rate: r.rate, chars: it.billChars, billedChars: r.billed,
          seconds: r.seconds, words: it.words === undefined ? null : it.words, wpm: r.wpm, speedOk: r.speedOk, note: r.note || undefined,
          engine: ENGINE_TAG, format: cfg.output.format + '->mp3 24kHz 48kbps mono', date: deps.now().toISOString() };
        fs.appendFileSync(manifest, redact(JSON.stringify(rec)) + '\n');
        stat.ok++;
        if (r.speedOk === false) stat.slow++;
        if (stat.ok % 25 === 0) deps.log('  已完成 ' + stat.ok + ' / ' + todo.length);
      } catch (e) {
        if (e.fatal || e.budget) { stop = e; return; }
        stat.fail++; stat.failed.push(it.file + '：' + redact(e.message));
      }
    }
  }
  await Promise.all(Array.from({ length: cfg.request.concurrency }, worker));
  deps.log('完成 ' + stat.ok + ' 個，失敗 ' + stat.fail + ' 個，語速未達標 ' + stat.slow + ' 個；本次累計計費字元約 ' + fmt(ctx.spent));
  stat.failed.forEach((f) => deps.log('  失敗 ' + f));
  if (stop) deps.log('提早停止：' + redact(stop.message));
  return Object.assign(stat, { stopped: stop ? stop.message : null, spent: ctx.spent });
}

async function run(argv, depsIn) {
  const deps = Object.assign(defaultDeps(), depsIn || {});
  const args = parseArgs(argv);
  const cfg = W.loadVoices(args['voices-config']);
  const outDir = path.resolve(args.out || path.join(W.REPO, 'audio_azure'));
  if (args['dry-run']) { dryRun(args, cfg, deps, outDir); return 0; }
  const creds = loadCredentials(deps.env, deps.readRegistry);
  if (!creds.key || !creds.region) { deps.log(MISSING_MSG); return 3; }
  const redact = makeRedactor([creds.key]);
  try {
    if (args['list-voices']) { await listVoices(args, cfg, deps, creds, redact); return 0; }
    const r = await generate(args, cfg, deps, creds, redact, outDir);
    return r.fail || r.stopped ? 1 : 0;
  } catch (e) {
    deps.log('錯誤：' + redact(e.message));
    return 1;
  }
}

module.exports = { run, parseArgs, loadCredentials, wavToPcm, silencePcm, makeRedactor, MP3_ARGS, produce, makeClient };

if (require.main === module) {
  run(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error('錯誤：' + e.message.replace(/[0-9a-fA-F]{32,}/g, '***')); process.exit(1); });
}
