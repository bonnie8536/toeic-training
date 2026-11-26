/* 小型 JSON Schema 驗證(只認 data/packs/pack_schema.json 用到的關鍵字),給 tools/check_packs.js 用,不另裝套件。
   認得:$ref(只有 #/$defs/...)、type、enum、const、pattern、minimum、maximum、minLength、maxLength(以字元計)、
   minItems、maxItems、uniqueItems、items、properties、required、additionalProperties(false 或 schema)、
   allOf、oneOf、not、if/then/else、format: date。其他關鍵字遇到就丟錯(不默默放過)。
   用法:validate(schema, value) → 錯誤陣列 [{ path, msg }],空陣列是通過。 */
'use strict';

const KNOWN = new Set(['$schema', '$id', 'title', 'description', '$defs', '$ref', 'type', 'enum', 'const', 'pattern', 'minimum', 'maximum',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'items', 'properties', 'required', 'additionalProperties',
  'allOf', 'oneOf', 'not', 'if', 'then', 'else', 'format']);
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function typeOk(want, v) {
  const t = typeOf(v);
  return want === t || (want === 'number' && t === 'integer');
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function resolve(root, ref) {
  const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  if (!m || !root.$defs || !root.$defs[m[1]]) throw new Error('認不得的 $ref：' + ref);
  return root.$defs[m[1]];
}

function checkScalar(s, v, path, errs) {
  const err = (msg) => errs.push({ path, msg });
  if (s.type !== undefined && !typeOk(s.type, v)) { err('型別要是 ' + s.type + '，實際是 ' + typeOf(v)); return; }
  if (s.enum !== undefined && !s.enum.some((x) => same(x, v))) err('值要是 ' + JSON.stringify(s.enum) + ' 之一，實際是 ' + JSON.stringify(v));
  if (s.const !== undefined && !same(s.const, v)) err('值要是 ' + JSON.stringify(s.const) + '，實際是 ' + JSON.stringify(v));
  if (typeof v === 'string') {
    const n = Array.from(v).length;
    if (s.pattern !== undefined && !new RegExp(s.pattern, 'u').test(v)) err('不符合格式 ' + s.pattern + '：' + JSON.stringify(v));
    if (s.minLength !== undefined && n < s.minLength) err('至少 ' + s.minLength + ' 個字，實際 ' + n);
    if (s.maxLength !== undefined && n > s.maxLength) err('最多 ' + s.maxLength + ' 個字，實際 ' + n);
    if (s.format === 'date' && !DATE.test(v)) err('日期格式要是 YYYY-MM-DD：' + JSON.stringify(v));
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) err('不能小於 ' + s.minimum + '，實際 ' + v);
    if (s.maximum !== undefined && v > s.maximum) err('不能大於 ' + s.maximum + '，實際 ' + v);
  }
}

function checkArray(root, s, v, path, errs) {
  if (!Array.isArray(v)) return;
  if (s.minItems !== undefined && v.length < s.minItems) errs.push({ path, msg: '至少 ' + s.minItems + ' 項，實際 ' + v.length });
  if (s.maxItems !== undefined && v.length > s.maxItems) errs.push({ path, msg: '最多 ' + s.maxItems + ' 項，實際 ' + v.length });
  if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) errs.push({ path, msg: '有重複的項目' });
  if (s.items !== undefined) v.forEach((x, i) => walk(root, s.items, x, path + '[' + i + ']', errs));
}

function checkObject(root, s, v, path, errs) {
  if (typeOf(v) !== 'object') return;
  (s.required || []).forEach((k) => { if (!Object.prototype.hasOwnProperty.call(v, k)) errs.push({ path, msg: '少了欄位 ' + k }); });
  const props = s.properties || {};
  Object.keys(v).forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(props, k)) walk(root, props[k], v[k], path + '.' + k, errs);
    else if (s.additionalProperties === false) errs.push({ path, msg: '多了不認得的欄位 ' + k });
    else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(root, s.additionalProperties, v[k], path + '.' + k, errs);
  });
}

const passes = (root, s, v) => walk(root, s, v, '', []).length === 0;

function checkCombos(root, s, v, path, errs) {
  (s.allOf || []).forEach((sub) => walk(root, sub, v, path, errs));
  if (s.oneOf) {
    const n = s.oneOf.filter((sub) => passes(root, sub, v)).length;
    if (n !== 1) errs.push({ path, msg: 'oneOf 要剛好符合一項，實際符合 ' + n + ' 項' });
  }
  if (s.not && passes(root, s.not, v)) errs.push({ path, msg: '不能符合 not 的條件' });
  if (s.if) {
    const branch = passes(root, s.if, v) ? s.then : s.else;
    if (branch) walk(root, branch, v, path, errs);
  }
}

function walk(root, s, v, path, errs) {
  if (s === true) return errs;
  if (s === false) { errs.push({ path, msg: '這裡不能有值' }); return errs; }
  Object.keys(s).forEach((k) => { if (!KNOWN.has(k)) throw new Error('schema 用了這支驗證不認得的關鍵字：' + k + '（' + path + '）'); });
  if (s.$ref) return walk(root, resolve(root, s.$ref), v, path, errs);
  const before = errs.length;
  checkScalar(s, v, path, errs);
  if (errs.length > before && s.type !== undefined && !typeOk(s.type, v)) return errs;   // 型別錯就不往下看
  checkArray(root, s, v, path, errs);
  checkObject(root, s, v, path, errs);
  checkCombos(root, s, v, path, errs);
  return errs;
}

function validate(schema, value) {
  return walk(schema, schema, value, '$', []);
}

module.exports = { validate };
