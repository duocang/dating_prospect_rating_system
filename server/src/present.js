// 展示层：决定其他人的资料以什么粒度出现在你的结果里。所有发往浏览器的人选数据都必须经过这里。
// 规则（docs/PRIVACY.md 第 3 节）：
//   - 不发送内部 id，只发送“每位查看者各不相同”的代号
//   - L1 基础资料可原样展示；L2 金额只展示分档；L2 类别不展示原值，只展示“是否符合”
//   - L3 身份资料从不进入结果
import { FIELD_MAP, GENDERS, isUnknown } from '../../packages/schema/fields.js';
import { aliasFor } from './crypto.js';

const wan = (x) => `${Math.round((x / 10000) * 10) / 10} 万`;

export function moneyBand(field, value) {
  if (isUnknown(value)) return '未填写';
  if (typeof value === 'string') return value; // 已是分档
  const bands = field.displayBands || [0];
  let lo = bands[0], hi = null;
  for (const b of bands) { if (value >= b) lo = b; else { hi = b; break; } }
  return hi === null ? `${wan(lo)}以上` : `${wan(lo)}–${wan(hi)}`;
}

export function formatValue(fieldKey, value, { full }) {
  const f = FIELD_MAP[fieldKey];
  if (isUnknown(value)) return '未填写';
  if (f.type === 'money') return full && typeof value === 'number' ? wan(value) : moneyBand(f, value);
  if (f.tier === 'L2' && !full) return null; // 不向他人展示
  if (typeof value === 'object') return `${value.min ?? '?'}–${value.max ?? '?'}${f.unit || ''}`;
  return f.unit && f.type === 'number' ? `${value} ${f.unit}` : String(value);
}

export function formatRequirement(req) {
  const f = FIELD_MAP[req.field];
  if (!f) return '';
  const fmt = (v) => (f.type === 'money' ? wan(Number(v)) : `${v}${f.unit ? ' ' + f.unit : ''}`);
  const t = req.target;
  let text;
  switch (req.op) {
    case 'range': text = `${fmt(t[0])}–${fmt(t[1])}`; break;
    case 'atLeast': text = `至少 ${fmt(t)}`; break;
    case 'atMost': text = `至多 ${fmt(t)}`; break;
    case 'about': text = `约 ${fmt(t)}`; break;
    case 'in': text = (Array.isArray(t) ? t : [t]).join(' / '); break;
    default: text = String(t);
  }
  const imp = req.importance === 'must' ? '必须' : { 1: '灵活', 2: '重要', 3: '很重要' }[req.importance] || '';
  return { field: req.field, label: f.label, text, importance: imp, must: req.importance === 'must' };
}

const STATUS = { met: '符合', partial: '部分符合', range: '可能符合（资料为区间）', unmet: '不符合', unknown: '未填写' };

// subjectIsViewer：被打分的是不是查看者本人（本人的资料可以完整展示）
export function presentScore(result, profile, { subjectIsViewer }) {
  if (!result) return null;
  return {
    total: result.total,
    coverage: result.coverage,
    gate: result.gate.status,
    eligible: result.eligible,
    items: result.items.map((i) => ({
      label: i.label,
      must: i.must,
      requirement: formatRequirement(i).text,
      value: formatValue(i.field, profile?.[i.field], { full: subjectIsViewer }),
      status: STATUS[i.status] || i.status,
      score: i.score,
      weight: Math.round(i.weight * 1000) / 10,
    })),
  };
}

const CARD_FIELDS = ['age', 'heightCm', 'city', 'education', 'occupation', 'settlement', 'marriagePlan', 'childrenPlan', 'personality', 'lifestyle', 'incomeAnnual'];

export function presentCard(key, viewerId, person) {
  const facts = {};
  for (const k of CARD_FIELDS) {
    const v = formatValue(k, person.profile?.[k], { full: false });
    if (v !== null) facts[FIELD_MAP[k].label] = v;
  }
  return {
    alias: aliasFor(key, viewerId, person.id),
    simulated: !!person.simulated,
    gender: GENDERS[person.gender] || '',
    facts,
  };
}

export function presentRelations(key, viewer, rel) {
  const card = (p) => presentCard(key, viewer.id, p);
  return {
    scorer: rel.scorer,
    limits: rel.limits,
    myIdeal: rel.myIdeal.map(formatRequirement),
    summary: rel.summary,
    idealMatches: rel.idealMatches.map((m) => ({
      ...card(m.person),
      fit: presentScore(m.fit, m.person.profile, { subjectIsViewer: false }),
      rankRange: m.rankRange,
      tied: m.tiedWithPrevious,
      theirIdeal: m.theirIdeal.map(formatRequirement),
      myFitToThem: presentScore(m.myFitToThem, viewer.profile, { subjectIsViewer: true }),
      myPlace: m.myPlace,
      theirEligibleCount: m.theirEligibleCount,
      theirPicks: m.theirPicks.map((p) => ({ ...card(p.person), score: p.fit.total, rankRange: p.rankRange })),
    })),
    seekers: rel.seekers.map((s) => ({
      ...card(s.person),
      theirIdeal: s.person.requirements.map(formatRequirement),
      myFitToThem: presentScore(s.myFitToThem, viewer.profile, { subjectIsViewer: true }),
      theirFitToMyIdeal: s.theirFitToMyIdeal.total,
      theirFitEligible: s.theirFitToMyIdeal.eligible,
    })),
    mutual: rel.mutual.map((m) => ({
      ...card(m.person),
      mutualScore: m.mutualScore,
      fitToMyIdeal: m.fitToMyIdeal.total,
      myFitToThem: m.myFitToThem.total,
    })),
  };
}
