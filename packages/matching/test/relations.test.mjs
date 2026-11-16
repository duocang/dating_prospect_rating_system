import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRelations, directionOk } from '../src/relations.js';

const person = (id, gender, profile, requirements = []) => ({ id, gender, seeks: [gender === 'female' ? 'male' : 'female'], profile, requirements });

const me = person('me', 'female', { age: 29, heightCm: 165, incomeAnnual: 180000, childrenPlan: '希望育儿' }, [
  { field: 'heightCm', op: 'atLeast', target: 175, importance: 2 },
  { field: 'incomeAnnual', op: 'atLeast', target: 150000, importance: 3 },
]);
const wantsTall = [
  { field: 'heightCm', op: 'atLeast', target: 168, importance: 3 },
  { field: 'age', op: 'range', target: [25, 30], importance: 2 },
  { field: 'childrenPlan', op: 'in', target: ['希望育儿'], importance: 'must' },
];
const wantsMe = [
  { field: 'heightCm', op: 'range', target: [160, 168], importance: 3 },
  { field: 'age', op: 'range', target: [26, 32], importance: 2 },
  { field: 'incomeAnnual', op: 'atLeast', target: 100000, importance: 1 },
];
const pool = [
  me,
  person('m1', 'male', { heightCm: 180, incomeAnnual: 200000 }, wantsTall),
  person('m2', 'male', { heightCm: 176, incomeAnnual: 160000 }, wantsMe),
  person('m3', 'male', { heightCm: 170, incomeAnnual: 90000 }, wantsMe),
  person('m4', 'male', { heightCm: 182, incomeAnnual: 300000 }, [{ field: 'age', op: 'range', target: [20, 40], importance: 1 }]), // 要求过少
  person('w1', 'female', { age: 27, heightCm: 170, childrenPlan: '希望育儿', incomeAnnual: 120000 }, []),
  person('w2', 'female', { age: 26, heightCm: 172, childrenPlan: '希望育儿', incomeAnnual: 120000 }, []),
];

test('只在双方性别方向互相符合时配对', () => {
  assert.equal(directionOk(me, pool[1]), true);
  assert.equal(directionOk(me, pool[5]), false);
});

test('五组结果齐全，数量受套餐上限控制', () => {
  const r = computeRelations({ me, pool, limits: { matches: 2, theirPicks: 2, seekers: 2, mutual: 2 } });
  assert.deepEqual(r.idealMatches.map((m) => m.id), ['m2', 'm4']); // 同分时你也更符合其理想型的人在前
  assert.ok(r.idealMatches.length <= 2 && r.seekers.length <= 2 && r.mutual.length <= 2);
});

test('你与 TA 理想型的契合度单独计算，并给出你在 TA 人选中的名次', () => {
  const r = computeRelations({ me, pool, limits: { matches: 3, theirPicks: 3, seekers: 3, mutual: 3 } });
  const m1 = r.idealMatches.find((m) => m.id === 'm1');
  assert.equal(m1.myFitToThem.items.find((i) => i.field === 'heightCm').score[0] < 100, true);
  assert.deepEqual(m1.theirPicks.map((p) => p.id), ['w1', 'w2']); // 同性别的其他人选，不含你
  assert.ok(m1.myPlace && m1.myPlace.of === 3);
});

test('在找你的人：排除要求过少的人', () => {
  const r = computeRelations({ me, pool });
  assert.ok(!r.seekers.some((s) => s.id === 'm4'));
  assert.equal(r.summary.seekersExcludedFewRequirements, 1);
});

test('双向相合：两个方向都达标才进入', () => {
  const r = computeRelations({ me, pool });
  const ids = r.mutual.map((m) => m.id);
  assert.ok(ids.includes('m2'));
  for (const m of r.mutual) assert.ok(m.fitToMyIdeal.eligible && m.myFitToThem.eligible);
});
