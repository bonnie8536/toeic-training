// products.ts:伺服器自己的價格表。實際收多少錢只看這裡,瀏覽器送來的金額一律不用。
// 數字要跟 js/plans-config.js(畫面顯示用)一致,node tools/test_newebpay.js 會比對。
// 商品代號(sku)跟 paid_gateway_additions.sql 的 newebpay_begin_checkout 核對表是同一組,改的時候兩邊一起改。
// ItemDesc 會出現在藍新付款頁與信用卡交易紀錄:50 字以內、不能有換行或單引號、不放任何人的名字。
// 寫法跟網站一樣(價格頁、付款結果頁):「學生方案 一個月」「老師方案 30 位以內 一年」「寫作批改 5 篇」,
// 只是這裡用一般空白(網站用不斷行空白)。UTF-8 也壓在 50 位元組以內,因為手冊沒寫清楚 50 是字還是位元組。

export type Item = 'student' | 'teacher' | 'credits';
export type Product = Readonly<{
  sku: string;
  item: Item;
  months: number | null;
  seats: number | null;
  credits: number | null;
  amount: number;
  desc: string;
  ownerOnly: boolean;
}>;

// 付款前勾選同意「開始使用後不適用 7 天解除權」所根據的條款版本(terms.html、refund.html 的適用日期)。
// 條款改版時改這裡,資料庫會記下每一筆付款是照哪一版同意的。
export const CONSENT_VERSION = 'terms-2026-10-17';

const TEACHER_YEAR_MONTHS = 10; // 年繳收 10 個月(她 2026-10-07 決定)

function p(sku: string, item: Item, months: number | null, seats: number | null, credits: number | null,
  amount: number, desc: string, ownerOnly = false): Product {
  return Object.freeze({ sku, item, months, seats, credits, amount, desc, ownerOnly });
}

const LIST: Product[] = [
  p('student_month', 'student', 1, null, null, 199, '衝衝英文 學生方案 一個月'),
  p('student_year', 'student', 12, null, null, 1990, '衝衝英文 學生方案 一年'),
  p('teacher10_month', 'teacher', 1, 10, null, 390, '衝衝英文 老師方案 10 位以內 一個月'),
  p('teacher10_year', 'teacher', 12, 10, null, 390 * TEACHER_YEAR_MONTHS, '衝衝英文 老師方案 10 位以內 一年'),
  p('teacher30_month', 'teacher', 1, 30, null, 890, '衝衝英文 老師方案 30 位以內 一個月'),
  p('teacher30_year', 'teacher', 12, 30, null, 890 * TEACHER_YEAR_MONTHS, '衝衝英文 老師方案 30 位以內 一年'),
  p('teacher60_month', 'teacher', 1, 60, null, 1490, '衝衝英文 老師方案 60 位以內 一個月'),
  p('teacher60_year', 'teacher', 12, 60, null, 1490 * TEACHER_YEAR_MONTHS, '衝衝英文 老師方案 60 位以內 一年'),
  p('correction_one', 'credits', null, null, 1, 150, '衝衝英文 寫作批改 1 篇'),
  p('correction_five', 'credits', null, null, 5, 650, '衝衝英文 寫作批改 5 篇'),
  // 站長專用的正式環境測試:刷 10 元確認付款與通知都通,入帳時不開通任何東西,刷完到藍新後台退款。
  // 只有站長能建單(資料庫 newebpay_begin_checkout 用 _is_owner 擋)。item / credits 只是佔位。
  p('test10', 'credits', null, null, 1, 10, '衝衝英文 站長測試項目', true),
];

export const PRODUCTS: ReadonlyMap<string, Product> = new Map(LIST.map((x) => [x.sku, x]));

// 只認價格表裡的代號;其他任何值(含 __proto__、constructor 這類)都回 null
export function findProduct(sku: unknown): Product | null {
  if (typeof sku !== 'string' || !/^[a-z0-9_]{1,30}$/.test(sku)) return null;
  return PRODUCTS.get(sku) ?? null;
}
