/* 藍新金流 Edge Function 的測試(不連網路、不碰資料庫、不需要 Deno)。
   1. supabase/functions/_shared/newebpay.ts:加解密與驗章,用藍新手冊的官方範例與第三方範例比對
      (範例值與出處在 tools/fixtures/newebpay.vectors.json,跟 刷刷英文開發/收費/newebpay/newebpay.test.mjs 同一組)
   2. _shared/products.ts:伺服器價格表跟 js/plans-config.js 一致
   3. newebpay-checkout、newebpay-notify 的處理邏輯:用假的 fetch 代替 Supabase,檢查送去資料庫的參數與回應
   4. supabase/config.toml 與原始碼裡沒有金鑰、商店代號
   Node 24 會直接讀 .ts(type stripping)。用法:node tools/test_newebpay.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

// .ts 檔用 import/export,Node 會先當 CommonJS 讀失敗再改用 ES module,並印一行 MODULE_TYPELESS_PACKAGE_JSON 警告。
// 不在 supabase/functions 放 package.json(Supabase 部署會把它當成函式的套件設定),所以只把這一種警告靜音,其他照印。
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') console.warn(w); });

const REPO = path.join(__dirname, '..');
const FN = path.join(REPO, 'supabase', 'functions');
const V = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'newebpay.vectors.json'), 'utf8'));
const K1 = { hashKey: V.mpg_v1.hashKey, hashIV: V.mpg_v1.hashIV };
const MID = 'MS0000000001';
const KEYS = { merchantId: MID, ...K1 };

const imp = (rel) => import(require('url').pathToFileURL(path.join(FN, rel)).href);
const LIB = imp('_shared/newebpay.ts');
const PROD_MOD = imp('_shared/products.ts');
const CHECKOUT = imp('newebpay-checkout/handler.ts');
const NOTIFY = imp('newebpay-notify/handler.ts');

// ---------- 對照用 ----------

function nodeEncrypt(plain, key, iv, blockSize) {
  const b = Buffer.from(plain, 'utf8');
  const n = blockSize - (b.length % blockSize);
  const c = nodeCrypto.createCipheriv('aes-256-cbc', Buffer.from(key), Buffer.from(iv));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(Buffer.concat([b, Buffer.alloc(n, n)])), c.final()]).toString('hex');
}
function nodeEncryptRaw(bytes, key, iv) {
  const c = nodeCrypto.createCipheriv('aes-256-cbc', Buffer.from(key), Buffer.from(iv));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(bytes), c.final()]).toString('hex');
}
async function signedBody(tradeInfo, { merchantId = MID, hashKey = K1.hashKey, hashIV = K1.hashIV, status = 'SUCCESS' } = {}) {
  const { tradeSha, MPG_VERSION } = await LIB;
  return new URLSearchParams({
    Status: status, MerchantID: merchantId, Version: MPG_VERSION, TradeInfo: tradeInfo,
    TradeSha: await tradeSha(tradeInfo, hashKey, hashIV),
  });
}
async function makeNotify(payloadObj, opts = {}) {
  const { aesEncryptHex } = await LIB;
  const ti = await aesEncryptHex(JSON.stringify(payloadObj), opts.hashKey ?? K1.hashKey, opts.hashIV ?? K1.hashIV);
  return signedBody(ti, opts);
}
const ORDER = 'S261101003000ABCDEFG';
const paidPayload = (over = {}) => ({
  Status: 'SUCCESS', Message: '授權成功',
  Result: { MerchantID: MID, Amt: 199, TradeNo: '26110112345678901', MerchantOrderNo: ORDER,
    PaymentType: 'CREDIT', RespondType: 'JSON', PayTime: '2026-11-01 00:31:00', IP: '1.2.3.4', EscrowBank: 'HNCB',
    Card6No: '400022', Card4No: '1111', Exp: '2912', AuthBank: 'KGI', RespondCode: '00', Auth: '123456', ...over },
});

// ---------- 1. 加解密(移植自 newebpay.test.mjs,21 項) ----------

test('MPG_1.1.1 官方範例:query 字串、TradeInfo、TradeSha 完全一致', async () => {
  const { buildTradeInfoQuery, aesEncryptHex, tradeSha, aesDecryptHex } = await LIB;
  const v = V.mpg_v1;
  assert.equal(buildTradeInfoQuery(v.params), v.plain);
  assert.equal(await aesEncryptHex(v.plain, v.hashKey, v.hashIV), v.tradeInfo);
  assert.equal(await aesEncryptHex(v.plain, v.hashKey, v.hashIV, { blockSize: 16 }), v.tradeInfo);
  assert.equal(await tradeSha(v.tradeInfo, v.hashKey, v.hashIV), v.tradeSha);
  assert.equal(await aesDecryptHex(v.tradeInfo, v.hashKey, v.hashIV), v.plain);
});

test('NDNP-1.0.4 官方範例:請求密文一致', async () => {
  const { aesEncryptHex } = await LIB;
  const v = V.ndnp_104;
  assert.equal(await aesEncryptHex(v.requestPlain, v.hashKey, v.hashIV, { blockSize: 16 }), v.requestCipher);
  assert.equal(await aesEncryptHex(v.requestPlain, v.hashKey, v.hashIV, { blockSize: 32 }), v.requestCipher);
});

test('NDNP-1.0.4 官方回傳:補齊 4、20、23 都解得開', async () => {
  const { aesDecryptHex } = await LIB;
  const v = V.ndnp_104;
  const cases = [
    ['createResponse', v.createPad, (j) => assert.equal(j.Result.PeriodNo, 'P231115153213aMDNWZ')],
    ['alterStatusResponse', v.alterStatusPad, (j) => assert.equal(j.Result.AlterType, 'suspend')],
    ['alterAmtResponse', v.alterAmtPad, (j) => assert.equal(j.Result.ExtDay, '2908')],
  ];
  for (const [name, pad, check] of cases) {
    const hex = v[name];
    const raw = nodeCrypto.createDecipheriv('aes-256-cbc', Buffer.from(v.hashKey), Buffer.from(v.hashIV));
    raw.setAutoPadding(false);
    const bytes = Buffer.concat([raw.update(Buffer.from(hex, 'hex')), raw.final()]);
    assert.equal(bytes[bytes.length - 1], pad, `${name} 補齊長度`);
    const j = JSON.parse(await aesDecryptHex(hex, v.hashKey, v.hashIV));
    assert.equal(j.Status, 'SUCCESS');
    check(j);
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(v.hashKey), { name: 'AES-CBC' }, false, ['decrypt']);
  await assert.rejects(crypto.subtle.decrypt({ name: 'AES-CBC', iv: new TextEncoder().encode(v.hashIV) }, key, Buffer.from(v.alterAmtResponse, 'hex')));
});

test('交易查詢 V1.0.3 官方範例:CheckValue 與 CheckCode', async () => {
  const { queryCheckValue, queryCheckCode } = await LIB;
  const v = V.query_2018;
  assert.equal(await queryCheckValue(v.checkValueInput, v.hashKey, v.hashIV), v.checkValue);
  assert.equal(await queryCheckCode(v.checkCodeInput, v.hashKey, v.hashIV), v.checkCode);
  const shuffled = { TradeNo: v.checkCodeInput.TradeNo, MerchantOrderNo: v.checkCodeInput.MerchantOrderNo,
    Amt: v.checkCodeInput.Amt, MerchantID: v.checkCodeInput.MerchantID };
  assert.equal(await queryCheckCode(shuffled, v.hashKey, v.hashIV), v.checkCode);
});

test('第三方轉錄 NDNF-1.2.5:請求一致;回呼驗章、解得開,但 String 格式的明文不收', async () => {
  const { aesEncryptHex, aesDecryptHex, tradeSha, parseNotify, parsePayTime, checkPaid } = await LIB;
  const v = V.ndnf_125_thirdparty;
  const keys = { merchantId: v.merchantId, hashKey: v.hashKey, hashIV: v.hashIV };
  assert.equal(await aesEncryptHex(v.requestPlain, v.hashKey, v.hashIV), v.requestTradeInfo);
  assert.equal(await tradeSha(v.requestTradeInfo, v.hashKey, v.hashIV), v.requestTradeSha);
  const cb = new URLSearchParams(v.callbackBody);
  assert.equal(await tradeSha(cb.get('TradeInfo'), v.hashKey, v.hashIV), cb.get('TradeSha').toUpperCase());
  const flat = Object.fromEntries(new URLSearchParams(await aesDecryptHex(cb.get('TradeInfo'), v.hashKey, v.hashIV)));
  assert.equal(flat.RespondType, 'String');
  assert.equal(flat.PaymentType, 'CREDIT');
  assert.equal(flat.PayTime, '2023-09-27 14:21:59');
  // 我們一律送 RespondType=JSON,藍新回的明文也會是 JSON;String 格式跟我們自己的付款請求長得一樣,一律不收(2026-10-17)
  assert.equal((await parseNotify(v.callbackBody, keys)).error, 'bad_payload');
  // 同一組欄位改成 JSON 格式就收,而且 Result 裡的 RespondType 不影響(藍新的結果本來就帶這個欄位)
  const { Status, Message, ...result } = flat;
  const ti = await aesEncryptHex(JSON.stringify({ Status, Message, Result: result }), v.hashKey, v.hashIV);
  const r = await parseNotify({ MerchantID: v.merchantId, TradeInfo: ti, TradeSha: await tradeSha(ti, v.hashKey, v.hashIV) }, keys);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.status, 'SUCCESS');
  assert.equal(r.result.MerchantOrderNo, 'Vanespl_ec_1695795668');
  assert.equal(parsePayTime(r.result.PayTime), '2023-09-27T14:21:59+08:00');
  const c = checkPaid(r, { merchantOrderNo: 'Vanespl_ec_1695795668', amount: 30 });
  assert.equal(c.paid, true);
  assert.equal(c.tradeNo, r.result.TradeNo);
});

test('第三方範例 V2(補齊 25)與 V3 CheckCode', async () => {
  const { aesEncryptHex, tradeSha, aesDecryptHex, queryCheckCode } = await LIB;
  const v = V.v2_thirdparty;
  assert.equal(await aesEncryptHex(v.plain, K1.hashKey, K1.hashIV), v.tradeInfo);
  assert.equal(await tradeSha(v.tradeInfo, K1.hashKey, K1.hashIV), v.tradeSha);
  assert.equal(await aesDecryptHex(v.tradeInfo, K1.hashKey, K1.hashIV), v.plain);
  assert.notEqual(await aesEncryptHex(v.plain, K1.hashKey, K1.hashIV, { blockSize: 16 }), v.tradeInfo);
  const c = V.v3_thirdparty_checkcode;
  assert.equal(await queryCheckCode(c.input, c.hashKey, c.hashIV), c.checkCode);
});

test('buildTradeInfoQuery 跟 PHP http_build_query 一樣', async () => {
  const { phpUrlencode, buildTradeInfoQuery } = await LIB;
  assert.equal(phpUrlencode('a b'), 'a+b');
  assert.equal(phpUrlencode('test@neweb.com.tw'), 'test%40neweb.com.tw');
  assert.equal(phpUrlencode('https://x.y/z?a=1'), 'https%3A%2F%2Fx.y%2Fz%3Fa%3D1');
  assert.equal(phpUrlencode('~*-_.'), '%7E%2A-_.');
  assert.equal(phpUrlencode('刷'), '%E5%88%B7');
  assert.equal(buildTradeInfoQuery({ A: 1, B: null, C: undefined, D: true, E: false, F: '' }), 'A=1&D=1&E=0&F=');
  assert.equal(buildTradeInfoQuery([['Z', '1'], ['A', '2']]), 'Z=1&A=2');
  assert.throws(() => buildTradeInfoQuery({ A: { b: 1 } }), TypeError);
  assert.throws(() => buildTradeInfoQuery({ A: [1] }), TypeError);
  assert.throws(() => buildTradeInfoQuery({ A: NaN }), TypeError);
  assert.throws(() => phpUrlencode('\uD800'), TypeError);
});

test('往返:長度 0 到 100(含中文),32 與 16 兩種補齊都跟 node:crypto 一致', async () => {
  const { aesEncryptHex, aesDecryptHex } = await LIB;
  for (let len = 0; len <= 100; len++) {
    const plain = len % 3 === 0 ? '刷'.repeat(Math.floor(len / 3)) : 'x'.repeat(len);
    for (const bs of [32, 16]) {
      const hex = await aesEncryptHex(plain, K1.hashKey, K1.hashIV, { blockSize: bs });
      assert.equal(hex, nodeEncrypt(plain, K1.hashKey, K1.hashIV, bs), `len ${len} bs ${bs}`);
      assert.equal(await aesDecryptHex(hex, K1.hashKey, K1.hashIV), plain);
    }
  }
});

test('補齊邊界:空字串補 32 個;16、31、32、33 位元組', async () => {
  const { aesEncryptHex, aesDecryptHex } = await LIB;
  const sizes = { 0: 32, 15: 17, 16: 16, 31: 1, 32: 32, 33: 31 };
  for (const [len, pad] of Object.entries(sizes)) {
    const plain = 'a'.repeat(Number(len));
    const hex = await aesEncryptHex(plain, K1.hashKey, K1.hashIV);
    assert.equal(hex.length / 2, Number(len) + pad);
    assert.equal(await aesDecryptHex(hex, K1.hashKey, K1.hashIV), plain);
  }
});

test('壞掉的補齊與格式一律丟錯', async () => {
  const { aesEncryptHex, aesDecryptHex } = await LIB;
  const block = (fill, last) => { const b = Buffer.alloc(32, fill); b[31] = last; return b; };
  const bad = [
    nodeEncryptRaw(block(0x41, 0), K1.hashKey, K1.hashIV),
    nodeEncryptRaw(block(0x21, 33), K1.hashKey, K1.hashIV),
    nodeEncryptRaw(Buffer.concat([Buffer.alloc(28, 0x41), Buffer.from([4, 4, 5, 4])]), K1.hashKey, K1.hashIV),
    nodeEncryptRaw(Buffer.alloc(16, 0x11), K1.hashKey, K1.hashIV),
  ];
  for (const hex of bad) await assert.rejects(aesDecryptHex(hex, K1.hashKey, K1.hashIV), /補齊|解密/);
  const notUtf8 = nodeEncryptRaw(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.alloc(30, 30)]), K1.hashKey, K1.hashIV);
  await assert.rejects(aesDecryptHex(notUtf8, K1.hashKey, K1.hashIV), /UTF-8/);
  for (const hex of ['', 'abc', 'zz'.repeat(16), 'ab'.repeat(15)]) {
    await assert.rejects(aesDecryptHex(hex, K1.hashKey, K1.hashIV));
  }
  await assert.rejects(aesEncryptHex('x', 'short', K1.hashIV), /32/);
  await assert.rejects(aesEncryptHex('x', K1.hashKey, 'short'), /16/);
  await assert.rejects(aesEncryptHex('x', K1.hashKey, K1.hashIV, { blockSize: 8 }));
});

test('錯的金鑰解不出原文', async () => {
  const { aesEncryptHex, aesDecryptHex } = await LIB;
  const hex = await aesEncryptHex('Status=SUCCESS&Amt=199', K1.hashKey, K1.hashIV);
  let out = null;
  try { out = await aesDecryptHex(hex, 'abcdefghijklmnopqrstuvwxyz012345', K1.hashIV); } catch (e) { /* 多半丟錯 */ }
  assert.notEqual(out, 'Status=SUCCESS&Amt=199');
});

test('makeMpgFields:欄位、驗章、解密內容', async () => {
  const { makeMpgFields, tradeSha, aesDecryptHex } = await LIB;
  const order = {
    MerchantOrderNo: 'S2610071230ABCDEFG12', Amt: 199, ItemDesc: '刷刷英文 學生方案 1 個月', Email: 'a@example.com',
    LoginType: 0, NotifyURL: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/newebpay-notify',
    CREDIT: 1, TradeLimit: 900, OrderComment: undefined,
  };
  const f = await makeMpgFields({ ...KEYS, order, timeStamp: 1791345600 });
  assert.deepEqual(Object.keys(f), ['MerchantID', 'TradeInfo', 'TradeSha', 'Version']);
  assert.equal(f.Version, '2.3');
  assert.equal(f.TradeSha, await tradeSha(f.TradeInfo, K1.hashKey, K1.hashIV));
  const p = new URLSearchParams(await aesDecryptHex(f.TradeInfo, K1.hashKey, K1.hashIV));
  assert.equal(p.get('MerchantID'), MID);
  assert.equal(p.get('RespondType'), 'JSON');
  assert.equal(p.get('TimeStamp'), '1791345600');
  assert.equal(p.get('Amt'), '199');
  assert.equal(p.get('ItemDesc'), '刷刷英文 學生方案 1 個月');
  assert.equal(p.get('NotifyURL'), order.NotifyURL);
  assert.equal(p.has('OrderComment'), false);
  assert.equal(f.TradeInfo.length % 64, 0);
});

test('makeMpgFields:擋下不合規的訂單', async () => {
  const { makeMpgFields } = await LIB;
  const base = { MerchantOrderNo: 'S1', Amt: 150, ItemDesc: '批改 1 篇' };
  const bad = [
    { MerchantOrderNo: 'S-1' }, { MerchantOrderNo: 'x'.repeat(31) }, { Amt: 0 }, { Amt: 1.5 }, { Amt: '150' },
    { ItemDesc: '' }, { ItemDesc: 'a\nb' }, { ItemDesc: "it's" }, { ItemDesc: '字'.repeat(51) },
    { Email: 'not-an-email' }, { NotifyURL: 'https://x.y:8443/n' }, { ReturnURL: 'ftp://x.y/' }, { Version: '1.6' },
    { MerchantID: 'X' },
  ];
  for (const b of bad) await assert.rejects(makeMpgFields({ ...KEYS, order: { ...base, ...b } }), undefined, JSON.stringify(b));
  await assert.rejects(makeMpgFields({ ...KEYS, merchantId: 'MS-1', order: base }));
  assert.ok(await makeMpgFields({ ...KEYS, order: { ...base, ItemDesc: '字'.repeat(50) } }));
});

test('parseNotify:JSON、FormData、物件都可以;checkPaid 判斷付款', async () => {
  const { parseNotify, checkPaid } = await LIB;
  const body = await makeNotify(paidPayload());
  const fd = new FormData();
  for (const [k, v] of body) fd.append(k, v);
  for (const input of [body, body.toString(), fd, Object.fromEntries(body)]) {
    const r = await parseNotify(input, KEYS);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.status, 'SUCCESS');
    assert.equal(r.result.TradeNo, '26110112345678901');
  }
  const r = await parseNotify(body, KEYS);
  assert.deepEqual(checkPaid(r, { merchantOrderNo: ORDER, amount: 199 }),
    { paid: true, reason: null, payTime: '2026-11-01T00:31:00+08:00', tradeNo: '26110112345678901', paymentType: 'CREDIT' });
  assert.equal(checkPaid(r, { merchantOrderNo: ORDER, amount: 1990 }).reason, 'amount_mismatch');
  assert.equal(checkPaid(r, { merchantOrderNo: 'OTHER', amount: 199 }).reason, 'order_mismatch');
});

test('parseNotify:沒有 PayTime 與失敗狀態都不算付款', async () => {
  const { parseNotify, checkPaid } = await LIB;
  const code = await parseNotify(await makeNotify(paidPayload({ PaymentType: 'VACC', PayTime: undefined })), KEYS);
  assert.equal(code.ok, true);
  assert.equal(checkPaid(code, {}).reason, 'no_pay_time');
  const failed = await parseNotify(await makeNotify({ ...paidPayload(), Status: 'MPG03009', Message: '交易失敗' }, { status: 'MPG03009' }), KEYS);
  assert.equal(failed.ok, true);
  assert.equal(checkPaid(failed, {}).reason, 'status_MPG03009');
  assert.equal(checkPaid({ ok: false }, {}).reason, 'not_verified');
});

test('parseNotify:竄改、錯的金鑰、商店代號不符都擋下', async () => {
  const { parseNotify, aesEncryptHex } = await LIB;
  const body = await makeNotify(paidPayload());
  const ti = body.get('TradeInfo');
  const flip = (s, i) => s.slice(0, i) + (s[i] === '0' ? '1' : '0') + s.slice(i + 1);
  const t1 = new URLSearchParams(body); t1.set('TradeInfo', flip(ti, 10));
  assert.equal((await parseNotify(t1, KEYS)).error, 'bad_trade_sha');
  const t2 = new URLSearchParams(body); t2.set('TradeSha', flip(body.get('TradeSha'), 5));
  assert.equal((await parseNotify(t2, KEYS)).error, 'bad_trade_sha');
  const t3 = new URLSearchParams(body); t3.set('TradeSha', body.get('TradeSha').slice(0, 63));
  assert.equal((await parseNotify(t3, KEYS)).error, 'bad_trade_sha');
  const t4 = new URLSearchParams(body); t4.set('MerchantID', 'MS9999999999');
  assert.equal((await parseNotify(t4, KEYS)).error, 'merchant_mismatch');
  assert.equal((await parseNotify(body, { ...KEYS, hashKey: 'abcdefghijklmnopqrstuvwxyz012345' })).error, 'bad_trade_sha');
  assert.equal((await parseNotify(body, { ...KEYS, hashIV: 'abcdefghijklmnop' })).error, 'bad_trade_sha');
  const inner = await makeNotify(paidPayload({ MerchantID: 'MS9999999999' }));
  assert.equal((await parseNotify(inner, KEYS)).error, 'merchant_mismatch');
  assert.equal((await parseNotify('Status=SUCCESS', KEYS)).error, 'missing_fields');
  assert.equal((await parseNotify({ TradeInfo: 'zz', TradeSha: 'AA' }, KEYS)).error, 'bad_trade_info');
  assert.equal((await parseNotify(null, KEYS)).error, 'missing_fields');
  const badPad = nodeEncryptRaw(Buffer.alloc(32, 0x41), K1.hashKey, K1.hashIV);
  assert.equal((await parseNotify(await signedBody(badPad), KEYS)).error, 'decrypt_failed');
  const junk = await signedBody(await aesEncryptHex('{not json', K1.hashKey, K1.hashIV));
  assert.equal((await parseNotify(junk, KEYS)).ok, false);
  await assert.rejects(parseNotify(body, { merchantId: MID }));
});

test('parseNotify:Result 是 JSON 字串時也能讀', async () => {
  const { parseNotify } = await LIB;
  const p = paidPayload();
  const r = await parseNotify(await makeNotify({ ...p, Result: JSON.stringify(p.Result) }), KEYS);
  assert.equal(r.ok, true);
  assert.equal(r.result.Amt, 199);
});

test('timingSafeEqual 與 parsePayTime', async () => {
  const { timingSafeEqual, parsePayTime } = await LIB;
  assert.equal(timingSafeEqual('ABC', 'ABC'), true);
  assert.equal(timingSafeEqual('ABC', 'ABD'), false);
  assert.equal(timingSafeEqual('ABC', 'ABCD'), false);
  assert.equal(timingSafeEqual('', ''), true);
  assert.equal(parsePayTime('2014-06-25 16:43:49'), '2014-06-25T16:43:49+08:00');
  assert.equal(parsePayTime('2014-06-25+16:43:49'), '2014-06-25T16:43:49+08:00');
  assert.equal(parsePayTime('2014-13-45 99:99:99'), null);
  assert.equal(parsePayTime(''), null);
  assert.equal(parsePayTime(undefined), null);
});

test('makeQueryFields 與 verifyQueryResponse', async () => {
  const { makeQueryFields, queryCheckValue, queryCheckCode, verifyQueryResponse } = await LIB;
  await assert.rejects(makeQueryFields({ ...KEYS, merchantOrderNo: 'S1', amount: 199 }), /Version/);
  const q = await makeQueryFields({ ...KEYS, merchantOrderNo: 'S1', amount: 199, version: '1.3', timeStamp: 1 });
  assert.equal(q.CheckValue, await queryCheckValue({ Amt: '199', MerchantID: MID, MerchantOrderNo: 'S1' }, K1.hashKey, K1.hashIV));
  assert.equal(q.TimeStamp, '1');
  const result = { MerchantID: MID, Amt: 199, TradeNo: '26100700000000001', MerchantOrderNo: 'S1', TradeStatus: '1' };
  result.CheckCode = await queryCheckCode({ Amt: '199', MerchantID: MID, MerchantOrderNo: 'S1', TradeNo: result.TradeNo }, K1.hashKey, K1.hashIV);
  assert.equal((await verifyQueryResponse({ Status: 'SUCCESS', Result: result }, KEYS)).ok, true);
  assert.equal((await verifyQueryResponse({ Status: 'SUCCESS', Result: { ...result, Amt: 1 } }, KEYS)).error, 'bad_check_code');
  assert.equal((await verifyQueryResponse({ Status: 'TRA10021', Result: [] }, KEYS)).error, 'status_TRA10021');
  assert.equal((await verifyQueryResponse({ Status: 'SUCCESS', Result: { ...result, MerchantID: 'X' } }, KEYS)).error, 'merchant_mismatch');
  const json = { Status: 'SUCCESS', Result: result };
  assert.equal((await verifyQueryResponse(json, { ...KEYS, merchantOrderNo: 'S2', amount: 199 })).error, 'order_mismatch');
  assert.equal((await verifyQueryResponse(json, { ...KEYS, merchantOrderNo: 'S1', amount: 1990 })).error, 'amount_mismatch');
});

test('PayTime 存在但看不懂與沒有 PayTime 分開', async () => {
  const { parseNotify, checkPaid } = await LIB;
  const odd = await parseNotify(await makeNotify(paidPayload({ PayTime: '20261101003100' })), KEYS);
  assert.equal(checkPaid(odd, {}).reason, 'bad_pay_time');
  const none = await parseNotify(await makeNotify(paidPayload({ PayTime: '' })), KEYS);
  assert.equal(checkPaid(none, {}).reason, 'no_pay_time');
});

// ---------- 2. 價格表 ----------

function loadPlans() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(REPO, 'js', 'plans-config.js'), 'utf8'), ctx);
  return ctx.window.PLANS;
}

test('價格表跟 js/plans-config.js 一致;年繳 = 月費 × teacherYearMonths', async () => {
  const { PRODUCTS, findProduct } = await PROD_MOD;
  const P = loadPlans();
  const want = {
    student_month: P.student.month, student_year: P.student.year,
    teacher10_month: P.teacher[10], teacher10_year: P.teacher[10] * P.teacherYearMonths,
    teacher30_month: P.teacher[30], teacher30_year: P.teacher[30] * P.teacherYearMonths,
    teacher60_month: P.teacher[60], teacher60_year: P.teacher[60] * P.teacherYearMonths,
    correction_one: P.correction.one, correction_five: P.correction.five,
    test10: 10,
  };
  assert.deepEqual([...PRODUCTS.keys()].sort(), Object.keys(want).sort());
  for (const [sku, amt] of Object.entries(want)) assert.equal(findProduct(sku).amount, amt, sku);
  assert.equal(findProduct('student_month').amount, 199);
  assert.equal(findProduct('teacher60_year').amount, 14900);
  assert.equal(findProduct('correction_five').amount, 650);
});

test('價格表:只有 test10 限站長;品名合規;怪代號查不到', async () => {
  const { PRODUCTS, findProduct } = await PROD_MOD;
  for (const p of PRODUCTS.values()) {
    assert.equal(p.ownerOnly, p.sku === 'test10', p.sku);
    assert.ok(p.desc.startsWith('刷刷英文 '), p.sku);
    assert.ok([...p.desc].length <= 50 && !/[\r\n']/.test(p.desc), p.sku);
    assert.ok(Object.isFrozen(p), p.sku);
    if (p.item === 'student') assert.ok(p.months && p.seats === null && p.credits === null, p.sku);
    if (p.item === 'teacher') assert.ok([1, 12].includes(p.months) && [10, 30, 60].includes(p.seats) && p.credits === null, p.sku);
    if (p.item === 'credits') assert.ok(p.months === null && p.seats === null && [1, 5].includes(p.credits), p.sku);
  }
  for (const bad of ['__proto__', 'constructor', 'toString', 'STUDENT_MONTH', 'student_month ', '', null, 1, {}, ['student_month']]) {
    assert.equal(findProduct(bad), null, String(bad));
  }
});

test('價格表的代號與內容跟 paid_gateway_additions.sql 的核對表相同(找不到 SQL 檔就跳過)', async (t) => {
  const sqlPath = path.join(REPO, '..', '刷刷英文開發', '收費', 'newebpay', 'paid_gateway_additions.sql');
  if (!fs.existsSync(sqlPath)) { t.skip('找不到 ' + sqlPath); return; }
  const { PRODUCTS } = await PROD_MOD;
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const rows = [...sql.matchAll(/\('([a-z0-9_]+)', '(student|teacher|credits)', (null|\d+)(?:::int)?, (null|\d+)(?:::int)?, (null|\d+)(?:::int)?\)/g)]
    .map((m) => [m[1], m[2], m[3] === 'null' ? null : Number(m[3]), m[4] === 'null' ? null : Number(m[4]), m[5] === 'null' ? null : Number(m[5])]);
  const fromTs = [...PRODUCTS.values()].map((p) => [p.sku, p.item, p.months, p.seats, p.credits]);
  const key = (a) => a.map((r) => r.join('|')).sort();
  assert.deepEqual(key(rows), key(fromTs));
});

test('審查:品名跟網站的寫法一樣(一個月、一年、N 位以內),一般空白,UTF-8 也在 50 位元組以內', async () => {
  const { PRODUCTS } = await PROD_MOD;
  const want = {
    student_month: '刷刷英文 學生方案 一個月',
    student_year: '刷刷英文 學生方案 一年',
    teacher10_month: '刷刷英文 老師方案 10 位以內 一個月',
    teacher10_year: '刷刷英文 老師方案 10 位以內 一年',
    teacher30_month: '刷刷英文 老師方案 30 位以內 一個月',
    teacher30_year: '刷刷英文 老師方案 30 位以內 一年',
    teacher60_month: '刷刷英文 老師方案 60 位以內 一個月',
    teacher60_year: '刷刷英文 老師方案 60 位以內 一年',
    correction_one: '刷刷英文 寫作批改 1 篇',
    correction_five: '刷刷英文 寫作批改 5 篇',
    test10: '刷刷英文 站長測試項目',
  };
  assert.deepEqual(Object.fromEntries([...PRODUCTS.values()].map((p) => [p.sku, p.desc])), want);
  for (const p of PRODUCTS.values()) {
    assert.equal(/ /.test(p.desc), false, p.sku); // 網站用不斷行空白,藍新付款頁用一般空白
    // 藍新手冊寫 50 字;不確定是字還是位元組,所以連 UTF-8 位元組都壓在 50 以內
    assert.ok(Buffer.byteLength(p.desc, 'utf8') <= 50, `${p.sku} ${Buffer.byteLength(p.desc, 'utf8')} 位元組`);
  }
  // 實際送到藍新的 ItemDesc 就是這一句
  const { handler } = await checkoutWith();
  const j = await (await handler(checkoutReq({ sku: 'teacher30_year', consent: true }))).json();
  assert.equal((await decryptFields(j.fields)).get('ItemDesc'), '刷刷英文 老師方案 30 位以內 一年');
});

// ---------- 3. 處理邏輯:假的 Supabase ----------

const SB_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const SERVICE_KEY = 'service-role-key-for-tests-only';
const ANON_KEY = 'anon-key-for-tests-only';
const USER_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
const OWNER_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvd25lciJ9.c2lnbmF0dXJl';
const USER = { id: '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72', email: 'student@example.com' };
const OWNER = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com' };
const SITE = 'https://www.shuashualanguage.com';

function baseEnv(over = {}) {
  return {
    SUPABASE_URL: SB_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY,
    NEWEBPAY_ENV: 'production', NEWEBPAY_MERCHANT_ID: MID, NEWEBPAY_HASH_KEY: K1.hashKey, NEWEBPAY_HASH_IV: K1.hashIV,
    ...over,
  };
}

// rpcReply(fn, args, n) 回 { status, body };沒給就回 200 + 依函式的預設值
function fakeSupabase({ users = { [USER_JWT]: USER, [OWNER_JWT]: OWNER }, rpcReply } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const h = init.headers || {};
    calls.push({ url, path: u.pathname, method: init.method, headers: h, body: init.body ? JSON.parse(init.body) : null });
    if (u.pathname === '/auth/v1/user') {
      const jwt = String(h.Authorization || '').replace(/^Bearer /, '');
      const user = users[jwt];
      if (!user || !h.apikey) return new Response(JSON.stringify({ msg: 'invalid' }), { status: 401 });
      return new Response(JSON.stringify(user), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(u.pathname);
    if (m) {
      assert.equal(h.apikey, SERVICE_KEY, 'rpc 要用 service role');
      assert.equal(h.Authorization, `Bearer ${SERVICE_KEY}`);
      const n = calls.filter((c) => c.path === u.pathname).length;
      const r = rpcReply ? rpcReply(m[1], JSON.parse(init.body), n) : null;
      const def = { newebpay_begin_checkout: { payment_id: 'p1' }, newebpay_settle: { outcome: 'paid' },
        newebpay_mark_failed: { outcome: 'failed' }, newebpay_log: 1 }[m[1]];
      const rr = r || { status: 200, body: def };
      return new Response(JSON.stringify(rr.body), { status: rr.status, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls, rpcCalls: (fn) => calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`) };
}

function makeLog() {
  const lines = [];
  const rec = (lvl) => (...a) => lines.push(lvl + ' ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  return { lines, info: rec('info'), warn: rec('warn'), error: rec('error') };
}

const NOW = new Date('2026-10-31T16:30:00Z'); // 台北 2026-11-01 00:30:00

async function checkoutWith({ env = baseEnv(), sb = fakeSupabase(), log = makeLog(), now = NOW } = {}) {
  const { createCheckoutHandler } = await CHECKOUT;
  const handler = createCheckoutHandler({ env: (k) => env[k], fetch: sb.fetch, log, now: () => now });
  return { handler, sb, log };
}

function checkoutReq(body, { jwt = USER_JWT, origin = SITE, method = 'POST', raw } = {}) {
  const headers = { 'Content-Type': 'application/json', apikey: 'sb_publishable_test' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (origin) headers.Origin = origin;
  return new Request(`${SB_URL}/functions/v1/newebpay-checkout`, {
    method, headers, body: method === 'POST' || method === 'PUT' ? (raw ?? JSON.stringify(body)) : undefined,
  });
}

async function decryptFields(fields) {
  const { aesDecryptHex, tradeSha } = await LIB;
  assert.equal(fields.TradeSha, await tradeSha(fields.TradeInfo, K1.hashKey, K1.hashIV));
  return new URLSearchParams(await aesDecryptHex(fields.TradeInfo, K1.hashKey, K1.hashIV));
}

test('checkout:CORS 預檢只回應自己的網站', async () => {
  const { handler } = await checkoutWith();
  const ok = await handler(checkoutReq(null, { method: 'OPTIONS' }));
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), SITE);
  assert.match(ok.headers.get('access-control-allow-headers'), /authorization/i);
  const other = await handler(checkoutReq(null, { method: 'OPTIONS', origin: 'https://evil.example' }));
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const get = await handler(checkoutReq(null, { method: 'GET' }));
  assert.equal(get.status, 405);
});

test('checkout:沒登入、publishable key、Auth 不認得的 JWT 都回 401,而且不建單', async () => {
  const { handler, sb } = await checkoutWith();
  for (const jwt of [null, 'sb_publishable_U4v7mmmpxVuBv8c7b39NyA_apBMTPur', 'eyJ.bad.token']) {
    const r = await handler(checkoutReq({ sku: 'student_month', consent: true }, { jwt }));
    assert.equal(r.status, 401, String(jwt));
    assert.equal((await r.json()).error, '請先登入');
  }
  assert.equal(sb.rpcCalls('newebpay_begin_checkout').length, 0);
  // publishable key 不像 JWT:連 Auth 都不用問
  assert.equal(sb.calls.filter((c) => c.path === '/auth/v1/user').length, 1);
});

test('checkout:代號不在價格表、沒有勾選同意都回 400', async () => {
  const { handler, sb } = await checkoutWith();
  for (const body of [{}, { sku: 'student_week', consent: true }, { sku: '__proto__', consent: true }, { sku: 'constructor', consent: true }]) {
    const r = await handler(checkoutReq(body));
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  for (const consent of [undefined, false, 'true', 1]) {
    const r = await handler(checkoutReq({ sku: 'student_month', consent }));
    assert.equal(r.status, 400, String(consent));
    assert.match((await r.json()).error, /同意/);
  }
  const notJson = await handler(checkoutReq(null, { raw: '{oops' }));
  assert.equal(notJson.status, 400);
  const huge = await handler(checkoutReq(null, { raw: JSON.stringify({ sku: 'student_month', consent: true, pad: 'x'.repeat(5000) }) }));
  assert.equal(huge.status, 413);
  assert.equal(sb.rpcCalls('newebpay_begin_checkout').length, 0);
});

// 分段送出(沒有 Content-Length)的 checkout 請求,記下實際被讀走多少位元組
function checkoutStreamReq(total, { chunk = 16384, fill = 0x20, prefix = '' } = {}) {
  let sent = 0;
  const head = new TextEncoder().encode(prefix);
  const stream = new ReadableStream({
    pull(ctl) {
      if (sent >= total) { ctl.close(); return; }
      const n = Math.min(chunk, total - sent);
      const buf = new Uint8Array(n).fill(fill);
      for (let i = 0; i < n && sent + i < head.length; i++) buf[i] = head[sent + i];
      sent += n;
      ctl.enqueue(buf);
    },
  });
  const req = new Request(`${SB_URL}/functions/v1/newebpay-checkout`, {
    method: 'POST', body: stream, duplex: 'half',
    headers: { 'Content-Type': 'application/json', apikey: 'sb_publishable_test', Authorization: `Bearer ${USER_JWT}`, Origin: SITE },
  });
  return { req, sent: () => sent };
}

test('審查:checkout 分段傳送 10 MB 讀到 4096 位元組就停,回 413、不建單', async () => {
  for (const chunk of [16384, 1000]) {
    const { handler, sb } = await checkoutWith();
    const s = checkoutStreamReq(10 * 1024 * 1024, { chunk });
    const r = await handler(s.req);
    assert.equal(r.status, 413, String(chunk));
    assert.ok(s.sent() < 64 * 1024, `chunk ${chunk} 讀了 ${s.sent()} 位元組`);
    assert.equal(sb.calls.filter((c) => c.path.startsWith('/rest/')).length, 0, String(chunk));
    assert.equal((await r.json()).message, '暫時無法建立付款，請稍後再試');
  }
  // 剛好 4096 位元組(JSON 後面補空白)照常建單;4097 就 413
  const body = JSON.stringify({ sku: 'student_month', consent: true });
  {
    const { handler, sb } = await checkoutWith();
    const s = checkoutStreamReq(4096, { chunk: 1000, prefix: body });
    assert.equal((await handler(s.req)).status, 200);
    assert.equal(s.sent(), 4096);
    assert.equal(sb.rpcCalls('newebpay_begin_checkout').length, 1);
  }
  {
    const { handler, sb } = await checkoutWith();
    const s = checkoutStreamReq(4097, { chunk: 1000, prefix: body });
    assert.equal((await handler(s.req)).status, 413);
    assert.equal(sb.rpcCalls('newebpay_begin_checkout').length, 0);
  }
});

test('checkout:學生月繳,正式環境,欄位只開信用卡、金額由伺服器決定', async () => {
  const { handler, sb, log } = await checkoutWith();
  const r = await handler(checkoutReq({ sku: 'student_month', consent: true, amount: 1, Amt: 1, price: 1 }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const j = await r.json();
  assert.equal(j.action, 'https://core.newebpay.com/MPG/mpg_gateway');
  assert.deepEqual(Object.keys(j.fields).sort(), ['MerchantID', 'TradeInfo', 'TradeSha', 'Version']);
  assert.match(j.order_no, /^S261101003000[A-Z0-9]{7}$/);
  const p = await decryptFields(j.fields);
  assert.equal(p.get('MerchantID'), MID);
  assert.equal(p.get('MerchantOrderNo'), j.order_no);
  assert.equal(p.get('Amt'), '199');
  assert.equal(p.get('ItemDesc'), '刷刷英文 學生方案 一個月');
  assert.equal(p.get('Email'), USER.email);
  assert.equal(p.get('LoginType'), '0');
  assert.equal(p.get('CREDIT'), '1');
  for (const k of ['VACC', 'WEBATM', 'CVS', 'BARCODE', 'InstFlag', 'CustomerURL', 'ExpireDate', 'LINEPAY', 'ANDROIDPAY', 'SAMSUNGPAY', 'UNIONPAY']) {
    assert.equal(p.has(k), false, k);
  }
  assert.equal(p.get('NotifyURL'), `${SB_URL}/functions/v1/newebpay-notify`);
  assert.equal(p.get('ReturnURL'), `${SB_URL}/functions/v1/newebpay-notify/return`);
  // 在藍新付款頁按「返回商店」= 沒付款就回來:結果頁看到 back=1 只查一次,不進輪詢
  assert.equal(p.get('ClientBackURL'), `${SITE}/pay-result.html?back=1`);
  assert.equal(p.get('TradeLimit'), '900');
  assert.equal(p.get('TimeStamp'), String(Math.floor(NOW.getTime() / 1000)));
  const begin = sb.rpcCalls('newebpay_begin_checkout');
  assert.equal(begin.length, 1);
  const { CONSENT_VERSION } = await PROD_MOD;
  assert.deepEqual(begin[0].body, {
    p_user: USER.id, p_sku: 'student_month', p_item: 'student', p_months: 1, p_seats: null, p_credits: null,
    p_amount: 199, p_order_no: j.order_no, p_env: 'production', p_consent: CONSENT_VERSION,
  });
  const auth = sb.calls.find((c) => c.path === '/auth/v1/user');
  assert.equal(auth.headers.Authorization, `Bearer ${USER_JWT}`);
  // 網址比 50 字長:記一筆警告(上線步驟.md 的 NT$10 測試會用到),不擋
  assert.ok(log.lines.some((l) => /longer than 50/.test(l)));
});

test('checkout:老師年繳與批改的金額;測試環境用 ccore 與 T 開頭', async () => {
  const cases = [['teacher30_year', 8900, 'teacher', 12, 30, null], ['teacher10_month', 390, 'teacher', 1, 10, null],
    ['correction_five', 650, 'credits', null, null, 5]];
  for (const [sku, amt, item, months, seats, credits] of cases) {
    const { handler, sb } = await checkoutWith();
    const j = await (await handler(checkoutReq({ sku, consent: true }))).json();
    assert.equal((await decryptFields(j.fields)).get('Amt'), String(amt), sku);
    const b = sb.rpcCalls('newebpay_begin_checkout')[0].body;
    assert.deepEqual([b.p_item, b.p_months, b.p_seats, b.p_credits, b.p_amount], [item, months, seats, credits, amt], sku);
  }
  const { handler, sb } = await checkoutWith({ env: baseEnv({ NEWEBPAY_ENV: 'test' }) });
  const j = await (await handler(checkoutReq({ sku: 'student_year', consent: true }))).json();
  assert.equal(j.action, 'https://ccore.newebpay.com/MPG/mpg_gateway');
  assert.match(j.order_no, /^T\d{12}[A-Z0-9]{7}$/);
  assert.equal(sb.rpcCalls('newebpay_begin_checkout')[0].body.p_env, 'test');
});

test('checkout:test10 送 10 元,站長以外由資料庫擋下並回 409', async () => {
  const sb1 = fakeSupabase();
  const { handler } = await checkoutWith({ sb: sb1 });
  const ok = await handler(checkoutReq({ sku: 'test10', consent: true }, { jwt: OWNER_JWT }));
  assert.equal(ok.status, 200);
  const j = await ok.json();
  const p = await decryptFields(j.fields);
  assert.equal(p.get('Amt'), '10');
  assert.equal(p.get('ItemDesc'), '刷刷英文 站長測試項目');
  assert.equal(sb1.rpcCalls('newebpay_begin_checkout')[0].body.p_sku, 'test10');
  assert.equal(sb1.rpcCalls('newebpay_begin_checkout')[0].body.p_user, OWNER.id);
  const sb2 = fakeSupabase({ rpcReply: () => ({ status: 400, body: { code: 'P0001', message: '這個測試項目只有站長可以購買' } }) });
  const { handler: h2 } = await checkoutWith({ sb: sb2 });
  const no = await h2(checkoutReq({ sku: 'test10', consent: true }));
  assert.equal(no.status, 409);
  assert.deepEqual(await no.json(), { error: 'not_allowed', message: '這個測試項目只有站長可以購買' });
});

test('checkout:資料庫錯誤;訂單編號撞號換一個重試一次', async () => {
  const sb = fakeSupabase({ rpcReply: (fn, args, n) => (n === 1 ? { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "payments_request_key_key"' } } : null) });
  const { handler } = await checkoutWith({ sb });
  const r = await handler(checkoutReq({ sku: 'student_month', consent: true }));
  assert.equal(r.status, 200);
  const calls = sb.rpcCalls('newebpay_begin_checkout');
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].body.p_order_no, calls[1].body.p_order_no);
  const j = await r.json();
  assert.equal(j.order_no, calls[1].body.p_order_no);
  assert.equal((await decryptFields(j.fields)).get('MerchantOrderNo'), j.order_no);

  const sb2 = fakeSupabase({ rpcReply: () => ({ status: 500, body: { code: 'XX000', message: 'internal secret detail' } }) });
  const { handler: h2 } = await checkoutWith({ sb: sb2 });
  const r2 = await h2(checkoutReq({ sku: 'student_month', consent: true }));
  assert.equal(r2.status, 500);
  const e2 = (await r2.json()).error;
  assert.equal(e2, '暫時無法建立付款，請稍後再試');

  const sb3 = fakeSupabase({ rpcReply: () => ({ status: 400, body: { code: 'P0001', message: '一小時內有太多筆還沒完成的付款，請稍後再試' } }) });
  const { handler: h3 } = await checkoutWith({ sb: sb3 });
  const r3 = await h3(checkoutReq({ sku: 'student_month', consent: true }));
  assert.equal(r3.status, 409);
  const j3 = await r3.json();
  assert.equal(j3.error, 'not_allowed');
  assert.match(j3.message, /太多筆/);

  const sb4 = { fetch: async (url) => { if (url.includes('/auth/')) return fakeSupabase().fetch(url, { headers: { Authorization: `Bearer ${USER_JWT}`, apikey: 'x' } }); throw new Error('network down'); } };
  const { handler: h4 } = await checkoutWith({ sb: sb4 });
  const r4 = await h4(checkoutReq({ sku: 'student_month', consent: true }));
  assert.equal(r4.status, 500);
});

test('checkout:Email 超過 50 字或格式怪就不帶', async () => {
  const long = { id: USER.id, email: 'a'.repeat(45) + '@example.com' };
  const sb = fakeSupabase({ users: { [USER_JWT]: long } });
  const { handler } = await checkoutWith({ sb });
  const j = await (await handler(checkoutReq({ sku: 'student_month', consent: true }))).json();
  assert.equal((await decryptFields(j.fields)).has('Email'), false);
  const sb2 = fakeSupabase({ users: { [USER_JWT]: { id: USER.id, email: null } } });
  const { handler: h2 } = await checkoutWith({ sb: sb2 });
  const j2 = await (await h2(checkoutReq({ sku: 'student_month', consent: true }))).json();
  assert.equal((await decryptFields(j2.fields)).has('Email'), false);
  const sb3 = fakeSupabase({ users: { [USER_JWT]: { id: USER.id, email: 'x@y.z', is_anonymous: true } } });
  const { handler: h3 } = await checkoutWith({ sb: sb3 });
  assert.equal((await h3(checkoutReq({ sku: 'student_month', consent: true }))).status, 401);
});

test('checkout:NEWEBPAY_NOTIFY_URL 可以換成短網址;格式不對就停', async () => {
  const { handler } = await checkoutWith({ env: baseEnv({ NEWEBPAY_NOTIFY_URL: 'https://pay.shuashualanguage.com/n/' }) });
  const j = await (await handler(checkoutReq({ sku: 'student_month', consent: true }))).json();
  const p = await decryptFields(j.fields);
  assert.equal(p.get('NotifyURL'), 'https://pay.shuashualanguage.com/n');
  assert.equal(p.get('ReturnURL'), 'https://pay.shuashualanguage.com/n/return');
  for (const bad of ['http://pay.shuashualanguage.com/n', 'https://pay.shuashualanguage.com/n?x=1', 'not a url', 'https://pay.shuashualanguage.com:8443/n']) {
    const { handler: h, sb } = await checkoutWith({ env: baseEnv({ NEWEBPAY_NOTIFY_URL: bad }) });
    const r = await h(checkoutReq({ sku: 'student_month', consent: true }));
    assert.equal(r.status, 500, bad);
    assert.equal(sb.rpcCalls('newebpay_begin_checkout').length, 0, bad);
  }
});

test('checkout:金流設定缺漏或寫錯就回 500,不建單、不洩漏設定值', async () => {
  const variants = [
    { NEWEBPAY_HASH_KEY: undefined }, { NEWEBPAY_HASH_IV: '' }, { NEWEBPAY_MERCHANT_ID: undefined },
    { NEWEBPAY_ENV: 'prod' }, { NEWEBPAY_ENV: undefined }, { NEWEBPAY_HASH_KEY: 'short' }, { SUPABASE_SERVICE_ROLE_KEY: undefined },
  ];
  for (const v of variants) {
    const log = makeLog();
    const { handler, sb } = await checkoutWith({ env: baseEnv(v), log });
    const r = await handler(checkoutReq({ sku: 'student_month', consent: true }));
    assert.equal(r.status, 500, JSON.stringify(v));
    const text = await r.text();
    assert.equal(sb.rpcCalls('newebpay_begin_checkout').length, 0);
    for (const s of [K1.hashKey, K1.hashIV, SERVICE_KEY]) {
      assert.equal(text.includes(s), false);
      assert.equal(log.lines.join('\n').includes(s), false);
    }
  }
});

test('checkout:訂單編號用台北時間,每次都不同', async () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const { handler } = await checkoutWith({ now: new Date('2026-12-31T16:00:00Z') });
    const j = await (await handler(checkoutReq({ sku: 'correction_one', consent: true }))).json();
    assert.match(j.order_no, /^S270101000000[A-Z0-9]{7}$/);
    seen.add(j.order_no);
  }
  assert.equal(seen.size, 30);
});

// ---------- notify ----------

async function notifyWith({ env = baseEnv(), sb = fakeSupabase(), log = makeLog() } = {}) {
  const { createNotifyHandler } = await NOTIFY;
  return { handler: createNotifyHandler({ env: (k) => env[k], fetch: sb.fetch, log }), sb, log };
}
function notifyReq(body, { p = '/newebpay-notify', method = 'POST' } = {}) {
  const init = { method };
  if (method === 'POST') {
    if (body instanceof FormData) init.body = body;
    else { init.body = String(body); init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; }
  }
  return new Request(`${SB_URL}${p}`, init);
}

test('notify:付款成功 → newebpay_settle,參數正確、不存卡號前六碼與 IP,回 200', async () => {
  const { handler, sb, log } = await notifyWith();
  const r = await handler(notifyReq(await makeNotify(paidPayload())));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'OK');
  const s = sb.rpcCalls('newebpay_settle');
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].body, {
    p_order_no: ORDER, p_amount: 199, p_trade_no: '26110112345678901', p_payment_type: 'CREDIT',
    p_paid_at: '2026-11-01T00:31:00+08:00', p_source: 'notify',
    p_payload: { TradeNo: '26110112345678901', MerchantOrderNo: ORDER, Amt: 199, PaymentType: 'CREDIT',
      PayTime: '2026-11-01 00:31:00', EscrowBank: 'HNCB', AuthBank: 'KGI', RespondCode: '00', Auth: '123456', Card4No: '1111' },
  });
  const all = log.lines.join('\n');
  assert.equal(all.includes(K1.hashKey) || all.includes(K1.hashIV), false);
  assert.ok(all.includes(ORDER) && all.includes('paid'));
});

test('notify:各種路徑寫法都對得上;只收 x-www-form-urlencoded,FormData(multipart)回 415', async () => {
  const body = await makeNotify(paidPayload());
  for (const p of ['/newebpay-notify', '/newebpay-notify/', '/functions/v1/newebpay-notify']) {
    const { handler, sb } = await notifyWith();
    const r = await handler(notifyReq(body, { p }));
    assert.equal(r.status, 200, p);
    assert.equal(sb.rpcCalls('newebpay_settle').length, 1, p);
  }
  const fd = new FormData();
  for (const [k, v] of body) fd.append(k, v);
  {
    const { handler, sb } = await notifyWith();
    assert.equal((await handler(notifyReq(fd))).status, 415);
    assert.equal(sb.calls.length, 0);
  }
  for (const p of ['/newebpay-notify/customer', '/newebpay-notify/return/x', '/other']) {
    const { handler, sb } = await notifyWith();
    const r = await handler(notifyReq(await makeNotify(paidPayload()), { p }));
    assert.equal(r.status, 404, p);
    assert.equal(sb.calls.length, 0, p);
  }
  const { handler } = await notifyWith();
  assert.equal((await handler(notifyReq(null, { method: 'GET' }))).status, 405);
});

test('notify:重送(duplicate)與 test10(paid_test)都回 200;資料庫錯誤回 500 讓藍新重送', async () => {
  for (const outcome of ['duplicate', 'paid_test', 'not_applied', 'amount_mismatch', 'unknown_order', 'paid_after_refund']) {
    const sb = fakeSupabase({ rpcReply: () => ({ status: 200, body: { outcome } }) });
    const { handler } = await notifyWith({ sb });
    assert.equal((await handler(notifyReq(await makeNotify(paidPayload())))).status, 200, outcome);
  }
  const sb = fakeSupabase({ rpcReply: () => ({ status: 500, body: { code: '40001', message: 'could not serialize' } }) });
  const { handler } = await notifyWith({ sb });
  assert.equal((await handler(notifyReq(await makeNotify(paidPayload())))).status, 500);
  const sbDown = { fetch: async () => { throw new Error('network down'); } };
  const { handler: h2 } = await notifyWith({ sb: sbDown });
  assert.equal((await h2(notifyReq(await makeNotify(paidPayload())))).status, 500);
});

test('notify:驗章失敗回 400,完全不碰資料庫,log 只記錯誤代碼', async () => {
  const body = await makeNotify(paidPayload());
  const tampered = new URLSearchParams(body); tampered.set('TradeSha', 'A'.repeat(64));
  const wrongMid = new URLSearchParams(body); wrongMid.set('MerchantID', 'MS9999999999');
  for (const b of [tampered, wrongMid, 'garbage', '', 'TradeInfo=zz&TradeSha=AA']) {
    const { handler, sb, log } = await notifyWith();
    const r = await handler(notifyReq(b));
    assert.equal(r.status, 400, String(b).slice(0, 40));
    assert.equal(sb.calls.length, 0);
    assert.equal(log.lines.join('\n').includes(body.get('TradeInfo')), false);
  }
  const other = await makeNotify(paidPayload(), { hashKey: 'abcdefghijklmnopqrstuvwxyz012345' });
  const { handler, sb } = await notifyWith();
  assert.equal((await handler(notifyReq(other))).status, 400);
  assert.equal(sb.calls.length, 0);
});

test('notify:失敗代碼 → newebpay_mark_failed;SUCCESS 但沒有或看不懂 PayTime → 記成要站長處理', async () => {
  const failBody = await makeNotify({ ...paidPayload({ PayTime: undefined }), Status: 'MPG03009', Message: '授權失敗' }, { status: 'MPG03009' });
  const { handler, sb } = await notifyWith();
  assert.equal((await handler(notifyReq(failBody))).status, 200);
  assert.deepEqual(sb.rpcCalls('newebpay_mark_failed')[0].body,
    { p_order_no: ORDER, p_code: 'MPG03009', p_detail: { message: '授權失敗' }, p_source: 'notify' });
  assert.equal(sb.rpcCalls('newebpay_settle').length, 0);
  for (const [over, reason] of [[{ PayTime: undefined }, 'no_pay_time'], [{ PayTime: '20261101003100' }, 'bad_pay_time'], [{ TradeNo: 'bad-no!' }, 'bad_trade_no']]) {
    const { handler: h, sb: s } = await notifyWith();
    assert.equal((await h(notifyReq(await makeNotify(paidPayload(over))))).status, 200, reason);
    const l = s.rpcCalls('newebpay_log');
    assert.equal(l.length, 1, reason);
    assert.deepEqual(l[0].body, { p_source: 'notify', p_order_no: ORDER, p_outcome: 'paid_unparsed', p_needs_owner: true,
      p_detail: { reason, type: 'CREDIT', trade_no: over.TradeNo ?? '26110112345678901', amt: 199 } });
    assert.equal(s.rpcCalls('newebpay_settle').length, 0, reason);
  }
});

test('notify:Amt 缺或怪就送 null(資料庫會當成金額不符),不會變成 0 或 NaN', async () => {
  for (const amt of [undefined, 'abc', -5, 1.5, '199']) {
    const { handler, sb } = await notifyWith();
    await handler(notifyReq(await makeNotify(paidPayload({ Amt: amt }))));
    const s = sb.rpcCalls('newebpay_settle')[0];
    assert.equal(s.body.p_amount, amt === '199' ? 199 : null, String(amt));
  }
});

test('notify/return:驗過才帶訂單編號,一律 303 回付款結果頁,不碰資料庫', async () => {
  const { handler, sb } = await notifyWith();
  const ok = await handler(notifyReq(await makeNotify(paidPayload()), { p: '/newebpay-notify/return' }));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), `${SITE}/pay-result.html?o=${ORDER}`);
  const failed = await handler(notifyReq(await makeNotify({ ...paidPayload(), Status: 'MPG03009' }, { status: 'MPG03009' }), { p: '/newebpay-notify/return' }));
  assert.equal(failed.headers.get('location'), `${SITE}/pay-result.html?o=${ORDER}`);
  const bad = new URLSearchParams(await makeNotify(paidPayload())); bad.set('TradeSha', 'B'.repeat(64));
  const r2 = await handler(notifyReq(bad, { p: '/newebpay-notify/return' }));
  assert.equal(r2.status, 303);
  assert.equal(r2.headers.get('location'), `${SITE}/pay-result.html`);
  const weird = await handler(notifyReq(await makeNotify(paidPayload({ MerchantOrderNo: 'S1"><script>' })), { p: '/newebpay-notify/return' }));
  assert.equal(weird.headers.get('location'), `${SITE}/pay-result.html`);
  const get = await handler(notifyReq(null, { p: '/newebpay-notify/return', method: 'GET' }));
  assert.equal(get.status, 303);
  assert.equal(get.headers.get('location'), `${SITE}/pay-result.html`);
  assert.equal(sb.calls.length, 0);
});

test('notify:設定缺漏時,通知回 500,return 仍帶人回結果頁', async () => {
  const { handler, sb } = await notifyWith({ env: baseEnv({ NEWEBPAY_HASH_IV: undefined }) });
  assert.equal((await handler(notifyReq(await makeNotify(paidPayload())))).status, 500);
  const r = await handler(notifyReq(await makeNotify(paidPayload()), { p: '/newebpay-notify/return' }));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `${SITE}/pay-result.html`);
  assert.equal(sb.calls.length, 0);
});

test('notify:太大的請求直接拒絕', async () => {
  const { handler, sb } = await notifyWith();
  const big = new Request(`${SB_URL}/newebpay-notify`, { method: 'POST', body: 'TradeInfo=' + 'a'.repeat(70000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal((await handler(big)).status, 413);
  assert.equal(sb.calls.length, 0);
});

// ---------- 2026-10-16 審查補的測試 ----------

// 分段送出(沒有 Content-Length)的大請求:記下實際被讀走多少位元組
function streamReq(total, contentType, chunk = 16384) {
  let sent = 0;
  const stream = new ReadableStream({
    pull(ctl) {
      if (sent >= total) { ctl.close(); return; }
      const n = Math.min(chunk, total - sent);
      sent += n;
      ctl.enqueue(new Uint8Array(n).fill(0x61));
    },
  });
  const req = new Request(`${SB_URL}/newebpay-notify`, { method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Type': contentType } });
  return { req, sent: () => sent };
}

test('審查:notify 分段傳送(沒有 Content-Length)的大請求讀到上限就停,回 413', async () => {
  for (const type of ['application/x-www-form-urlencoded', 'application/x-www-form-urlencoded; charset=UTF-8']) {
    const { handler, sb } = await notifyWith();
    const s = streamReq(2 * 1024 * 1024, type);
    const r = await handler(s.req);
    assert.equal(r.status, 413, type);
    assert.ok(s.sent() < 256 * 1024, `${type} 讀了 ${s.sent()} 位元組`);
    assert.equal(sb.calls.length, 0, type);
  }
  // 剛好在上限內照常處理;多 1 個位元組就 413
  {
    const { handler, sb } = await notifyWith();
    const s = streamReq(65536, 'application/x-www-form-urlencoded', 1000);
    assert.equal((await handler(s.req)).status, 400); // 讀完了,只是內容不是藍新的通知
    assert.equal(s.sent(), 65536);
    assert.equal(sb.calls.length, 0);
  }
  {
    const { handler, sb } = await notifyWith();
    const s = streamReq(65537, 'application/x-www-form-urlencoded', 1000);
    assert.equal((await handler(s.req)).status, 413);
    assert.equal(sb.calls.length, 0);
  }
});

test('審查:notify 只收 x-www-form-urlencoded;multipart 與其他格式回 415,不讀內容、不碰資料庫', async () => {
  // 大的 multipart 串流:一看格式就拒絕,不會讀到上限
  for (const type of ['multipart/form-data; boundary=----x', 'MULTIPART/FORM-DATA; boundary=y']) {
    const { handler, sb } = await notifyWith();
    const s = streamReq(2 * 1024 * 1024, type);
    assert.equal((await handler(s.req)).status, 415, type);
    assert.ok(s.sent() <= 16384, `${type} 讀了 ${s.sent()} 位元組`);
    assert.equal(sb.calls.length, 0, type);
  }
  // 上限以內、內容是真的藍新通知的 multipart 也一樣不收
  const fd = new FormData();
  for (const [k, v] of await makeNotify(paidPayload())) fd.append(k, v);
  const ser = new Request('http://x/', { method: 'POST', body: fd });
  const bytes = new Uint8Array(await ser.arrayBuffer());
  {
    const { handler, sb } = await notifyWith();
    const r = await handler(new Request(`${SB_URL}/newebpay-notify`, { method: 'POST', body: bytes, headers: { 'Content-Type': ser.headers.get('content-type') } }));
    assert.equal(r.status, 415);
    assert.equal(sb.calls.length, 0);
  }
  // 其他格式、沒寫格式也是 415;內容本身是合法的通知
  const good = (await makeNotify(paidPayload())).toString();
  for (const type of ['text/plain', 'application/json', 'application/x-www-form-urlencodedx', null]) {
    const { handler, sb } = await notifyWith();
    const headers = type ? { 'Content-Type': type } : {};
    const req = new Request(`${SB_URL}/newebpay-notify`, { method: 'POST', body: new TextEncoder().encode(good), headers });
    assert.equal((await handler(req)).status, 415, String(type));
    assert.equal(sb.calls.length, 0, String(type));
  }
  // 帶 charset 的 urlencoded 照收
  {
    const { handler, sb } = await notifyWith();
    const req = new Request(`${SB_URL}/newebpay-notify`, { method: 'POST', body: good, headers: { 'Content-Type': 'Application/X-WWW-Form-Urlencoded; charset=UTF-8' } });
    assert.equal((await handler(req)).status, 200);
    assert.equal(sb.rpcCalls('newebpay_settle').length, 1);
  }
  // return 路徑收到 multipart:不讀、不碰資料庫,帶回沒有訂單編號的結果頁
  {
    const { handler, sb } = await notifyWith();
    const r = await handler(new Request(`${SB_URL}/newebpay-notify/return`, { method: 'POST', body: bytes, headers: { 'Content-Type': ser.headers.get('content-type') } }));
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `${SITE}/pay-result.html`);
    assert.equal(sb.calls.length, 0);
  }
});

test('審查:明文只收 JSON;Result 要是物件、有訂單編號;付款請求才有的欄位擋下,RespondType 照收', async () => {
  const { parseNotify, aesEncryptHex } = await LIB;
  const signedPlain = async (plain) => signedBody(await aesEncryptHex(plain, K1.hashKey, K1.hashIV));
  const cases = [
    // query string 格式(跟我們的付款請求一樣的格式),欄位齊全也不收
    ['bad_payload', await signedPlain(`Status=SUCCESS&MerchantID=${MID}&MerchantOrderNo=${ORDER}&Amt=199&TradeNo=26110112345678901&PayTime=2026-11-01+00%3A31%3A00`)],
    ['bad_payload', await signedPlain(JSON.stringify([paidPayload()]))],
    ['bad_payload', await makeNotify({ Status: 'SUCCESS', Message: 'x' })],
    ['bad_payload', await makeNotify({ Status: 'SUCCESS', Result: null })],
    ['bad_payload', await makeNotify({ Status: 'SUCCESS', Result: [] })],
    ['bad_payload', await makeNotify({ Status: 'SUCCESS', Result: 'not json' })],
    ['bad_payload', await makeNotify({ Status: 'SUCCESS', Result: '[1]' })],
    ['no_status', await makeNotify({ ...paidPayload(), Status: 1 })],
    ['no_status', await makeNotify({ Result: paidPayload().Result })],
    ['no_order', await makeNotify(paidPayload({ MerchantOrderNo: 12345 }))],
    ['no_order', await makeNotify(paidPayload({ MerchantOrderNo: '' }))],
  ];
  for (const k of ['NotifyURL', 'ReturnURL', 'ClientBackURL', 'CustomerURL', 'TimeStamp', 'LoginType', 'TradeLimit']) {
    cases.push(['request_echo', await makeNotify(paidPayload({ [k]: k === 'TimeStamp' ? '1791345600' : 'https://x.y/z' }))]);
  }
  for (const [want, body] of cases) {
    assert.equal((await parseNotify(body, KEYS)).error, want, `${want} ${body.get('TradeInfo').slice(0, 16)}`);
    for (const route of ['/newebpay-notify', '/newebpay-notify/return']) {
      const { handler, sb } = await notifyWith();
      const r = await handler(notifyReq(body, { p: route }));
      if (route === '/newebpay-notify') assert.equal(r.status, 400, want);
      else assert.equal(r.headers.get('location'), `${SITE}/pay-result.html`, want);
      assert.equal(sb.calls.length, 0, want);
    }
  }
  // 藍新的結果本來就帶 RespondType(手冊的回傳參數有這一欄),不能當成請求欄位
  assert.equal(paidPayload().Result.RespondType, 'JSON');
  const ok = await parseNotify(await makeNotify(paidPayload()), KEYS);
  assert.equal(ok.ok, true, ok.error);
});

test('審查:拿 newebpay-checkout 回的付款請求欄位冒充通知,一律 400、不碰資料庫', async () => {
  const { handler: co } = await checkoutWith();
  const j = await (await co(checkoutReq({ sku: 'student_year', consent: true }))).json();
  assert.ok(j.fields && j.order_no);
  const { parseNotify } = await LIB;
  for (const status of ['SUCCESS', 'MPG03008', 'CUSTOM', null]) {
    const body = new URLSearchParams(j.fields);
    if (status) body.set('Status', status);
    const p = await parseNotify(body, KEYS);
    assert.equal(p.ok, false, String(status));
    assert.equal(p.error, 'bad_payload', String(status));
    for (const route of ['/newebpay-notify', '/newebpay-notify/return']) {
      const { handler, sb } = await notifyWith();
      const r = await handler(notifyReq(body, { p: route }));
      if (route === '/newebpay-notify') assert.equal(r.status, 400, `${status} ${route}`);
      else assert.equal(r.headers.get('location'), `${SITE}/pay-result.html`, `${status} ${route}`);
      assert.equal(sb.calls.length, 0, `${status} ${route}`);
    }
  }
  // 外層 Status 跟明文不同:以明文為準(明文是失敗,就算外層寫 SUCCESS 也只標失敗)
  const { handler, sb } = await notifyWith();
  const mixed = await makeNotify({ ...paidPayload({ PayTime: undefined }), Status: 'MPG03008', Message: '拒絕交易' }, { status: 'SUCCESS' });
  assert.equal((await handler(notifyReq(mixed))).status, 200);
  assert.equal(sb.rpcCalls('newebpay_settle').length, 0);
  assert.equal(sb.rpcCalls('newebpay_mark_failed').length, 1);
});

test('審查:開始收費前只賣 test10(正式、測試環境都一樣);11/1 起照常;Secret 可以改日期', async () => {
  const before = new Date('2026-10-31T15:59:59.999Z'); // 台北 10/31 23:59:59.999
  const at = new Date('2026-10-31T16:00:00Z');         // 台北 11/1 00:00:00
  const { DEFAULT_SALES_START } = await CHECKOUT;
  assert.equal(DEFAULT_SALES_START, '2026-11-01T00:00:00+08:00');
  const notOpen = { error: 'not_open', message: '11 月 1 日開放購買。' };
  for (const envName of ['production', 'test']) {
    for (const sku of ['student_month', 'student_year', 'teacher30_year', 'teacher10_month', 'correction_one', 'correction_five']) {
      for (const jwt of [USER_JWT, OWNER_JWT]) {
        const { handler, sb } = await checkoutWith({ now: before, env: baseEnv({ NEWEBPAY_ENV: envName }) });
        const r = await handler(checkoutReq({ sku, consent: true }, { jwt }));
        assert.equal(r.status, 409, `${envName} ${sku}`);
        assert.deepEqual(await r.json(), notOpen, `${envName} ${sku}`);
        assert.equal(sb.rpcCalls('newebpay_begin_checkout').length, 0, `${envName} ${sku}`);
      }
    }
    // 站長的 NT$10 測試在開賣前可以做(是不是站長由資料庫判斷)
    const { handler: owner, sb: osb } = await checkoutWith({ now: before, env: baseEnv({ NEWEBPAY_ENV: envName }) });
    assert.equal((await owner(checkoutReq({ sku: 'test10', consent: true }, { jwt: OWNER_JWT }))).status, 200, envName);
    assert.equal(osb.rpcCalls('newebpay_begin_checkout').length, 1, envName);
    // 11/1 00:00 整開始照常
    const { handler: onTime, sb: tsb } = await checkoutWith({ now: at, env: baseEnv({ NEWEBPAY_ENV: envName }) });
    assert.equal((await onTime(checkoutReq({ sku: 'student_month', consent: true }, { jwt: OWNER_JWT }))).status, 200, envName);
    assert.equal(tsb.rpcCalls('newebpay_begin_checkout').length, 1, envName);
  }
  // 沒同意、代號不對照舊回 400(開賣前也一樣,先看請求本身對不對)
  {
    const { handler } = await checkoutWith({ now: before });
    assert.equal((await handler(checkoutReq({ sku: 'student_month', consent: false }))).status, 400);
    assert.equal((await handler(checkoutReq({ sku: 'nope', consent: true }))).status, 400);
  }
  // Secret 提早或延後
  const { handler: early } = await checkoutWith({ now: before, env: baseEnv({ NEWEBPAY_SALES_START: '2026-10-20T00:00:00+08:00' }) });
  assert.equal((await early(checkoutReq({ sku: 'student_month', consent: true }))).status, 200);
  const { handler: later } = await checkoutWith({ now: at, env: baseEnv({ NEWEBPAY_SALES_START: '2026-12-01T09:00:00+08:00' }) });
  const lr = await later(checkoutReq({ sku: 'student_month', consent: true }));
  assert.equal(lr.status, 409);
  assert.deepEqual(await lr.json(), { error: 'not_open', message: '12 月 1 日開放購買。' });
  const { handler: utc } = await checkoutWith({ now: new Date('2026-11-30T15:59:59Z'), env: baseEnv({ NEWEBPAY_SALES_START: '2026-11-30T16:00:00Z' }) });
  assert.deepEqual(await (await utc(checkoutReq({ sku: 'student_month', consent: true }))).json(), { error: 'not_open', message: '12 月 1 日開放購買。' });
  // Secret 寫錯:整個停下(連 test10 都不建單),不默默改用預設日期
  for (const bad of ['2026-11-01', 'tomorrow', '2026-11-01T00:00:00', '2026-13-01T00:00:00+08:00']) {
    const { handler: h, sb } = await checkoutWith({ now: at, env: baseEnv({ NEWEBPAY_SALES_START: bad }) });
    assert.equal((await h(checkoutReq({ sku: 'student_month', consent: true }))).status, 500, bad);
    assert.equal((await h(checkoutReq({ sku: 'test10', consent: true }, { jwt: OWNER_JWT }))).status, 500, bad);
    assert.equal(sb.rpcCalls('newebpay_begin_checkout').length, 0, bad);
  }
});

test('審查:資料庫 raise 的訊息(P0001)一律回 409 {error: not_allowed, message};其他錯誤不外洩', async () => {
  const msgs = ['你的帳號已經可以使用，不需要購買這個方案。', '11 月 1 日開放購買。', '一小時內有太多筆還沒完成的付款，請稍後再試'];
  for (const m of msgs) {
    const sb = fakeSupabase({ rpcReply: () => ({ status: 400, body: { code: 'P0001', message: m, details: null, hint: null } }) });
    const { handler } = await checkoutWith({ sb });
    const r = await handler(checkoutReq({ sku: 'student_year', consent: true }));
    assert.equal(r.status, 409, m);
    assert.deepEqual(await r.json(), { error: 'not_allowed', message: m });
  }
  // 批改點數不受「已經可以使用」影響是資料庫的事;這裡只確認 Edge 原樣轉達、不自己擋
  const sb = fakeSupabase();
  const { handler } = await checkoutWith({ sb });
  assert.equal((await handler(checkoutReq({ sku: 'correction_one', consent: true }))).status, 200);
  // 不是 P0001:500、固定訊息,不帶資料庫原文
  for (const code of ['42501', '23514', 'XX000']) {
    const sb2 = fakeSupabase({ rpcReply: () => ({ status: 400, body: { code, message: 'secret detail from db' } }) });
    const { handler: h2 } = await checkoutWith({ sb: sb2 });
    const r2 = await h2(checkoutReq({ sku: 'student_year', consent: true }));
    assert.equal(r2.status, 500, code);
    const t = await r2.text();
    assert.equal(t.includes('secret detail'), false, code);
    assert.deepEqual(JSON.parse(t), { error: '暫時無法建立付款，請稍後再試', message: '暫時無法建立付款，請稍後再試' });
  }
});

test('checkout:錯誤回應同時帶 error 與 message(前端讀 message)', async () => {
  const { handler } = await checkoutWith();
  const r401 = await handler(checkoutReq({ sku: 'student_month', consent: true }, { jwt: null }));
  assert.deepEqual(await r401.json(), { error: '請先登入', message: '請先登入' });
  const r400 = await handler(checkoutReq({ sku: 'student_month', consent: false }));
  const j400 = await r400.json();
  assert.equal(j400.message, j400.error);
  assert.match(j400.message, /同意線上服務開始使用後不適用 7 天猶豫期/);
});

// ---------- 4. 設定與原始碼 ----------

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
}

test('config.toml:只有 newebpay-notify 關掉 verify_jwt', () => {
  const toml = fs.readFileSync(path.join(REPO, 'supabase', 'config.toml'), 'utf8');
  const sections = {};
  let cur = null;
  for (const line of toml.split(/\r?\n/)) {
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (m) { cur = m[1]; sections[cur] = {}; continue; }
    const kv = /^\s*([a-z_]+)\s*=\s*([^#]+?)\s*(#.*)?$/.exec(line);
    if (kv && cur) sections[cur][kv[1]] = kv[2];
  }
  assert.equal(sections['functions.newebpay-notify'].verify_jwt, 'false');
  assert.equal(sections['functions.newebpay-checkout'].verify_jwt, 'true');
  const off = Object.entries(sections).filter(([, v]) => v.verify_jwt === 'false').map(([k]) => k);
  assert.deepEqual(off, ['functions.newebpay-notify']);
});

test('build_edge_dashboard:攤平後沒有上層 import,檔案齊全,內容只改 import 路徑', () => {
  const os = require('os');
  const { build } = require('./build_edge_dashboard.js');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nwp-dash-'));
  try {
    const r = build(out);
    assert.deepEqual(r['newebpay-checkout'], ['handler.ts', 'index.ts', 'newebpay.ts', 'products.ts', 'supabase_rest.ts']);
    assert.deepEqual(r['newebpay-notify'], ['handler.ts', 'index.ts', 'newebpay.ts', 'supabase_rest.ts']);
    for (const [fnName, files] of Object.entries(r)) {
      for (const f of files) {
        const src = fs.readFileSync(path.join(out, fnName, f), 'utf8');
        assert.equal(/from '\.\.\//.test(src), false, `${fnName}/${f}`);
        const orig = fs.readFileSync(path.join(FN, f === 'index.ts' || f === 'handler.ts' ? fnName : '_shared', f), 'utf8');
        assert.equal(src, orig.replace(/from '\.\.\/_shared\//g, "from './"), `${fnName}/${f}`);
      }
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Edge Function 原始碼:沒有金鑰、商店代號、站長的資料;handler 不碰 Deno;index 用 Deno.serve', () => {
  const files = walk(FN).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 7);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(REPO, f);
    assert.equal(/MS1845581245/.test(src), false, rel);
    assert.equal(/[A-Za-z0-9]{32}/.test(src.replace(/https?:\/\/\S+/g, '')), false, rel);
    assert.equal(/bonnie|8536|許|ydzcnnjnfxfmaqbszbgn|sb_secret_|service_role.*eyJ/i.test(src), false, rel);
    assert.equal(/console\.(log|info|warn|error)\([^)]*(HASH_KEY|HASH_IV|hashKey|hashIV|SERVICE_ROLE|TradeInfo)/.test(src), false, rel);
    if (/handler\.ts$|_shared/.test(f)) assert.equal(/\bDeno\./.test(src), false, rel);
    if (/index\.ts$/.test(f)) assert.match(src, /Deno\.serve\(/, rel);
  }
});
