// 输入校验与数据最小化：只接受注册表中的字段和选项，其他内容直接丢弃或拒绝。
import { FIELD_MAP, GENDERS, UNKNOWN_VALUES } from '../../packages/schema/fields.js';

const BOUNDS = { age: [18, 80], heightCm: [120, 230], incomeAnnual: [0, 1e8] };
const OPPOSITE = { female: 'male', male: 'female' };

export class ValidationError extends Error {}
const fail = (m) => { throw new ValidationError(m); };

function checkNumber(key, v) {
  const n = Number(v);
  const [a, b] = BOUNDS[key] || [-1e12, 1e12];
  if (!Number.isFinite(n) || n < a || n > b) fail(`${FIELD_MAP[key].label} 超出范围`);
  return n;
}

function checkValue(key, v) {
  const f = FIELD_MAP[key];
  if (v === null || v === undefined || v === '') return null;
  if (UNKNOWN_VALUES.includes(v)) return v;
  if (f.type === 'number') return checkNumber(key, v);
  if (f.type === 'money') {
    if (typeof v === 'string' && f.bands?.[v]) return v;
    return checkNumber(key, v);
  }
  const allowed = f.levels || f.options;
  if (!allowed.includes(v)) fail(`${f.label} 的选项无效`);
  return v;
}

export function validateProfile(body) {
  const gender = body?.gender;
  if (!GENDERS[gender]) fail('请选择性别');
  // 当前服务范围只包含异性恋用户
  const seeks = [OPPOSITE[gender]];
  const profile = {};
  for (const [k, v] of Object.entries(body.profile || {})) {
    if (!FIELD_MAP[k]) continue;
    const c = checkValue(k, v);
    if (c !== null) profile[k] = c;
  }
  return { gender, seeks, profile };
}

export function validateRequirements(list) {
  if (!Array.isArray(list)) fail('要求格式无效');
  if (list.length > 30) fail('要求过多');
  const seen = new Set();
  return list.map((r) => {
    const f = FIELD_MAP[r?.field];
    if (!f) fail('未知的要求字段');
    if (seen.has(r.field)) fail(`${f.label} 重复`);
    seen.add(r.field);
    const importance = r.importance === 'must' ? 'must' : [1, 2, 3].includes(Number(r.importance)) ? Number(r.importance) : fail('重视程度无效');
    let { op, target } = r;
    if (f.type === 'number' || f.type === 'money') {
      if (!(f.ops || []).includes(op)) fail(`${f.label} 不支持该比较方式`);
      target = op === 'range'
        ? (Array.isArray(target) && target.length === 2 ? target.map((x) => checkNumber(r.field, x)).sort((a, b) => a - b) : fail(`${f.label} 范围无效`))
        : checkNumber(r.field, target);
    } else if (f.type === 'ordinal' && op === 'atLeast') {
      if (!f.levels.includes(target)) fail(`${f.label} 无效`);
    } else {
      op = 'in';
      const allowed = f.levels || f.options;
      target = (Array.isArray(target) ? target : [target]).filter((x) => allowed.includes(x));
      if (!target.length) fail(`${f.label} 至少选一项`);
    }
    const out = { field: r.field, op, target, importance };
    if (Array.isArray(r.preferred) && op === 'in') out.preferred = r.preferred.filter((x) => target.includes(x));
    return out;
  });
}
