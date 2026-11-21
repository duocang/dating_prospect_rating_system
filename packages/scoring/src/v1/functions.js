// fit-v1 的单项计分函数。每个函数都接受“可能值区间”，返回该区间内分数的 [下界, 上界]。
// 精确值就是 min===max 的区间；分档资料（如 50–100 万）自然得到分数区间；未知值由调用方给 [0,100]。

const clamp = (x) => Math.max(0, Math.min(100, x));
const INF = Infinity;

const lo = (iv) => (iv.min === null || iv.min === undefined ? -INF : iv.min);
const hi = (iv) => (iv.max === null || iv.max === undefined ? INF : iv.max);

// 把要求转换成“理想目标区间”[L,U]
export function targetSet(op, target) {
  switch (op) {
    case 'range': return [Number(target[0]), Number(target[1])];
    case 'atLeast': return [Number(target), INF];
    case 'atMost': return [-INF, Number(target)];
    case 'about': return [Number(target), Number(target)];
    default: throw new Error(`不支持的比较方式: ${op}`);
  }
}

const distance = (x, [L, U]) => (x < L ? L - x : x > U ? x - U : 0);

// 数值差距：G(d) = 100 × max(0, 1 − d / 尺度)。d 是到理想区间最近边界的距离。
export function scoreNumber(iv, op, target, scale) {
  const T = targetSet(op, target);
  const a = lo(iv), b = hi(iv);
  const g = (d) => (d === INF ? 0 : clamp(100 * (1 - d / scale)));
  const overlap = a <= T[1] && b >= T[0];
  const dMin = overlap ? 0 : Math.min(distance(a, T), distance(b, T));
  const dMax = Math.max(distance(a, T), distance(b, T)); // 距离函数是凸的，最大值在端点
  return { score: [g(dMax), g(dMin)], gap: [dMin, dMax] };
}

// 金额：至少 t 时按比例 R(x,t)=100×min(1,x/t)；9 万对 10 万 = 90。
// 区间要求 [L,U]：低于 L 按 x/L，高于 U 按 U/x。
export function scoreMoney(iv, op, target) {
  const a = lo(iv), b = hi(iv);
  if (op === 'atLeast') {
    const t = Number(target);
    if (!(t > 0)) return null; // 目标为 0 表示没有金额要求，跳过
    const R = (x) => (x === -INF ? 0 : x === INF ? 100 : clamp((100 * Math.max(0, x)) / t));
    return { score: [R(a), R(b)], gap: [Math.max(0, t - b), Math.max(0, t - a)] };
  }
  if (op === 'atMost') {
    // 最多 t（负债）：不超过 t 满分；超过时按 t/x 递减，t 为 0（不能有负债）时超过即 0
    const t = Number(target);
    const R = (x) => (x === INF ? 0 : x <= t ? 100 : t > 0 ? clamp((100 * t) / x) : 0);
    return { score: [R(b), R(a)], gap: [Math.max(0, a - t), b === INF ? INF : Math.max(0, b - t)] };
  }
  if (op === 'range') {
    const [L, U] = [Number(target[0]), Number(target[1])];
    const f = (x) => {
      if (x === -INF || x === INF) return 0;
      if (x < L) return L > 0 ? clamp((100 * Math.max(0, x)) / L) : 0;
      if (x > U) return clamp((100 * U) / x);
      return 100;
    };
    const overlap = a <= U && b >= L;
    return { score: [Math.min(f(a), f(b)), overlap ? 100 : Math.max(f(a), f(b))], gap: null };
  }
  throw new Error(`金额不支持的比较方式: ${op}`);
}

// 有序等级（学历）：达到下限 100，低于下限按 belowScores 逐级给分（默认 0）。
export function scoreOrdinal(value, op, target, levels, params) {
  const idx = levels.indexOf(value);
  if (idx < 0) return null;
  if (op === 'in') return { score: Array(2).fill(target.includes(value) ? 100 : 0), gap: null };
  const t = levels.indexOf(target);
  if (idx >= t) return { score: [100, 100], gap: [0, 0] };
  const below = params.ordinalBelowScores[t - idx - 1] ?? 0;
  return { score: [below, below], gap: [t - idx, t - idx] };
}

// 类别：理想类别 100；只是“可接受”的类别 acceptedScore（默认 60）；其他 0。
// 没有单独列出理想类别时，可接受集合全部 100。
export function scoreCategory(value, target, preferred, params) {
  const accepted = Array.isArray(target) ? target : [target];
  if (preferred && preferred.length) {
    if (preferred.includes(value)) return { score: [100, 100], gap: null };
    if (accepted.includes(value)) return { score: [params.acceptedScore, params.acceptedScore], gap: null };
    return { score: [0, 0], gap: null };
  }
  const s = accepted.includes(value) ? 100 : 0;
  return { score: [s, s], gap: null };
}
