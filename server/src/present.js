// 展示层：决定其他人的资料以什么粒度出现在你的结果里。所有发往浏览器的人选数据都必须经过这里。
// 规则（docs/PRIVACY.md 第 3 节）：
//   - 不发送内部 id，只发送“每位查看者各不相同”的代号
//   - L1 基础资料可原样展示；L2 金额只展示分档；L2 类别不展示原值，只展示“是否符合”
//   - L3 身份资料从不进入结果
import { FIELD_MAP, GENDERS, isUnknown } from '../../packages/schema/fields.js';
import { aliasFor } from './crypto.js';
import { nameFor, namer } from './names.js';

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

const CARD_FIELDS = ['age', 'heightCm', 'city', 'education', 'occupation', 'settlement', 'maritalStatus', 'childrenStatus', 'marriagePlan', 'childrenPlan', 'personality', 'lifestyle', 'incomeAnnual'];

export function presentCard(key, viewerId, person, { hideVirtual = false, name = null } = {}) {
  const facts = {};
  for (const k of CARD_FIELDS) {
    const v = formatValue(k, person.profile?.[k], { full: false });
    if (v !== null) facts[FIELD_MAP[k].label] = v;
  }
  return {
    alias: aliasFor(key, viewerId, person.id),
    name: name || nameFor(key, viewerId, person),
    simulated: hideVirtual ? false : !!person.simulated,
    gender: GENDERS[person.gender] || '',
    facts,
  };
}

// brokerFor(person) 可选：给“你可以联系的人”加上牵线状态（docs/CONTACT-BROKER.md），只有状态，没有对方 id
export function presentRelations(key, viewer, rel, { brokerFor = null, hideVirtual = false } = {}) {
  const nm = namer(key, viewer.id);
  const card = (p) => presentCard(key, viewer.id, p, { hideVirtual, name: nm(p) });
  const contactable = (p) => ({ ...card(p), ...(brokerFor ? { broker: brokerFor(p) } : {}) });
  return {
    scorer: rel.scorer,
    limits: rel.limits,
    myIdeal: rel.myIdeal.map(formatRequirement),
    summary: rel.summary,
    idealMatches: rel.idealMatches.map((m) => ({
      ...contactable(m.person),
      fit: presentScore(m.fit, m.person.profile, { subjectIsViewer: false }),
      rankRange: m.rankRange,
      tied: m.tiedWithPrevious,
      theirIdeal: m.theirIdeal.map(formatRequirement),
      myFitToThem: presentScore(m.myFitToThem, viewer.profile, { subjectIsViewer: true }),
      myPlace: m.myPlace,
      theirEligibleCount: m.theirEligibleCount,
      theirPicks: m.theirPicks.map((p) => ({ ...card(p.person), score: p.fit.total, rankRange: p.rankRange })),
    })),
    // 理想型的理想型：和你同性别，不能牵线，只给卡片上的粗粒度事实
    idealOfIdeal: (rel.idealOfIdeal || []).map((a) => ({ ...card(a.person), score: a.score, rankRange: a.rankRange, fullyMetIdeals: a.fullN, eligibleIdeals: a.eligibleN })),
    myPlaceA: rel.myPlaceA,
    // 你自己的卡片事实（和别人同样的粒度），用于和理想型的理想型逐条对照
    myFacts: presentCard(key, viewer.id, viewer).facts,
    seekers: rel.seekers.map((s) => ({
      ...contactable(s.person),
      theirIdeal: s.person.requirements.map(formatRequirement),
      myFitToThem: presentScore(s.myFitToThem, viewer.profile, { subjectIsViewer: true }),
      theirFitToMyIdeal: s.theirFitToMyIdeal.total,
      theirFitEligible: s.theirFitToMyIdeal.eligible,
      fit: presentScore(s.theirFitToMyIdeal, s.person.profile, { subjectIsViewer: false }),
    })),
    mutual: rel.mutual.map((m) => ({
      ...contactable(m.person),
      mutualScore: m.mutualScore,
      fitToMyIdeal: m.fitToMyIdeal.total,
      myFitToThem: m.myFitToThem.total,
      fit: presentScore(m.fitToMyIdeal, m.person.profile, { subjectIsViewer: false }),
      mine: presentScore(m.myFitToThem, viewer.profile, { subjectIsViewer: true }),
      theirIdeal: m.person.requirements.map(formatRequirement),
    })),
  };
}
