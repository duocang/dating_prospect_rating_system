// 把旧的上海 500 人模拟库（archive 中）转换成新架构的模拟人选池。
// 用法：node scripts/build-sim-pool.mjs [旧 profiles.json 路径] [输出路径]
// 输出的每个人都带 simulated:true，只能在“模拟模式”下出现，永远不会与真人数据混在一起。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELD_MAP, UNKNOWN_VALUES } from '../packages/schema/fields.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] || resolve(root, 'archive/2026-11-15-pure-web/database/shanghai-500-sim/profiles.json');
const out = process.argv[3] || resolve(root, 'server/seed/sim-pool.json');

const GENDER = { 女: 'female', 男: 'male' };
const IMP_KEYS = { age: '年龄', heightCm: '身高', incomeAnnual: '收入', education: '学历', housing: '住房', settlement: '定居', familySupport: '家庭支持', marriagePlan: '婚姻', childrenPlan: '育儿', personality: '性格', lifestyle: '生活方式' };

function categoryReq(field, accepted, importance) {
  const opts = FIELD_MAP[field].options;
  const list = (accepted || []).filter((v) => !UNKNOWN_VALUES.includes(v));
  if (!list.length || opts.every((o) => list.includes(o))) return null; // 全部可接受 = 没有要求
  return { field, op: 'in', target: list, importance };
}

function convert(p) {
  const pr = p.preferences;
  const imp = (k) => pr.importance?.[IMP_KEYS[k]] ?? 1;
  const reqs = [
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
  ].filter(Boolean);
  const f = p.family || {};
  return {
    id: p.id.replace('SH-SIM-', 'SIM-'),
    simulated: true,
    gender: GENDER[p.gender],
    seeks: (p.seeks || []).map((g) => GENDER[g]),
    profile: {
      age: p.age, heightCm: p.heightCm, city: p.city, settlement: p.settlement,
      education: p.education, occupation: p.occupation, incomeAnnual: p.annualIncomeRmb,
      personalNetAssets: p.personalNetAssetsBand, housing: p.housing,
      familySupport: f.support, familyNetAssets: f.netAssetsBand, parentsSecurity: f.parentsSecurity,
      siblings: f.siblings, care: f.care, parentsMarriage: f.parentsMarriage,
      marriagePlan: p.marriage, childrenPlan: p.children, personality: p.personality, lifestyle: p.lifestyle,
    },
    requirements: reqs,
  };
}

const data = JSON.parse(readFileSync(src, 'utf8'));
const people = data.people.map(convert);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  notice: '全部为程序模拟档案，来自 archive 中上海 500 人模拟库 v' + (data.meta?.version || '?') + '。不是真实用户，不能用于宣传命中率或描述市场。',
  generatedFrom: 'archive/2026-11-15-pure-web/database/shanghai-500-sim/profiles.json',
  people,
}));
console.log(`已生成 ${people.length} 份模拟人选 → ${out}`);
