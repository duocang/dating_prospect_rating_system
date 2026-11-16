// fit-v1：逐字段条件拟合。说明见 docs/SCORING.md。
// 这是“条件拟合”，不是好感概率，也不是人的价值评分。
import { FIELD_MAP, isUnknown, toInterval } from '../../../schema/fields.js';
import { scoreNumber, scoreMoney, scoreOrdinal, scoreCategory } from './functions.js';

export const DEFAULT_PARAMS = Object.freeze({
  acceptedScore: 60,          // 类别“可接受但非理想”的分数
  ordinalBelowScores: [0],    // 学历低于下限 1 级、2 级…的分数；未列出的按 0
  minCoverage: 0.7,           // 进入正式排序所需的最低资料覆盖率（按权重）
  importanceWeights: { 1: 1, 2: 2, 3: 3 }, // 灵活/重要/很重要
});

function evaluateRequirement(req, profile, params) {
  const field = FIELD_MAP[req.field];
  if (!field) return null;
  const raw = profile?.[req.field];
  const base = { field: req.field, label: field.label, must: req.importance === 'must', op: req.op, target: req.target };

  if (isUnknown(raw)) return { ...base, known: false, exact: false, score: [0, 100], gap: null, status: 'unknown' };

  let r = null;
  let exact = true;
  if (field.type === 'number' || field.type === 'money') {
    const iv = toInterval(field, raw);
    if (!iv) return { ...base, known: false, exact: false, score: [0, 100], gap: null, status: 'unknown' };
    exact = iv.min !== null && iv.max !== null && iv.min === iv.max;
    r = field.type === 'number' ? scoreNumber(iv, req.op, req.target, req.scale ?? field.scale) : scoreMoney(iv, req.op, req.target);
    if (r === null) return null; // 金额目标为 0：没有要求
  } else if (field.type === 'ordinal') {
    r = scoreOrdinal(raw, req.op, req.target, field.levels, params);
  } else {
    r = scoreCategory(raw, req.target, req.preferred, params);
  }
  if (!r) return { ...base, known: false, exact: false, score: [0, 100], gap: null, status: 'unknown' };

  const [l, h] = r.score.map((x) => Math.round(x * 10) / 10);
  const status = l >= 100 ? 'met' : h <= 0 ? 'unmet' : l === h ? 'partial' : 'range';
  return { ...base, known: true, exact, score: [l, h], gap: r.gap, status };
}

// 组权重：一组的总权重 = 组内最高重视度；组内按重视度分摊。避免经济类字段叠加。
function assignWeights(items, params) {
  const soft = items.filter((i) => !i.must);
  // 若每条软要求都给了显式 weight（例如研究试算），直接使用，不做组内分摊
  if (soft.length && soft.every((i) => typeof i.explicitWeight === 'number')) {
    soft.forEach((i) => { i.weight = i.explicitWeight; });
    const t = soft.reduce((a, i) => a + i.weight, 0) || 1;
    soft.forEach((i) => { i.weight /= t; });
    items.filter((i) => i.must).forEach((i) => { i.weight = 0; });
    return;
  }
  const byGroup = {};
  for (const it of soft) {
    const g = FIELD_MAP[it.field].group;
    (byGroup[g] ||= []).push(it);
  }
  for (const list of Object.values(byGroup)) {
    const imps = list.map((i) => params.importanceWeights[i.importance] ?? 1);
    const groupWeight = Math.max(...imps);
    const sum = imps.reduce((a, b) => a + b, 0);
    list.forEach((it, k) => { it.weight = (groupWeight * imps[k]) / sum; });
  }
  const total = soft.reduce((a, i) => a + i.weight, 0) || 1;
  soft.forEach((i) => { i.weight = i.weight / total; });
  items.filter((i) => i.must).forEach((i) => { i.weight = 0; });
}

export function score(profile, requirements, options = {}) {
  const params = { ...DEFAULT_PARAMS, ...(options.params || {}) };
  const items = [];
  for (const req of requirements || []) {
    const it = evaluateRequirement(req, profile, params);
    if (it) items.push({ ...it, importance: req.importance, explicitWeight: req.weight });
  }
  assignWeights(items, params);

  // 门槛：所有可能值都满足才算通过；全部违反为失败；跨越阈值或未知为待核实。
  const musts = items.filter((i) => i.must);
  const failed = musts.filter((i) => i.known && i.score[1] < 100).map((i) => i.field);
  const pending = musts.filter((i) => !failed.includes(i.field) && i.score[0] < 100).map((i) => i.field);
  const gate = failed.length ? 'fail' : pending.length ? 'pending' : 'pass';

  const soft = items.filter((i) => !i.must);
  let low = 0, high = 0, coverage = 0, exactShare = 0;
  for (const i of soft) {
    low += i.weight * i.score[0];
    high += i.weight * i.score[1];
    if (i.known) coverage += i.weight;
    if (i.exact || (i.known && i.score[0] === i.score[1])) exactShare += i.weight;
  }
  if (!soft.length) { low = high = gate === 'pass' ? 100 : 0; coverage = musts.length ? musts.filter((i) => i.known).length / musts.length : 0; }

  const round1 = (x) => Math.round(x * 10) / 10;
  return {
    scorer: 'fit-v1',
    total: { low: round1(low), high: round1(high) },
    coverage: round1(coverage * 100) / 100,
    exactShare: round1(exactShare * 100) / 100,
    gate: { status: gate, failed, pending },
    eligible: gate === 'pass' && coverage >= params.minCoverage,
    softCount: soft.length,
    mustCount: musts.length,
    items,
  };
}

// 排名：调用方先按门槛与覆盖率筛选；这里按分数下界、上界、可选的 tieBreak、编号排序。并列显式标出。
export function rank(entries, options = {}) {
  const sorted = [...entries].sort((a, b) =>
    b.result.total.low - a.result.total.low || b.result.total.high - a.result.total.high ||
    (b.tieBreak ?? 0) - (a.tieBreak ?? 0) || String(a.id).localeCompare(String(b.id)));
  sorted.forEach((e, i) => {
    const prev = sorted[i - 1];
    e.tiedWithPrevious = !!prev && prev.result.total.low === e.result.total.low && prev.result.total.high === e.result.total.high;
    // 名次范围：只有当对方下界严格高于我的上界时，对方才确定在我前面
    const surelyAhead = sorted.filter((o) => o !== e && o.result.total.low > e.result.total.high).length;
    const surelyBehind = sorted.filter((o) => o !== e && o.result.total.high < e.result.total.low).length;
    e.rankRange = [surelyAhead + 1, sorted.length - surelyBehind];
  });
  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

export const fitV1 = {
  id: 'fit-v1',
  label: '逐字段条件拟合 v1',
  params: DEFAULT_PARAMS,
  score,
  rank,
};
