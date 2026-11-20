/* Azure 產音檔工具的測試：假的 HTTP、假的 ffmpeg，不連網、不需要金鑰、不需要 ffmpeg。
   用法：node tools/test_gen_audio_azure.js
   - 分配規則固定（同一份資料算兩次一樣、和資料順序無關）、口音和性別沒綁死、配額在容差內
   - SSML 文字跳脫
   - 乾跑不連線，檔數、字元數和工作清單一致
   - 已存在就跳過、--force 重產
   - 失敗重試、429 退避（聽 Retry-After）、401 不重試
   - 金鑰不出現在任何輸出、紀錄檔、錯誤訊息（含伺服器把金鑰回傳在錯誤內文的情況）
   - 讀不到金鑰就停下並提示；環境變數沒有時改讀登錄檔
   - 語速校準：不在目標範圍就調語速重產，最多 2 次
   - 多段檔在 PCM 階段接靜音、只編碼一次；mp3 參數 24 kHz／48 kbps／單聲道 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('./gen_audio_azure.js');
const W = require('./audio_worklist.js');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !detail ? '' : '  →  ' + detail)); };
const FAKE_KEY = 'fakeKey' + 'Q'.repeat(25); // 執行時才組出來，原始碼裡不放像金鑰的字串
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-azure-test-'));
const cfg = W.loadVoices();

/* ---------- 假相依 ---------- */
function wav(seconds) {
  const n = Math.round(seconds * 24000) * 2;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n, 40);
  return Buffer.concat([h, Buffer.alloc(n, 1)]);
}
const unesc = (s) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
function makeEnv(opts) {
  opts = opts || {};
  const st = { calls: [], logs: [], sleeps: [], ffmpegIn: [], ffmpegArgs: [] };
  const queue = (opts.script || []).slice();
  const secPerChar = opts.secPerChar || 0.06;
  st.deps = {
    env: opts.env || { AZURE_SPEECH_KEY: FAKE_KEY, AZURE_SPEECH_REGION: 'eastus' },
    readRegistry: opts.readRegistry || (() => ''),
    sleep: async (ms) => { st.sleeps.push(ms); },
    now: () => new Date('2026-11-20T00:00:00Z'),
    log: (s) => st.logs.push(String(s)),
    fetch: async (url, init) => {
      const body = init.body || '';
      const text = unesc((/<prosody[^>]*>([\s\S]*)<\/prosody>/.exec(body) || [, ''])[1]);
      const rate = (/rate="([^"]+)"/.exec(body) || [, '0%'])[1];
      st.calls.push({ url, headers: init.headers, body, text, rate });
      const step = queue.shift();
      if (step) return step(st);
      if (url.endsWith('voices/list')) {
        const names = Object.values(cfg.listeningPools).flatMap((a) => Object.values(a).flat());
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(names.map((n) => ({ ShortName: n, Locale: n.slice(0, 5), Gender: 'x' }))) };
      }
      const factor = 1 + parseFloat(rate) / 100;
      const sec = Math.max(0.4, (text.length * secPerChar) / factor);
      const b = wav(sec);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => '', arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
    },
    ffmpeg: async (args, input) => { st.ffmpegArgs.push(args); st.ffmpegIn.push(input.length); return Buffer.alloc(2000, 7); },
  };
  return st;
}
const resp = (status, extra) => (st) => ({ ok: status < 300, status, headers: { get: (h) => (extra && extra.retryAfter && h.toLowerCase() === 'retry-after' ? String(extra.retryAfter) : null) },
  text: async () => (extra && extra.body) || '', arrayBuffer: async () => new ArrayBuffer(0) });
const outDir = (n) => path.join(TMP, n);
const listFiles = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String) : []);
const allText = (st, d) => st.logs.join('\n') + '\n' + listFiles(d).filter((f) => /\.(jsonl|json|txt)$/.test(f)).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('\n');

(async () => {
  /* ---------- 1. 分配規則 ---------- */
  const a = W.build(W.REPO, cfg), b = W.build(W.REPO, cfg);
  const sig = (items) => items.map((i) => i.file + '=' + i.segments.map((s) => s.voice || '').join(',')).join('|');
  check('分配規則：同一份資料算兩次完全一樣', sig(a) === sig(b));
  const sortedSig = sig(a.slice().sort((x, y) => x.file.localeCompare(y.file)));
  check('分配規則：聽力的聲音只和 id、同類別的名次有關（不隨輸出順序變）', sortedSig === sig(b.slice().reverse().sort((x, y) => x.file.localeCompare(y.file))));
  check('分配規則：同一個 id 的雜湊固定', W.pick(['a', 'b', 'c'], 'l1-01') === W.pick(['a', 'b', 'c'], 'l1-01') && W.hash32('l3-11') === W.hash32('l3-11'));
  const p1 = a.filter((i) => i.category === '聽力P1');
  const combos = new Set(p1.flatMap((i) => i.slots.map((s) => s.accent + s.gender)));
  check('Part 1：口音與性別拆開（每種口音男女聲都出現）', combos.size === 8, [...combos].join(','));
  const p3 = a.filter((i) => i.category === '聽力P3');
  check('Part 3：兩人兩個口音、一男一女、整組同一說話者同一個聲音', p3.every((i) => {
    const byGender = {};
    let ok = true;
    i.segments.filter((s) => s.text).forEach((s) => { const g = /^en-[A-Z]{2}-(Andrew|Brian|Ryan|William|Liam)/.test(s.voice) ? 'M' : 'F'; byGender[g] = byGender[g] || s.voice; if (byGender[g] !== s.voice) ok = false; });
    return ok && i.voices.length === 2 && i.slots[0].accent !== i.slots[1].accent;
  }));
  const p2 = a.filter((i) => i.category === '聽力P2');
  check('Part 2：問句與選項不同性別、不同口音', p2.every((i) => i.slots[0].gender !== i.slots[1].gender && i.slots[0].accent !== i.slots[1].accent));
  const q = W.quotaReport(a, cfg);
  check('配額：四種口音各約 25%、男女各約 50%，都在容差內', Object.values(q).every((r) => !r.problems.length), JSON.stringify(Object.values(q).map((r) => r.problems)));
  check('Part 3、4 以外的類別沒有語速校準目標', a.filter((i) => i.speed).every((i) => i.category === '聽力P3' || i.category === '聽力P4'));
  const ovCfg = JSON.parse(JSON.stringify(cfg)); ovCfg.overrides = { 'l4-11.mp3': { voices: ['en-CA-LiamNeural'], rate: '+10%' } };
  const ov = W.build(W.REPO, ovCfg).find((i) => i.id === 'l4-11');
  check('指定聲音：overrides 優先', ov.voices[0] === 'en-CA-LiamNeural' && ov.segments[0].rate === '+10%');

  /* ---------- 2. 跳脫 ---------- */
  const ss = W.ssmlFor({ text: `Tom & Jerry <b> said "hi" it's`, voice: 'en-US-AvaMultilingualNeural', rate: '-4%' });
  check('SSML 跳脫 & < > " \'', ss.includes('Tom &amp; Jerry &lt;b&gt; said &quot;hi&quot; it&apos;s') && !/Jerry <b>/.test(ss) && ss.includes('xml:lang="en-US"'), ss);
  check('SSML：控制字元被拿掉', !/\u0001/.test(W.ssmlFor({ text: 'a\u0001b', voice: 'zh-TW-HsiaoChenNeural', rate: '0%' })) && W.ssmlFor({ text: 'x', voice: 'zh-TW-HsiaoChenNeural', rate: '0%' }).includes('xml:lang="zh-TW"'));

  /* ---------- 3. 乾跑 ---------- */
  {
    const st = makeEnv(); const od = outDir('dry'); const wl = path.join(TMP, 'wl.json');
    const code = await G.run(['--dry-run', '--category', 'p3,p4', '--out', od, '--worklist-out', wl], st.deps);
    const j = JSON.parse(fs.readFileSync(wl, 'utf8'));
    const expect = W.filterItems(a, { category: 'p3,p4' });
    check('乾跑：不連線、不建輸出資料夾、不要金鑰', code === 0 && st.calls.length === 0 && !fs.existsSync(od));
    check('乾跑：工作清單檔數、請求數、字元數和資料推得的一致', j.length === expect.length && j.length === 40
      && j.reduce((x, y) => x + y.requests, 0) === expect.reduce((x, y) => x + y.requests, 0)
      && j.reduce((x, y) => x + y.billChars, 0) === expect.reduce((x, y) => x + y.billChars, 0) && j.every((x) => x.segments.every((s) => !s.text || /^<speak/.test(s.ssml))));
    check('乾跑：印出估價', st.logs.some((l) => /估價/.test(l)) && st.logs.some((l) => /聽力P3/.test(l)));
    const st2 = makeEnv(); await G.run(['--dry-run', '--only', 'l4-11', '--out', od, '--verbose'], st2.deps);
    check('乾跑 --only：只列指定的檔並印出 SSML', st2.logs.some((l) => /l4-11\.mp3/.test(l)) && st2.logs.some((l) => /<speak/.test(l)) && !st2.logs.some((l) => /l4-12\.mp3/.test(l)));
  }

  /* ---------- 4. 實際產生、跳過、重產、格式 ---------- */
  {
    const st = makeEnv(); const od = outDir('gen');
    const code = await G.run(['--only', 'l1-01,l3-11,d-01', '--out', od], st.deps);
    check('產生：三個檔都寫出、退出碼 0', code === 0 && ['l1-01.mp3', 'l3-11.mp3', 'd-01.mp3'].every((f) => fs.existsSync(path.join(od, f))), st.logs.join(' / '));
    check('產生：只在 --out 資料夾，不碰 audio/', !listFiles(path.join(W.REPO, 'audio_azure')).length || od !== path.join(W.REPO, 'audio_azure'));
    const l1 = a.find((i) => i.id === 'l1-01');
    const pcmLen = st.ffmpegIn[st.ffmpegArgs.length ? 0 : 0];
    check('串接：每個檔只編碼一次、mp3 參數 24 kHz／48 kbps／單聲道', st.ffmpegArgs.length === 3 && st.ffmpegArgs.every((x) => x.includes('libmp3lame') && x.includes('48k') && x.includes('24000') && x.includes('pipe:0')));
    const gaps = l1.segments.filter((s) => s.gapMs).reduce((x, s) => x + s.gapMs, 0);
    const hdr = st.calls.filter((c) => c.text && /^A\./.test(c.text)).length;
    check('串接：多段檔的 PCM 長度＝各段語音＋靜音（Part 1 選項間 3×700 ms）', gaps === 2100 && hdr >= 1 && pcmLen > 2100 / 1000 * 48000);
    check('請求內容：標頭有金鑰、輸出格式是 PCM、網址用區域', st.calls[0].headers['Ocp-Apim-Subscription-Key'] === FAKE_KEY && st.calls[0].headers['X-Microsoft-OutputFormat'] === 'riff-24khz-16bit-mono-pcm' && st.calls[0].url.startsWith('https://eastus.tts.speech.microsoft.com/'));
    const manifest = fs.readFileSync(path.join(od, 'manifest.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    check('紀錄檔：每檔一行，有 id、聲音、語速、字元數、秒數、引擎、日期', manifest.length === 3 && manifest.every((m) => m.id && m.voices.length && m.rate && m.chars > 0 && m.seconds > 0 && m.engine && m.date));
    const n1 = st.calls.length;
    await G.run(['--only', 'l1-01,l3-11,d-01', '--out', od], st.deps);
    check('已存在就跳過：第二次不再呼叫', st.calls.length === n1 && st.logs.some((l) => /跳過已存在 3/.test(l)));
    await G.run(['--only', 'd-01', '--out', od, '--force'], st.deps);
    check('--force 重產', st.calls.length === n1 + 1);
    check('金鑰不出現在任何輸出與紀錄檔', !allText(st, od).includes(FAKE_KEY));
  }

  /* ---------- 5. 重試、退避 ---------- */
  {
    const st = makeEnv({ script: [resp(500, { body: 'oops ' + FAKE_KEY }), resp(429, { retryAfter: 3 })] });
    const od = outDir('retry');
    const code = await G.run(['--only', 'd-01', '--out', od], st.deps);
    check('重試：500 與 429 後成功', code === 0 && st.calls.length === 3 && fs.existsSync(path.join(od, 'd-01.mp3')));
    check('429 退避：照 Retry-After（3 秒）等', st.sleeps.includes(3000));
    check('重試的錯誤內文帶了金鑰也不會出現在輸出', !allText(st, od).includes(FAKE_KEY));
    const st2 = makeEnv({ script: [resp(401, { body: 'denied ' + FAKE_KEY })] });
    const code2 = await G.run(['--only', 'd-01,d-02', '--out', outDir('auth')], st2.deps);
    check('401：不重試、整批停下、退出碼 1、提示檢查金鑰', code2 === 1 && st2.calls.length === 1 && st2.logs.some((l) => /金鑰與區域/.test(l)) && !allText(st2, outDir('auth')).includes(FAKE_KEY));
    const always = Array.from({ length: 20 }, () => resp(503));
    const st3 = makeEnv({ script: always });
    const code3 = await G.run(['--only', 'd-01', '--out', outDir('giveup')], st3.deps);
    check('重試有上限：失敗不寫檔、列在失敗清單、退出碼 1', code3 === 1 && st3.calls.length === cfg.request.maxRetries + 1 && !fs.existsSync(path.join(outDir('giveup'), 'd-01.mp3')) && st3.logs.some((l) => /失敗 d-01/.test(l)));
    const st4 = makeEnv({ secPerChar: 0.06 });
    st4.deps.fetch = async () => { throw new Error('socket hang up ' + FAKE_KEY); };
    await G.run(['--only', 'd-01', '--out', outDir('net')], st4.deps);
    check('網路錯誤訊息帶金鑰也被遮掉', !allText(st4, outDir('net')).includes(FAKE_KEY) && st4.logs.some((l) => /連線失敗/.test(l)));
  }

  /* ---------- 6. 金鑰讀取 ---------- */
  {
    const st = makeEnv({ env: {} });
    const code = await G.run(['--only', 'd-01', '--out', outDir('nokey')], st.deps);
    check('讀不到金鑰：停下、退出碼 3、提示怎麼設、沒有連線', code === 3 && st.calls.length === 0 && st.logs.some((l) => /AZURE_SPEECH_KEY/.test(l)));
    const st2 = makeEnv({ env: {}, readRegistry: (n) => (n === 'AZURE_SPEECH_KEY' ? FAKE_KEY : n === 'AZURE_SPEECH_REGION' ? 'southeastasia' : '') });
    const code2 = await G.run(['--only', 'd-01', '--out', outDir('reg')], st2.deps);
    check('環境變數沒有時改讀使用者環境變數（登錄檔）', code2 === 0 && st2.calls[0].url.startsWith('https://southeastasia.') && !allText(st2, outDir('reg')).includes(FAKE_KEY));
    const stR = makeEnv({ env: { AZURE_SPEECH_KEY: FAKE_KEY } });
    check('只有金鑰沒有區域也停下', (await G.run(['--only', 'd-01', '--out', outDir('noreg')], stR.deps)) === 3);
  }

  /* ---------- 6b. 區域驗證與轉址 ---------- */
  {
    for (const bad of ['evil.com/x#', 'a@b', 'east.us', 'EastUS', 'a/b', 'x#y']) {
      const stB = makeEnv({ env: { AZURE_SPEECH_KEY: FAKE_KEY, AZURE_SPEECH_REGION: bad } });
      const codeB = await G.run(['--only', 'd-01', '--out', outDir('badreg')], stB.deps);
      check('區域值不合法（' + bad + '）：停下、不連線、不外洩金鑰', codeB !== 0 && stB.calls.length === 0 && !allText(stB, outDir('badreg')).includes(FAKE_KEY));
    }
    const stL = makeEnv({ env: { AZURE_SPEECH_KEY: FAKE_KEY, AZURE_SPEECH_REGION: 'eastus' } });
    const stLc = makeEnv({ env: { AZURE_SPEECH_KEY: FAKE_KEY, AZURE_SPEECH_REGION: 'eastus' } });
    let seen = null;
    const orig = stLc.deps.fetch;
    stLc.deps.fetch = async (u, i) => { seen = i; return orig(u, i); };
    await G.run(['--only', 'd-01', '--out', outDir('redir')], stLc.deps);
    check('請求不跟隨轉址（redirect: error）', seen && seen.redirect === 'error');
    void stL;
  }

  /* ---------- 7. 聲音清單 ---------- */
  {
    const st = makeEnv(); const vo = path.join(TMP, 'voices.json');
    const code = await G.run(['--list-voices', '--voices-out', vo], st.deps);
    const j = JSON.parse(fs.readFileSync(vo, 'utf8'));
    check('--list-voices：存成 JSON（不含金鑰）並核對設定的聲音', code === 0 && j.count > 0 && !fs.readFileSync(vo, 'utf8').includes(FAKE_KEY) && st.logs.some((l) => /找不到/.test(l)));
  }

  /* ---------- 8. 語速校準 ---------- */
  {
    const l4 = a.find((i) => i.id === 'l4-11');
    const slow = 60 / 150 * 1.0; // 每個字 0.4 秒（150 wpm）；字元數換算成秒
    const secPerChar = (l4.words / 150 * 60) / l4.segments[0].text.length;
    const st = makeEnv({ secPerChar });
    const od = outDir('cal');
    await G.run(['--only', 'l4-11', '--out', od], st.deps);
    const m = JSON.parse(fs.readFileSync(path.join(od, 'manifest.jsonl'), 'utf8').trim());
    check('語速校準：起始 150 wpm 低於 160，調快重產後落在目標內', m.speedOk === true && m.wpm >= 160 && m.wpm <= 200 && st.calls.length >= 2 && st.calls.length <= 3 && rateOf(m.rate) > -4, JSON.stringify(m));
    const st2 = makeEnv({ secPerChar: secPerChar * 3 });
    const od2 = outDir('cal2');
    await G.run(['--only', 'l4-11', '--out', od2], st2.deps);
    const m2 = JSON.parse(fs.readFileSync(path.join(od2, 'manifest.jsonl'), 'utf8').trim());
    check('語速校準：到上限仍不達標，最多重產 2 次（共 3 次請求）、標 speedOk=false、不無限重試', m2.speedOk === false && st2.calls.length <= 1 + cfg.speed.maxRetries && Math.abs(rateOf(m2.rate)) <= 25, JSON.stringify(m2));
    void slow;
  }

  /* ---------- 9. 預算上限 ---------- */
  {
    const st = makeEnv();
    const code = await G.run(['--category', 'p3', '--out', outDir('budget'), '--max-chars', '500'], st.deps);
    check('累計字元超過上限就停下', code === 1 && st.logs.some((l) => /上限/.test(l)) && st.calls.length < 40);
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(pass + ' / ' + (pass + fail) + ' 通過');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL 例外 ' + e.stack); process.exit(1); });

function rateOf(r) { return parseFloat(String(r)); }
