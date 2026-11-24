// 导出模拟人选：100 城 × 每城 virtualPerCity 人，写成两份 CSV（Excel 可直接打开）
//   data/sim-export/全部人选.csv   每人一行
//   data/sim-export/城市汇总.csv   每城一行：人数、平均年龄、大专以上、本科以上、收入中位数和平均值、未婚比例
// 服务器运行时按同样的规则在内存里生成，结果和这里完全一样。用法：node scripts/export-sim-pool.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCityPool } from '../server/src/sim-generate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cities = JSON.parse(readFileSync(join(root, 'config/cities.json'), 'utf8'));
const n = JSON.parse(readFileSync(join(root, 'config/app.json'), 'utf8')).virtualPerCity ?? 1000;
const out = join(root, 'data/sim-export');
mkdirSync(out, { recursive: true });

const COLS = [['id', '编号'], ['city', '城市'], ['gender', '性别'], ['age', '年龄'], ['heightCm', '身高'], ['education', '学历'], ['occupation', '职业'], ['incomeAnnual', '年收入'], ['maritalStatus', '婚姻状况'], ['childrenStatus', '孩子'], ['housing', '住房'], ['car', '车'], ['personalNetAssets', '个人净资产'], ['familyNetAssets', '父母家净资产'], ['marriagePlan', '结婚打算'], ['childrenPlan', '生育打算'], ['personality', '性格'], ['lifestyle', '生活方式']];
const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const rows = [COLS.map(([, l]) => l).join(',')];
const sum = [['城市', '人数', '平均年龄', '大专及以上', '本科及以上', '年收入中位数', '年收入平均', '未婚'].join(',')];
const pct = (x) => `${(x * 100).toFixed(1)}%`;

for (const c of cities) {
  const pool = generateCityPool({ cityId: c.id, cityName: c.name, count: n, occ: c.occ });
  for (const p of pool) rows.push(COLS.map(([k]) => cell(k === 'id' ? p.id : k === 'gender' ? (p.gender === 'male' ? '男' : '女') : p.profile[k])).join(','));
  const ed = (set) => pool.filter((p) => set.includes(p.profile.education)).length / pool.length;
  const inc = pool.map((p) => p.profile.incomeAnnual).sort((a, b) => a - b);
  sum.push([c.name, pool.length, (pool.reduce((a, p) => a + p.profile.age, 0) / pool.length).toFixed(1),
    pct(ed(['大专', '本科', '硕士', '博士'])), pct(ed(['本科', '硕士', '博士'])), inc[Math.floor(inc.length / 2)],
    Math.round(inc.reduce((a, b) => a + b, 0) / inc.length), pct(pool.filter((p) => p.profile.maritalStatus === '未婚').length / pool.length)].join(','));
}
// 带 BOM，Excel 打开中文不乱码
writeFileSync(join(out, '全部人选.csv'), '﻿' + rows.join('\n'));
writeFileSync(join(out, '城市汇总.csv'), '﻿' + sum.join('\n'));
console.log(`已导出 ${rows.length - 1} 人、${cities.length} 城到 ${out}`);
