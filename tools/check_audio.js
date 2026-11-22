/* 檢查 gen_audio_azure.js 的輸出資料夾（預設 audio_azure/）。不連網、不讀金鑰。
   檢查：檔數與清單一致（缺檔、多檔）、manifest 每檔有紀錄、ffprobe 格式（mp3、24 kHz、單聲道、約 48 kbps）、
   長度合理（不少於 0.3 秒；和字元數推得的長度比不離譜）、不是全靜音、沒有削波、Part 3/4 語速在目標內。
   語音辨識：這台要有 faster_whisper 或 openai-whisper 套件，而且模型權重已經在磁碟上（本工具不下載）；
   沒有就略過並印出原因。加 --asr 才會跑（預設抽 40 檔，--asr-limit 可改），詞錯率超過 5% 算失敗。
   用法：node tools/check_audio.js [--dir audio_azure] [--category p3,p4] [--only ...] [--asr] [--model small.en]
   退出碼：有錯誤 1，只有警告或略過 0。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const W = require('./audio_worklist.js');

function parseArgs(argv) {
  const o = {}, withValue = new Set(['dir', 'category', 'only', 'model', 'asr-limit', 'python']);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    if (withValue.has(k)) o[k] = argv[++i]; else o[k] = true;
  }
  return o;
}
const exec = (cmd, args) => new Promise((res) => execFile(cmd, args, { maxBuffer: 1 << 26, encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) },
  (e, stdout, stderr) => res({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: stdout || '', stderr: stderr || '' })));
async function pool(list, n, fn) {
  let k = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (k < list.length) { const i = k++; await fn(list[i]); } }));
}

/* 長度是否合理：大約 8 到 25 個英文字元／秒（中文字 3 到 8 個／秒），加上靜音段 */
function expectedSeconds(it) {
  const gaps = it.segments.filter((s) => s.gapMs !== undefined).reduce((a, s) => a + s.gapMs, 0) / 1000;
  const texts = it.segments.filter((s) => s.text !== undefined);
  const wide = it.category === '中文翻譯';
  const n = texts.reduce((a, s) => a + [...s.text].length, 0);
  const rate = wide ? [3, 9] : [7, 28];
  return { min: n / rate[1] + gaps, max: n / rate[0] + gaps + 1.5 };
}

async function probe(file, run) {
  const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=codec_name,sample_rate,channels,bit_rate', '-of', 'json', file]);
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.stdout), s = (j.streams || [])[0] || {};
    return { codec: s.codec_name, sampleRate: +s.sample_rate, channels: +s.channels, bitRate: +(s.bit_rate || j.format.bit_rate), duration: parseFloat(j.format.duration) };
  } catch (e) { return null; }
}
async function volume(file, run) {
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const mean = /mean_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr), max = /max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr);
  const num = (m) => (m ? (m[1] === '-inf' ? -Infinity : parseFloat(m[1])) : null);
  return { mean: num(mean), max: num(max) };
}

/* ---------- 語音辨識（可行才跑）---------- */
function pythonExe(args) {
  const cands = [args.python, process.env.PYTHON, 'C:/Users/USER/anaconda3/python.exe', 'python3'].filter(Boolean);
  return cands.find((c) => !/[\\/]/.test(c) || fs.existsSync(c)) || null;
}
async function asrAvailable(args, run) {
  const py = pythonExe(args);
  if (!py) return { ok: false, reason: '找不到 Python' };
  const model = args.model || 'small.en';
  const home = os.homedir();
  const pt = path.join(home, '.cache', 'whisper', model + '.pt');
  if (fs.existsSync(pt)) {
    const r = await run(py, ['-I', '-c', 'import whisper']);
    if (r.code === 0) return { ok: true, py, kind: 'openai-whisper', model, weights: pt };
  }
  const hf = path.join(home, '.cache', 'huggingface', 'hub');
  const fwDir = fs.existsSync(hf) ? fs.readdirSync(hf).find((d) => d.startsWith('models--Systran--faster-whisper-' + model.replace('.en', ''))) : null;
  if (fwDir) {
    const r = await run(py, ['-I', '-c', 'import faster_whisper']);
    if (r.code === 0) return { ok: true, py, kind: 'faster-whisper', model, weights: path.join(hf, fwDir) };
  }
  const why = [];
  const imp = await run(py, ['-I', '-c', 'import whisper']);
  why.push('openai-whisper：' + (imp.code === 0 ? '套件可用，但磁碟上沒有 ' + model + '.pt 權重' : '匯入失敗'));
  const imp2 = await run(py, ['-I', '-c', 'import faster_whisper']);
  why.push('faster-whisper：' + (imp2.code === 0 ? '套件可用，但沒有 ' + model + ' 的權重' : '匯入失敗'));
  return { ok: false, reason: why.join('；') + '；本工具不下載模型' };
}
const ASR_PY = [
  'import sys, json',
  'kind, model, weights = sys.argv[1], sys.argv[2], sys.argv[3]',
  'files = json.load(open(sys.argv[4], encoding="utf-8"))',
  'out = {}',
  'if kind == "openai-whisper":',
  '    import whisper, os',
  '    m = whisper.load_model(model, download_root=os.path.dirname(weights))',
  '    for f in files: out[f] = m.transcribe(f, language="en", fp16=False)["text"]',
  'else:',
  '    from faster_whisper import WhisperModel',
  '    m = WhisperModel(weights, device="cpu", compute_type="int8")',
  '    for f in files: out[f] = " ".join(s.text for s in m.transcribe(f, language="en")[0])',
  'print(json.dumps(out, ensure_ascii=False))',
].join('\n');
const normWords = (s) => String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
function wer(ref, hyp) {
  const a = normWords(ref), b = normWords(hyp);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(Array(b.length).fill(0)));
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return a.length ? d[a.length][b.length] / a.length : 0;
}

async function check(argv, depsIn) {
  const deps = Object.assign({ run: exec, log: (s) => process.stdout.write(s + '\n') }, depsIn || {});
  const args = parseArgs(argv);
  const cfg = W.loadVoices();
  const dir = path.resolve(args.dir || path.join(W.REPO, 'audio_azure'));
  const items = W.filterItems(W.build(W.REPO, cfg), { category: args.category, only: args.only });
  const errors = [], warns = [];
  if (!fs.existsSync(dir)) { deps.log('找不到資料夾 ' + dir); return { errors: ['資料夾不存在'], warns, items: 0 }; }

  const onDisk = new Set();
  const walk = (d, pre) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    if (e.isDirectory()) walk(path.join(d, e.name), pre + e.name + '/'); else if (e.name.endsWith('.mp3')) onDisk.add(pre + e.name);
  });
  walk(dir, '');
  const want = new Set(items.map((i) => i.file));
  const filtered = !!(args.category || args.only);
  const missing = [...want].filter((f) => !onDisk.has(f));
  const extra = filtered ? [] : [...onDisk].filter((f) => !want.has(f));
  if (missing.length) errors.push('缺 ' + missing.length + ' 個檔（例 ' + missing.slice(0, 3).join('、') + '）');
  if (extra.length) errors.push('多出 ' + extra.length + ' 個清單外的檔（例 ' + extra.slice(0, 3).join('、') + '）');

  const man = new Map();
  const mf = path.join(dir, 'manifest.jsonl');
  if (fs.existsSync(mf)) fs.readFileSync(mf, 'utf8').split('\n').filter(Boolean).forEach((l) => { try { const r = JSON.parse(l); man.set(r.file, r); } catch (e) { warns.push('manifest 有壞行'); } });
  else warns.push('沒有 manifest.jsonl');

  const present = items.filter((i) => onDisk.has(i.file));
  const stats = { checked: 0, wpm: {} };
  await pool(present, 6, async (it) => {
    const f = path.join(dir, it.file), tag = it.file + '：';
    const p = await probe(f, deps.run);
    if (!p) { errors.push(tag + 'ffprobe 讀不了'); return; }
    stats.checked++;
    if (p.codec !== 'mp3') errors.push(tag + '編碼是 ' + p.codec);
    if (p.sampleRate !== 24000 || p.channels !== 1) errors.push(tag + '格式 ' + p.sampleRate + ' Hz／' + p.channels + ' 聲道，應為 24000 Hz／1');
    if (!(p.bitRate >= 44000 && p.bitRate <= 52000)) errors.push(tag + '位元率 ' + p.bitRate);
    if (!(p.duration >= 0.3)) { errors.push(tag + '太短 ' + p.duration + ' 秒'); return; }
    const ex = expectedSeconds(it);
    if (p.duration < ex.min * 0.6 || p.duration > ex.max * 1.6) errors.push(tag + '長度 ' + p.duration.toFixed(1) + ' 秒和字數不符（預期約 ' + ex.min.toFixed(1) + '–' + ex.max.toFixed(1) + '）');
    const v = await volume(f, deps.run);
    if (v.mean === null) warns.push(tag + '量不到音量');
    else if (v.mean < -50) errors.push(tag + '幾乎全靜音（平均 ' + v.mean + ' dB）');
    if (v.max !== null && v.max >= -0.1) warns.push(tag + '可能削波（峰值 ' + v.max + ' dB）');
    const tgt = it.speed;
    if (tgt && it.words) {
      const wpm = it.words / p.duration * 60;
      (stats.wpm[it.category] = stats.wpm[it.category] || []).push(wpm);
      if (wpm < tgt.min || wpm > tgt.max) warns.push(tag + '語速 ' + wpm.toFixed(0) + ' wpm 不在 ' + tgt.min + '–' + tgt.max);
    }
    const r = man.get(it.file);
    if (man.size && !r) warns.push(tag + 'manifest 沒有紀錄');
  });

  let asr = { skipped: true, reason: '沒加 --asr' };
  if (args.asr) {
    const av = await asrAvailable(args, deps.run);
    if (!av.ok) { asr = { skipped: true, reason: av.reason }; deps.log('略過語音辨識：' + av.reason); }
    else {
      const limit = parseInt(args['asr-limit'] || '40', 10);
      const sample = present.filter((i) => /^(聽力P[34]|英語耳|發音句子)/.test(i.category)).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / limit)) === 0).slice(0, limit);
      const tmp = path.join(os.tmpdir(), 'asr_files_' + process.pid + '.json');
      fs.writeFileSync(tmp, JSON.stringify(sample.map((i) => path.join(dir, i.file))));
      const r = await deps.run(av.py, ['-I', '-c', ASR_PY, av.kind, av.model, av.weights, tmp]);
      fs.rmSync(tmp, { force: true });
      if (r.code !== 0) { asr = { skipped: true, reason: '辨識程式執行失敗' }; warns.push('語音辨識執行失敗'); }
      else {
        const hyp = JSON.parse(r.stdout.trim().split('\n').pop());
        let worst = 0;
        for (const it of sample) {
          const ref = it.segments.filter((s) => s.text !== undefined).map((s) => s.text).join(' ');
          const w = wer(ref, hyp[path.join(dir, it.file)] || '');
          worst = Math.max(worst, w);
          if (w > 0.05) errors.push(it.file + '：詞錯率 ' + (w * 100).toFixed(1) + '% 超過 5%');
        }
        asr = { skipped: false, sampled: sample.length, worst };
      }
    }
  } else deps.log('略過語音辨識：' + asr.reason + '（這台目前沒有可用的辨識模型）');

  deps.log('檢查 ' + stats.checked + ' / ' + items.length + ' 個檔；錯誤 ' + errors.length + '，警告 ' + warns.length);
  for (const [c, a] of Object.entries(stats.wpm)) deps.log(c + ' 語速 平均 ' + (a.reduce((x, y) => x + y, 0) / a.length).toFixed(0) + ' wpm（' + Math.min(...a).toFixed(0) + '–' + Math.max(...a).toFixed(0) + '）');
  errors.slice(0, 40).forEach((e) => deps.log('錯誤 ' + e));
  warns.slice(0, 20).forEach((e) => deps.log('警告 ' + e));
  return { errors, warns, items: items.length, checked: stats.checked, asr };
}

module.exports = { check, wer, expectedSeconds, asrAvailable };
if (require.main === module) check(process.argv.slice(2)).then((r) => process.exit(r.errors.length ? 1 : 0), (e) => { console.error(e.message); process.exit(1); });
