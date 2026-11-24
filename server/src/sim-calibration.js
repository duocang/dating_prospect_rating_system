// 模拟人选的校准参数：从公开统计数据（config/stats/）算出来，生成器按这些参数抽样。
// 数据来源和方法见 docs/DATA.md。哪些是数据、哪些是建模假设，在下面逐条注明。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NAT = require('../../config/stats/national.json');
const CITY_STATS = require('../../config/stats/cities.json');
const CITIES = require('../../config/cities.json');

export const AGE_MIN = 22, AGE_MAX = 45; // 建模假设：只模拟 22–45 岁
const BANDS = [[20, 24], [25, 29], [30, 34], [35, 39], [40, 44]];
const bandOf = (age) => BANDS.findIndex(([, hi]) => age <= hi) === -1 ? BANDS.length - 1 : BANDS.findIndex(([, hi]) => age <= hi);
const bandKey = (i) => `${BANDS[i][0]}-${BANDS[i][1]}岁`;
const SEX = { male: 'male', female: 'female', 男: 'male', 女: 'female' };

// ---------- 年龄：单身的人按年龄怎么分布 ----------
// 数据：七普 表3-1 分年龄人口 × 表5-3 分年龄“非有配偶”比例 = 各年龄段单身人数
export function singleAgeWeights(sex) {
  const s = SEX[sex];
  return BANDS.map(([lo, hi], i) => {
    const pop = NAT.sex_ratio_by_age.bands[bandKey(i)][s];
    const single = 1 - NAT.marital_by_age.bands[bandKey(i)][s]['有配偶'];
    const years = Math.min(hi, AGE_MAX) - Math.max(lo, AGE_MIN) + 1; // 20–24 段只取 22–24
    return { lo: Math.max(lo, AGE_MIN), hi: Math.min(hi, AGE_MAX), w: (pop / 5) * years * single };
  }).concat([{ lo: 45, hi: 45, w: (NAT.sex_ratio_by_age.bands['40-44岁'][s] / 5) * (1 - NAT.marital_by_age.bands['40-44岁'][s]['有配偶']) }]);
}

// ---------- 婚姻状况：单身的人里，未婚 / 离异 / 丧偶各占多少 ----------
// 数据：七普 表5-3（全国 10% 长表）。按年龄段、性别，在“非有配偶”的人里重新归一
export function maritalShares(sex, age) {
  const m = NAT.marital_by_age.bands[bandKey(bandOf(age))][SEX[sex]];
  const t = m['未婚'] + m['离婚'] + m['丧偶'];
  return [['未婚', m['未婚'] / t], ['离异', m['离婚'] / t], ['丧偶', m['丧偶'] / t]];
}

// ---------- 身高 ----------
// 数据：《中国居民营养与慢性病状况报告（2020年）》18–44 岁平均身高。标准差报告未公开，取 6.2 / 5.6 cm（建模假设）
export const HEIGHT = { male: { mean: NAT.height.male_mean_cm, sd: 6.2 }, female: { mean: NAT.height.female_mean_cm, sd: 5.6 } };

// ---------- 学历 ----------
// 数据：七普各市“每 10 万人中大学文化程度人数”（全年龄），全国分年龄、性别的受教育程度（表4-1）。
// 方法：城市的大专及以上比例按全国“该年龄段 vs 全年龄”的差距（对数几率）平移到该年龄段；
// 大专以上内部的专科 / 本科 / 硕士 / 博士按全国该年龄段构成，城市越高学历，本科以上份额越大（建模假设，幂次 0.5 / 1）
const NAT_ALL = NAT.education_by_age.national_college_plus_per_100k_check.per_100k_computed / 1e5;
const logit = (p) => Math.log(p / (1 - p)), expit = (x) => 1 / (1 + Math.exp(-x));
const TERTIARY = ['大学专科', '大学本科', '硕士研究生', '博士研究生'];
const EDU_OUT = { 大学专科: '大专', 大学本科: '本科', 硕士研究生: '硕士', 博士研究生: '博士' };
export function educationShares(sex, age, cityTertiary) {
  const e = NAT.education_by_age.bands[bandKey(bandOf(age))][SEX[sex]];
  const natAge = TERTIARY.reduce((a, k) => a + e[k], 0);
  const p = expit(logit(cityTertiary) + logit(natAge) - logit(NAT_ALL));
  const lift = cityTertiary / NAT_ALL;
  const raw = { 大学专科: e['大学专科'], 大学本科: e['大学本科'] * lift ** 0.5, 硕士研究生: e['硕士研究生'] * lift, 博士研究生: e['博士研究生'] * lift };
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  return [['高中及以下', 1 - p], ...TERTIARY.map((k) => [EDU_OUT[k], (p * raw[k]) / sum])];
}

// ---------- 收入 ----------
// 数据：各市 2023 年城镇常住居民人均可支配收入；有的城市另有城镇非私营单位平均工资。
// 方法：人均可支配收入按“工资 / 可支配收入”的城市中位比例换算成在业者年收入，再乘 0.8 折算私营单位（建模假设）；
// 个人收入按对数正态分布，离散度 σ=0.6（建模假设），学历、年龄带来高低差别，最后整体缩放，让全城平均值正好等于目标
export const INCOME_SIGMA = 0.6;
export const EDU_PREMIUM = { 高中及以下: -0.35, 大专: -0.12, 本科: 0.1, 硕士: 0.35, 博士: 0.5 }; // 建模假设（对数）
export const PRIVATE_ADJ = 0.8;
const byId = new Map(CITY_STATS.map((c) => [c.id, c]));
const ratios = CITY_STATS.filter((c) => c.wage && c.disp_income).map((c) => c.wage / c.disp_income).sort((a, b) => a - b);
export const WAGE_TO_DISP = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1.8;
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

// 每座城市的目标：大专及以上比例、在业者平均年收入。缺数据的城市用同档城市的中位数补（标 imputed）
export function cityTargets(cityId) {
  const meta = CITIES.find((c) => c.id === cityId) || CITIES[0];
  const st = byId.get(meta.id) || {};
  const peers = CITIES.filter((c) => c.tier === meta.tier).map((c) => byId.get(c.id)).filter(Boolean);
  const incomeOf = (s) => (s.disp_income ? s.disp_income * WAGE_TO_DISP * PRIVATE_ADJ : s.wage ? s.wage * PRIVATE_ADJ : null);
  const tertiary = st.univ_per_100k ? st.univ_per_100k / 1e5 : median(peers.map((s) => s.univ_per_100k)) / 1e5;
  const income = incomeOf(st) ?? median(peers.map(incomeOf));
  return { tertiary, income: Math.round(income), imputed: { tertiary: !st.univ_per_100k, income: incomeOf(st) == null } };
}
