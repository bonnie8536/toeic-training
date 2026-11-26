/* 要擋的個人字樣(公開 repo 不能寫出來,所以不放在這裡)。
   樣式放在 repo 外的文字檔,用環境變數 RUSHUP_PRIVATE_PATTERNS_FILE 指定路徑:每行一個正規式(不分大小寫),空行與 # 開頭的行略過。
   沒設、檔案不存在或沒有任何樣式時回 skipped(原因),呼叫的測試就略過這一項並印出原因。
   樣式有錯時丟出錯誤,訊息只寫第幾個樣式,不印樣式本身。 */
'use strict';
const fs = require('fs');

const ENV_NAME = 'RUSHUP_PRIVATE_PATTERNS_FILE';

/** @returns {{ patterns: RegExp[], skipped: string|null }} */
function loadPrivatePatterns(env) {
  const file = (env || process.env)[ENV_NAME];
  if (!file) return { patterns: [], skipped: '沒有設定 ' + ENV_NAME };
  if (!fs.existsSync(file)) return { patterns: [], skipped: ENV_NAME + ' 指定的檔案不存在' };
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  const patterns = lines.map((s, i) => {
    try { return new RegExp(s, 'i'); } catch (e) { throw new Error('個人字樣清單的第 ' + (i + 1) + ' 個樣式不是正規式'); }
  });
  if (!patterns.length) return { patterns: [], skipped: '個人字樣清單沒有任何樣式' };
  return { patterns, skipped: null };
}

/** 回傳命中的樣式序號(從 0 起) */
function privateHits(text, patterns) {
  const s = String(text);
  return patterns.map((re, i) => (re.test(s) ? i : -1)).filter((i) => i >= 0);
}

module.exports = { loadPrivatePatterns, privateHits, ENV_NAME };
