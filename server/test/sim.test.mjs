// 模拟人选和公开统计数据对得上：每座城市生成 1000 人，检查学历、收入、身高、婚姻状况的分布（docs/DATA.md）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateCityPool } from '../src/sim-generate.js';
import { cityTargets, educationShares, HEIGHT, maritalShares } from '../src/sim-calibration.js';

const CITIES = createRequire(import.meta.url)('../../config/cities.json');
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('100 城：平均收入等于目标，大专以上比例在期望值的抽样误差内（3.5 个标准误）', () => {
  for (const c of CITIES) {
    const pool = generateCityPool({ cityId: c.id, cityName: c.name, count: 1000, occ: c.occ });
    const t = cityTargets(c.id);
    const inc = mean(pool.map((p) => p.profile.incomeAnnual));
    assert.ok(Math.abs(inc / t.income - 1) < 0.02, `${c.name} 平均收入 ${Math.round(inc)}，目标 ${t.income}`);
    // 期望值：按每个人的年龄、性别算出的大专以上概率取平均
    const want = mean(pool.map((p) => 1 - educationShares(p.gender, p.profile.age, t.tertiary)[0][1]));
    const got = pool.filter((p) => p.profile.education !== '高中及以下').length / pool.length;
    assert.ok(Math.abs(got - want) < 3.5 * Math.sqrt((want * (1 - want)) / pool.length), `${c.name} 大专以上 ${got.toFixed(3)}，期望 ${want.toFixed(3)}`);
  }
});

test('身高、婚姻状况和全国数据一致；越高学历的城市，大专以上越多', () => {
  const pool = CITIES.slice(0, 10).flatMap((c) => generateCityPool({ cityId: c.id, cityName: c.name, count: 1000, occ: c.occ }));
  for (const g of ['male', 'female']) {
    const h = mean(pool.filter((p) => p.gender === g).map((p) => p.profile.heightCm));
    assert.ok(Math.abs(h - HEIGHT[g].mean) < 0.5, `${g} 平均身高 ${h.toFixed(1)}`);
  }
  const want = mean(pool.map((p) => maritalShares(p.gender, p.profile.age)[0][1]));
  const got = pool.filter((p) => p.profile.maritalStatus === '未婚').length / pool.length;
  assert.ok(Math.abs(got - want) < 0.02, `未婚 ${got.toFixed(3)}，期望 ${want.toFixed(3)}`);
  const share = (id) => { const c = CITIES.find((x) => x.id === id); return generateCityPool({ cityId: id, cityName: c.name, count: 1000 }).filter((p) => p.profile.education !== '高中及以下').length; };
  assert.ok(share('BJ') > share('LUO') && share('LUO') > share('ZK'));
});
