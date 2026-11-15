import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getScorer } from '../src/index.js';

const { score, rank } = getScorer('fit-v1');

test('收入：9 万对至少 10 万得 90', () => {
  const r = score({ incomeAnnual: 90000 }, [{ field: 'incomeAnnual', op: 'atLeast', target: 100000, importance: 3 }]);
  assert.deepEqual(r.items[0].score, [90, 90]);
  assert.equal(r.total.low, 90);
});

test('收入超过目标封顶 100；目标 0 跳过该项', () => {
  assert.equal(score({ incomeAnnual: 300000 }, [{ field: 'incomeAnnual', op: 'atLeast', target: 100000, importance: 2 }]).total.low, 100);
  assert.equal(score({ incomeAnnual: 1 }, [{ field: 'incomeAnnual', op: 'atLeast', target: 0, importance: 2 }]).softCount, 0);
});

test('身高：约 180、实际 170，尺度 20 cm 得 50；尺度 10 得 0', () => {
  assert.equal(score({ heightCm: 170 }, [{ field: 'heightCm', op: 'about', target: 180, importance: 2 }]).total.low, 50);
  assert.equal(score({ heightCm: 170 }, [{ field: 'heightCm', op: 'about', target: 180, importance: 2, scale: 10 }]).total.low, 0);
});

test('年龄在理想区间内得 100，超出 1 岁（尺度 5）得 80', () => {
  assert.equal(score({ age: 31 }, [{ field: 'age', op: 'range', target: [28, 32], importance: 3 }]).total.low, 100);
  assert.equal(score({ age: 33 }, [{ field: 'age', op: 'range', target: [28, 32], importance: 3 }]).total.low, 80);
});

test('分档资料得到分数区间：个人净资产 50–100 万对至少 100 万为 [50,100]', () => {
  const r = score({ personalNetAssets: '50–100万元' }, [{ field: 'personalNetAssets', op: 'atLeast', target: 1000000, importance: 2 }]);
  assert.deepEqual(r.items[0].score, [50, 100]);
  assert.equal(r.items[0].exact, false);
});

test('负净资产不做负数比例，得 0', () => {
  const r = score({ personalNetAssets: '净资产为负' }, [{ field: 'personalNetAssets', op: 'atLeast', target: 500000, importance: 2 }]);
  assert.deepEqual(r.items[0].score, [0, 0]);
});

test('未知不当 0：给 [0,100]，并降低覆盖率', () => {
  const r = score({ heightCm: 180 }, [
    { field: 'incomeAnnual', op: 'atLeast', target: 100000, importance: 3 },
    { field: 'heightCm', op: 'about', target: 180, importance: 2 },
  ]);
  assert.equal(r.items[0].status, 'unknown');
  assert.ok(r.total.low < r.total.high);
  assert.ok(r.coverage < 1);
});

test('必须项是门槛，不能被高分抵消；未知必须项为待核实', () => {
  const reqs = [
    { field: 'childrenPlan', op: 'in', target: ['希望育儿'], importance: 'must' },
    { field: 'incomeAnnual', op: 'atLeast', target: 100000, importance: 3 },
  ];
  const fail = score({ childrenPlan: '不计划育儿', incomeAnnual: 500000 }, reqs);
  assert.equal(fail.gate.status, 'fail');
  assert.equal(fail.eligible, false);
  const pend = score({ childrenPlan: '不愿透露', incomeAnnual: 500000 }, reqs);
  assert.equal(pend.gate.status, 'pending');
  const pass = score({ childrenPlan: '希望育儿', incomeAnnual: 500000 }, reqs);
  assert.equal(pass.gate.status, 'pass');
  assert.equal(pass.eligible, true);
});

test('学历至少本科：硕士满足，大专不满足', () => {
  const req = [{ field: 'education', op: 'atLeast', target: '本科', importance: 2 }];
  assert.equal(score({ education: '硕士' }, req).total.low, 100);
  assert.equal(score({ education: '大专' }, req).total.low, 0);
});

test('类别：理想 100、可接受 60、其他 0', () => {
  const req = [{ field: 'housing', op: 'in', target: ['整租', '自有住房（无贷款）'], preferred: ['自有住房（无贷款）'], importance: 2 }];
  assert.equal(score({ housing: '自有住房（无贷款）' }, req).total.low, 100);
  assert.equal(score({ housing: '整租' }, req).total.low, 60);
  assert.equal(score({ housing: '合租' }, req).total.low, 0);
});

test('经济组不重复叠加：收入与资产同组共享一份组权重', () => {
  const reqs = [
    { field: 'incomeAnnual', op: 'atLeast', target: 100000, importance: 3 },
    { field: 'personalNetAssets', op: 'atLeast', target: 1000000, importance: 3 },
    { field: 'heightCm', op: 'about', target: 180, importance: 3 },
  ];
  const r = score({ incomeAnnual: 100000, personalNetAssets: 1000000, heightCm: 180 }, reqs);
  const w = Object.fromEntries(r.items.map((i) => [i.field, i.weight]));
  assert.ok(Math.abs(w.incomeAnnual + w.personalNetAssets - w.heightCm) < 1e-9);
});

test('复现 N01 报告 v0.2 的 B′01 算例：92 分', () => {
  const reqs = [
    { field: 'incomeAnnual', op: 'atLeast', target: 100000, importance: 3, weight: 30 },
    { field: 'heightCm', op: 'about', target: 180, importance: 2, weight: 20 },
    { field: 'age', op: 'range', target: [28, 32], importance: 2, weight: 15 },
    { field: 'education', op: 'atLeast', target: '本科', importance: 2, weight: 15 },
    { field: 'housing', op: 'in', target: ['整租', '自有住房（有贷款）', '自有住房（无贷款）'], importance: 1, weight: 10 },
    { field: 'personality', op: 'in', target: ['直接沟通'], importance: 1, weight: 10 },
  ];
  const b01 = { incomeAnnual: 90000, heightCm: 175, age: 31, education: '本科', housing: '整租', personality: '直接沟通' };
  assert.equal(score(b01, reqs).total.low, 92);
  const b08 = { incomeAnnual: { min: 80000, max: 120000 }, heightCm: 180, age: 31, education: '本科', housing: '整租', personality: '直接沟通' };
  assert.deepEqual(score(b08, reqs).total, { low: 94, high: 100 });
});

test('排名按下界排序，标出并列与名次范围', () => {
  const mk = (id, low, high) => ({ id, result: { total: { low, high } } });
  const out = rank([mk('a', 90, 90), mk('b', 97, 97), mk('c', 97, 97), mk('d', 80, 100)]);
  assert.deepEqual(out.map((e) => e.id), ['b', 'c', 'a', 'd']);
  assert.equal(out[1].tiedWithPrevious, true);
  assert.deepEqual(out[3].rankRange, [1, 4]);
});
