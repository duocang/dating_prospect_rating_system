// 按城市参数生成模拟人选：移植自 archive 里冻结的上海 500 人生成器（generate.mjs）。
// 一个城市一个种子，同一城市每次生成同样的 500 人；纯同步、无 I/O，只做内存计算。
// 输出形状与 server/seed/sim-pool.json 中每个人完全一致：{ id, simulated, gender, seeks, profile, requirements }。
import { FIELD_MAP, UNKNOWN_VALUES } from '../../packages/schema/fields.js';

const LEVELS = ['高中及以下', '大专', '本科', '硕士', '博士'];
const HOMES = ['合租', '整租', '与父母同住', '自有住房（有贷款）', '自有住房（无贷款）', '单位宿舍'];
const SUPPORT = ['主要提供情感支持', '可应急小额支持', '可部分支持首付', '需本人反向支持', '不清楚', '不愿透露'];
const FAMILY_ASSET_BANDS = ['净资产为负', '0–50万元', '50–150万元', '150–300万元', '300–600万元', '600–1,000万元', '不清楚', '不愿透露'];
const PERSONAL_ASSET_BANDS = ['净资产为负', '0–10万元', '10–50万元', '50–100万元', '100–300万元', '300–600万元', '600–1,000万元', '不清楚', '不愿透露'];
const SETTLE = ['计划长期定居本城', '城市可协商', '未来可能离开本城'];
const MARRIAGE = ['1–3年内考虑结婚', '长期伴侣，暂不结婚', '婚姻安排可协商'];
const CHILDREN = ['希望育儿', '不计划育儿', '尚未决定'];
const LIFESTYLE = ['规律作息', '弹性作息', '偏好安静', '喜欢社交', '户外运动', '居家休闲'];
// 对长相的要求：后加的字段，用单独的随机数流抽，原来每个人的其他资料保持不变
const LOOKS = [['希望对方更好看', 15], ['和我差不多就好', 45], ['对方普通也可以', 15], ['不太在意长相', 25]];
const PERSONALITY = ['直接沟通', '慢热温和', '活跃外向', '独立安静'];
const OCCUPATIONS = ['零售与服务', '行政与运营', '制造与工程', '教育与培训', '医疗与健康', '软件与技术', '物流与交通', '财务与商务', '设计与传媒'];
const IMPORTANCE_KEYS = ['年龄', '身高', '收入', '学历', '住房', '定居', '家庭支持', '婚姻', '育儿', '性格', '生活方式'];
const IMP_KEYS = { age: '年龄', heightCm: '身高', incomeAnnual: '收入', education: '学历', housing: '住房', settlement: '定居', familySupport: '家庭支持', marriagePlan: '婚姻', childrenPlan: '育儿', personality: '性格', lifestyle: '生活方式' };
const GENDER = { 女: 'female', 男: 'male' };

// 年收入四档权重：3–7 万 / 8–20 万 / 21–35 万 / 36–65 万。baseline 为冻结生成器原值。
const INCOME_BANDS = {
  baseline: [10, 68, 18, 4],
  metro: [4, 50, 34, 12],
  strong: [6, 56, 30, 8],
  solid: [8, 62, 24, 6],
  mid: [18, 68, 12, 2],
  low: [32, 60, 7, 1],
  private: [14, 66, 16, 4],
  resource: [24, 38, 18, 20], // 资源型：高收入与低收入两头偏多
};
const INCOME_RANGES = [[3, 7], [8, 20], [21, 35], [36, 65]];
// 学历权重：base 为冻结生成器原值（本科出现 3 次），其余按倾向重排。
const EDU_WEIGHTS = {
  base: [['高中及以下', 1], ['大专', 1], ['本科', 3], ['硕士', 1], ['博士', 1]],
  high: [['高中及以下', 4], ['大专', 10], ['本科', 42], ['硕士', 30], ['博士', 14]],
  mid: [['高中及以下', 10], ['大专', 18], ['本科', 46], ['硕士', 20], ['博士', 6]],
  low: [['高中及以下', 18], ['大专', 30], ['本科', 44], ['硕士', 6], ['博士', 2]],
};
// 年龄范围：standard 为冻结生成器原值 22–39。
const AGE_RANGE = { standard: [22, 45], young: [22, 38], midyoung: [22, 42], mature: [25, 48] };
// 职业倾向：命中的职业权重抬高，其余保持 1。
const OCC_BOOST = {
  finance: ['财务与商务'], public: ['行政与运营', '教育与培训'], tech: ['软件与技术'],
  manufacturing: ['制造与工程'], trade: ['零售与服务'], port: ['物流与交通'], resource: ['制造与工程'],
};

// 与冻结生成器同款的 LCG 随机数；每座城市独立种子。
function makeRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// FNV-1a：把城市 id 稳定映射成种子，保证同一城市每次结果相同。
function seedFromCity(cityId) {
  let h = 2166136261;
  for (let i = 0; i < cityId.length; i += 1) { h ^= cityId.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function pickWeighted(rng, entries) {
  let n = rng() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of entries) { n -= weight; if (n < 0) return value; }
  return entries[entries.length - 1][0];
}

function drawPersonalAssetBand(rng, housing) {
  const owned = housing.startsWith('自有住房');
  return pickWeighted(rng, owned
    ? [['净资产为负', 5], ['0–10万元', 8], ['10–50万元', 14], ['50–100万元', 20], ['100–300万元', 27], ['300–600万元', 16], ['600–1,000万元', 5], ['不清楚', 3], ['不愿透露', 2]]
    : [['净资产为负', 8], ['0–10万元', 22], ['10–50万元', 29], ['50–100万元', 18], ['100–300万元', 11], ['300–600万元', 4], ['600–1,000万元', 1], ['不清楚', 4], ['不愿透露', 3]]);
}

function drawFamilyAssetBand(rng, parentsHousing, supportLevel) {
  const owns = parentsHousing.startsWith('自有住房');
  const mortgage = parentsHousing.includes('有贷款');
  const entries = owns && !mortgage
    ? [['净资产为负', 2], ['0–50万元', 7], ['50–150万元', 15], ['150–300万元', 23], ['300–600万元', 29], ['600–1,000万元', 14], ['不清楚', 6], ['不愿透露', 4]]
    : owns && mortgage
      ? [['净资产为负', 7], ['0–50万元', 13], ['50–150万元', 22], ['150–300万元', 24], ['300–600万元', 19], ['600–1,000万元', 7], ['不清楚', 5], ['不愿透露', 3]]
      : [['净资产为负', 10], ['0–50万元', 17], ['50–150万元', 22], ['150–300万元', 19], ['300–600万元', 13], ['600–1,000万元', 5], ['不清楚', 8], ['不愿透露', 6]];
  const adjusted = entries.map(([value, weight]) => [value, value === '不清楚' && supportLevel === '不清楚' ? weight + 2 : weight]);
  return pickWeighted(rng, adjusted);
}

// 与 scripts/build-sim-pool.mjs 相同的转换：把原始抽取结果压成池里每个人的字段。
function categoryReq(field, accepted, importance) {
  const opts = FIELD_MAP[field].options;
  const list = (accepted || []).filter((v) => !UNKNOWN_VALUES.includes(v));
  if (!list.length || opts.every((o) => list.includes(o))) return null;
  return { field, op: 'in', target: list, importance };
}

// 婚姻状况和有没有孩子：老生成器没有这两项。按 id 的哈希单独抽，不打乱原来的随机序列，已有虚拟人选的其他资料不变
function hashUnit(id, salt) {
  let h = 2166136261;
  for (const ch of salt + id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
function maritalOf(p) {
  const u = hashUnit(p.id, 'm'), older = p.age >= 30;
  const status = u < (older ? 0.82 : 0.95) ? '未婚' : u < (older ? 0.98 : 0.995) ? '离异' : '丧偶';
  const k = hashUnit(p.id, 'k');
  const kids = status === '未婚' ? '没有孩子' : k < 0.5 ? '没有孩子' : k < 0.8 ? '有孩子，跟我生活' : '有孩子，不跟我生活';
  // 要求：约六成只接受未婚，约两成接受未婚或离异，其余不限；孩子：约一半要求对方没有孩子
  const r = hashUnit(p.id, 'r'), c = hashUnit(p.id, 'c');
  const reqs = [
    r < 0.6 ? { field: 'maritalStatus', op: 'in', target: ['未婚'], importance: 2 } : r < 0.8 ? { field: 'maritalStatus', op: 'in', target: ['未婚', '离异'], importance: 1 } : null,
    c < 0.5 ? { field: 'childrenStatus', op: 'in', target: ['没有孩子'], importance: c < 0.15 ? 'must' : 2 } : null,
  ].filter(Boolean);
  return { status, kids, reqs };
}

function convert(p) {
  const pr = p.preferences;
  const imp = (k) => pr.importance?.[IMP_KEYS[k]] ?? 1;
  const requirements = [
    { field: 'age', op: 'range', target: pr.age, importance: imp('age') },
    { field: 'heightCm', op: 'range', target: pr.heightCm, importance: imp('heightCm') },
    pr.minIncomeRmb > 0 ? { field: 'incomeAnnual', op: 'atLeast', target: pr.minIncomeRmb, importance: pr.incomeHard ? 'must' : imp('incomeAnnual') } : null,
    pr.educationMin && pr.educationMin !== '高中及以下' ? { field: 'education', op: 'atLeast', target: pr.educationMin, importance: imp('education') } : null,
    categoryReq('housing', pr.housingAccepted, imp('housing')),
    categoryReq('settlement', pr.settlementAccepted, imp('settlement')),
    categoryReq('familySupport', pr.familySupportAccepted, imp('familySupport')),
    categoryReq('marriagePlan', pr.marriageAccepted, imp('marriagePlan')),
    categoryReq('childrenPlan', pr.childrenAccepted, imp('childrenPlan')),
    categoryReq('personality', pr.personalityAccepted, imp('personality')),
    categoryReq('lifestyle', pr.lifestyleAccepted, imp('lifestyle')),
    categoryReq('looksCare', p.looks.accepted, p.looks.importance),
    categoryReq('car', p.extra.carAccepted, p.extra.carImp),
    p.extra.debtMax !== null ? { field: 'debt', op: 'atMost', target: p.extra.debtMax, importance: p.extra.debtImp } : null,
  ].filter(Boolean);
  const ms = maritalOf(p);
  requirements.push(...ms.reqs);
  const f = p.family;
  return {
    id: p.id,
    simulated: true,
    gender: GENDER[p.gender],
    seeks: p.seeks.map((g) => GENDER[g]),
    profile: {
      age: p.age, heightCm: p.heightCm, city: p.city, settlement: p.settlement,
      education: p.education, occupation: p.occupation, incomeAnnual: p.annualIncomeRmb,
      personalNetAssets: p.personalNetAssetsBand, housing: p.housing,
      familySupport: f.support, familyNetAssets: f.netAssetsBand, parentsSecurity: f.parentsSecurity,
      siblings: f.siblings, care: f.care, parentsMarriage: f.parentsMarriage,
      maritalStatus: ms.status, childrenStatus: ms.kids,
      marriagePlan: p.marriage, childrenPlan: p.children, personality: p.personality, lifestyle: p.lifestyle, looksCare: p.looks.care, car: p.extra.car, debt: p.extra.debt,
    },
    requirements,
  };
}

// 生成一座城市的人选池。count 默认 500；城市参数缺省时退回冻结生成器的原始分布。
export function generateCityPool({ cityId, cityName, count = 500, incomeBand = 'baseline', eduTilt = 'base', ageSkew = 'standard', occ, seed } = {}) {
  const actualSeed = seed != null ? seed : (cityId === 'SH' ? 20261113 : seedFromCity(cityId || ''));
  const rng = makeRng(actualSeed);
  const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const incomeWeights = INCOME_BANDS[incomeBand] || INCOME_BANDS.baseline;
  const eduEntries = EDU_WEIGHTS[eduTilt] || EDU_WEIGHTS.base;
  const [ageLo, ageHi] = AGE_RANGE[ageSkew] || AGE_RANGE.standard;
  const occBoost = new Set(OCC_BOOST[occ] || []);
  const occEntries = OCCUPATIONS.map((o) => [o, occBoost.has(o) ? 4 : 1]);
  const femaleCount = Math.floor(count / 2);

  const raw = Array.from({ length: count }, (_, i) => {
    const gender = i < femaleCount ? '女' : '男';
    // 抽取顺序与冻结生成器保持一致，保证种子与分布口径可复现。
    // 年龄：两头少、中间多（大致集中在 26–34 岁）；身高按性别取近似正态分布
    const tri = (lo, hi) => Math.round(lo + (hi - lo) * ((rng() + rng() + rng()) / 3));
    const age = tri(ageLo, ageHi);
    const normal = (mean, sd) => Math.round(mean + sd * ((rng() + rng() + rng() + rng() + rng() + rng()) - 3) / 0.7071);
    const height = gender === '男' ? Math.min(195, Math.max(158, normal(173, 6))) : Math.min(182, Math.max(148, normal(161, 5)));
    const band = pickWeighted(rng, [[0, incomeWeights[0]], [1, incomeWeights[1]], [2, incomeWeights[2]], [3, incomeWeights[3]]]);
    const income = int(INCOME_RANGES[band][0], INCOME_RANGES[band][1]) * 10000;
    const housing = pick(HOMES);
    const familySupport = pick(SUPPORT);
    const parentsHousing = pick(['自有住房无贷款', '自有住房有贷款', '租住', '与亲属同住', '不清楚', '不愿透露']);
    const parentsMarriageStatus = pickWeighted(rng, [['父母目前为婚姻关系', 86], ['父母离异', 8], ['一方丧偶', 3], ['不清楚', 2], ['不愿透露', 1]]);
    const personalNetAssetsBand = drawPersonalAssetBand(rng, housing);
    const familyNetAssetsBand = drawFamilyAssetBand(rng, parentsHousing, familySupport);
    const seeks = [gender === '女' ? '男' : '女'];
    return {
      id: `${cityId}-SIM-${String(i + 1).padStart(3, '0')}`,
      synthetic: true,
      orientation: '异性恋',
      city: cityName,
      status: '单身',
      monthsInShanghai: int(6, 180), // 字段名沿用冻结口径；转换时丢弃，只为保持抽取顺序。
      gender,
      seeks,
      age,
      heightCm: height,
      education: pickWeighted(rng, eduEntries),
      occupation: pickWeighted(rng, occEntries),
      annualIncomeRmb: income,
      incomeBasis: '最近12个月税前个人劳动收入（含奖金及兼职；不含家庭转移、房产与投资收益），模拟值',
      personalNetAssetsBand,
      housing,
      settlement: pick(SETTLE),
      marriage: pick(MARRIAGE),
      children: pick(CHILDREN),
      personality: pick(PERSONALITY),
      lifestyle: pick(LIFESTYLE),
      family: {
        parentsLocation: pick(['本城', '省内其他城市', '其他省份城镇', '其他省份乡村', '不愿透露']),
        parentsHousing,
        parentsMarriage: parentsMarriageStatus,
        netAssetsBand: familyNetAssetsBand,
        support: familySupport,
        parentsSecurity: pick(['双方有基本养老与医保', '一方有养老金，双方有医保', '主要依靠居民养老与医保', '保障存在缺口', '不清楚', '不愿透露']),
        siblings: pick(['独生子女', '一位兄弟姐妹', '两位及以上兄弟姐妹', '不愿透露']),
        debt: pick(['自述无家庭债务', '住房贷款', '经营借款', '医疗或教育借款', '不清楚', '不愿透露']),
        care: pick(['暂时无固定照护责任', '定期探望及协助', '需要经济赡养', '承担日常照护', '不清楚', '不愿透露']),
      },
      preferences: {
        // 择偶要求按性别：女生多找同龄或稍大、比自己高的；男生多找同龄或稍小的
        age: gender === '女' ? [Math.max(22, age - int(0, 3)), Math.min(55, age + int(3, 8))] : [Math.max(20, age - int(4, 9)), Math.min(55, age + int(0, 3))],
        heightCm: gender === '女' ? [Math.max(160, height + int(3, 12)), int(185, 195)] : [int(148, 155), Math.min(185, height - int(0, 8))],
        minIncomeRmb: pick([0, 60000, 80000, 100000, 120000, 150000, 200000]),
        incomeHard: rng() < 0.28,
        educationMin: pick(LEVELS.slice(0, 4)),
        housingAccepted: rng() < 0.7 ? HOMES : [HOMES[3], HOMES[4]],
        settlementAccepted: rng() < 0.65 ? SETTLE : [pick(SETTLE)],
        familySupportAccepted: rng() < 0.8 ? SUPPORT : SUPPORT.slice(0, 3),
        marriageAccepted: rng() < 0.65 ? MARRIAGE : [pick(MARRIAGE)],
        childrenAccepted: rng() < 0.6 ? CHILDREN : [pick(CHILDREN)],
        personalityAccepted: rng() < 0.65 ? PERSONALITY : [pick(PERSONALITY)],
        lifestyleAccepted: rng() < 0.65 ? LIFESTYLE : [pick(LIFESTYLE)],
        importance: Object.fromEntries(IMPORTANCE_KEYS.map((k) => [k, int(1, 3)])),
      },
    };
  });

  const rng2 = makeRng((actualSeed ^ 0x5bd1e995) >>> 0);
  const looks = LOOKS.map(([v]) => v);
  for (const p of raw) {
    p.looks = {
      care: pickWeighted(rng2, LOOKS),
      accepted: rng2() < 0.7 ? looks : [looks[Math.floor(rng2() * looks.length)]],
      importance: 1 + Math.floor(rng2() * 3),
    };
  }
  // 车和其他负债：同样后加，再用一条独立随机数流，前面抽过的都不受影响
  const rng3 = makeRng((actualSeed ^ 0x27d4eb2f) >>> 0);
  const CARS = ['没有车', '有车，有贷款', '有车，无贷款'];
  for (const p of raw) {
    const has = p.annualIncomeRmb >= 150000 ? 0.65 : 0.4;
    const r = rng3();
    p.extra = {
      car: r < 1 - has ? CARS[0] : r < 1 - has / 2 ? CARS[1] : CARS[2],
      debt: pickWeighted(rng3, [['没有负债', 58], ['5万元以下', 22], ['5–20万元', 11], ['20–50万元', 4], ['50万元以上', 1], ['不愿透露', 4]]),
      carAccepted: rng3() < 0.75 ? CARS : CARS.slice(1),
      carImp: 1 + Math.floor(rng3() * 2),
      debtMax: rng3() < 0.55 ? [0, 50000, 200000][Math.floor(rng3() * 3)] : null,
      debtImp: 1 + Math.floor(rng3() * 3),
    };
  }
  return raw.map(convert);
}
