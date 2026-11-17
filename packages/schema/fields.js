// 字段注册表：资料、要求、评分和隐私分级共用的唯一来源。
// 新增字段只改这里；评分模块按 type 选择计分函数，服务端按 tier 决定存储和展示方式。
//
// tier（隐私分级，详见 docs/PRIVACY.md）
//   L1 基础资料：可在匹配结果里以原值或粗化值展示给其他用户
//   L2 敏感资料：加密存储；对他人只展示分档后的结果，不展示原值
//   L3 身份资料：昵称、联系方式、核验材料，单独加密保存在身份库，永远不参与评分、不展示给他人
//
// group（权重组）：同组字段共享一份组权重，防止收入、资产、住房、家庭支持把“经济条件”重复计算多次。

// 常住城市：GDP 前 100 城，唯一来源 config/cities.json
import { createRequire } from 'node:module';
const CITY_NAMES = createRequire(import.meta.url)('../../config/cities.json').map((c) => c.name);

export const UNKNOWN_VALUES = ['不清楚', '不愿透露', '暂不填写', ''];

export const GENDERS = { female: '女性', male: '男性' };

export const EDUCATION_LEVELS = ['高中及以下', '大专', '本科', '硕士', '博士'];

// 金额档位，单位：元。上下界为闭区间；null 表示开放。
export const PERSONAL_ASSET_BANDS = {
  '净资产为负': { min: null, max: 0 },
  '0–10万元': { min: 0, max: 100000 },
  '10–50万元': { min: 100000, max: 500000 },
  '50–100万元': { min: 500000, max: 1000000 },
  '100–300万元': { min: 1000000, max: 3000000 },
  '300–600万元': { min: 3000000, max: 6000000 },
  '600–1,000万元': { min: 6000000, max: 10000000 },
};

export const FAMILY_ASSET_BANDS = {
  '净资产为负': { min: null, max: 0 },
  '0–50万元': { min: 0, max: 500000 },
  '50–150万元': { min: 500000, max: 1500000 },
  '150–300万元': { min: 1500000, max: 3000000 },
  '300–600万元': { min: 3000000, max: 6000000 },
  '600–1,000万元': { min: 6000000, max: 10000000 },
};

export const FIELDS = [
  { key: 'age', label: '年龄', type: 'number', unit: '岁', scale: 5, tier: 'L1', group: 'basic', ops: ['range', 'atLeast', 'atMost', 'about'] },
  { key: 'heightCm', label: '身高', type: 'number', unit: 'cm', scale: 20, tier: 'L1', group: 'appearance', ops: ['range', 'atLeast', 'atMost', 'about'] },
  { key: 'city', label: '常住城市', type: 'category', tier: 'L1', group: 'location', options: [...CITY_NAMES, '其他'] },
  { key: 'settlement', label: '未来定居', type: 'category', tier: 'L1', group: 'location', options: ['计划长期定居本城', '城市可协商', '未来可能离开本城'] },
  { key: 'education', label: '最高学历', type: 'ordinal', tier: 'L1', group: 'career', levels: EDUCATION_LEVELS, ops: ['atLeast', 'in'] },
  { key: 'occupation', label: '职业大类', type: 'category', tier: 'L1', group: 'career', options: ['软件与技术', '财务与商务', '医疗与健康', '教育与培训', '设计与传媒', '制造与工程', '行政与运营', '物流与交通', '零售与服务', '其他'] },
  { key: 'incomeAnnual', label: '年收入（税前劳动收入）', type: 'money', unit: '元', tier: 'L2', group: 'economy', ops: ['atLeast', 'range'], displayBands: [0, 50000, 100000, 150000, 200000, 300000, 500000] },
  { key: 'personalNetAssets', label: '个人净资产', type: 'money', unit: '元', tier: 'L2', group: 'economy', bands: PERSONAL_ASSET_BANDS, ops: ['atLeast'] },
  { key: 'housing', label: '本人住房', type: 'category', tier: 'L2', group: 'economy', options: ['合租', '整租', '与父母同住', '单位宿舍', '自有住房（有贷款）', '自有住房（无贷款）'] },
  { key: 'familySupport', label: '家庭可提供的支持', type: 'category', tier: 'L2', group: 'family', options: ['主要提供情感支持', '可应急小额支持', '可部分支持首付', '需本人反向支持'] },
  { key: 'familyNetAssets', label: '父母家庭净资产', type: 'money', unit: '元', tier: 'L2', group: 'family', bands: FAMILY_ASSET_BANDS, ops: ['atLeast'] },
  { key: 'parentsSecurity', label: '父母养老保障', type: 'category', tier: 'L2', group: 'family', options: ['双方有基本养老与医保', '一方有养老金，双方有医保', '主要依靠居民养老与医保', '保障存在缺口'] },
  { key: 'siblings', label: '兄弟姐妹', type: 'category', tier: 'L2', group: 'family', options: ['独生子女', '一位兄弟姐妹', '两位及以上兄弟姐妹'] },
  { key: 'care', label: '父母照护责任', type: 'category', tier: 'L2', group: 'family', options: ['暂时无固定照护责任', '定期探望及协助', '承担日常照护', '需要经济赡养'] },
  { key: 'parentsMarriage', label: '父母婚姻状态', type: 'category', tier: 'L2', group: 'family', options: ['父母目前为婚姻关系', '父母离异', '一方丧偶'] },
  { key: 'marriagePlan', label: '结婚打算', type: 'category', tier: 'L1', group: 'future', options: ['1–3年内考虑结婚', '婚姻安排可协商', '长期伴侣，暂不结婚'] },
  { key: 'childrenPlan', label: '生育打算', type: 'category', tier: 'L1', group: 'future', options: ['希望育儿', '尚未决定', '不计划育儿'] },
  { key: 'personality', label: '沟通方式', type: 'category', tier: 'L1', group: 'lifestyle', options: ['直接沟通', '慢热温和', '活跃外向', '独立安静'] },
  { key: 'lifestyle', label: '生活方式', type: 'category', tier: 'L1', group: 'lifestyle', options: ['规律作息', '弹性作息', '偏好安静', '喜欢社交', '户外运动', '居家休闲'] },
];

export const FIELD_MAP = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

export const GROUP_LABELS = {
  basic: '年龄', appearance: '外形', location: '城市与定居', career: '学历与职业',
  economy: '个人经济', family: '家庭情况', future: '婚育计划', lifestyle: '相处与生活',
};

export function isUnknown(value) {
  return value === undefined || value === null || (typeof value === 'string' && UNKNOWN_VALUES.includes(value));
}

// 把档位文字或数字统一成 {min,max}；未知返回 null。
export function toInterval(field, value) {
  if (isUnknown(value)) return null;
  if (typeof value === 'number') return { min: value, max: value };
  if (typeof value === 'object' && ('min' in value || 'max' in value)) return { min: value.min ?? null, max: value.max ?? null };
  if (typeof value === 'string' && field.bands && field.bands[value]) return field.bands[value];
  return null;
}
