import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = mkdtempSync(join(tmpdir(), 'vier-test-'));
let base, server;

before(async () => {
  // 这组用例验证结果的结构：池子里有上海的虚拟人选
  const configPath = join(dataDir, 'app.json');
  writeFileSync(configPath, JSON.stringify({ ...JSON.parse(readFileSync(join(root, 'config/app.json'), 'utf8')) }));
  ({ server } = createApp({ root, dataDir, configPath }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); rmSync(dataDir, { recursive: true, force: true }); });

const call = async (method, path, token, body) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

const profile = { gender: 'female', profile: { age: 29, heightCm: 165, city: '上海', education: '硕士', incomeAnnual: 180000, personalNetAssets: '50–100万元', childrenPlan: '希望育儿', secretField: 'x' }, identity: { nickname: '小测' } };
const requirements = [
  { field: 'age', op: 'range', target: [28, 34], importance: 3 },
  { field: 'incomeAnnual', op: 'atLeast', target: 150000, importance: 3 },
  { field: 'childrenPlan', op: 'in', target: ['希望育儿', '尚未决定'], importance: 'must' },
];

test('完整流程：注册、填写、同意、结果、导出、删除', async () => {
  const { body: { token } } = await call('POST', '/api/session');
  assert.equal((await call('PUT', '/api/me/profile', token, profile)).status, 200);
  assert.equal((await call('PUT', '/api/me/requirements', token, { requirements })).status, 200);

  // 未同意时不计算
  assert.equal((await call('GET', '/api/me/results', token)).status, 403);
  await call('PUT', '/api/me/consent', token, { adult: true, scoring: true, pool: false, research: false });

  const r = await call('GET', '/api/me/results', token);
  assert.equal(r.status, 200);
  // 每组 5 位，所有人一样
  assert.equal(r.body.idealMatches.length, 5);
  assert.equal(r.body.idealMatches[0].theirPicks.length, 5);
  assert.ok(r.body.idealOfIdeal.length > 0 && r.body.idealOfIdeal.length <= 5);
  assert.ok(r.body.myPlaceA && r.body.myPlaceA.of >= 1);
  const m = r.body.idealMatches[0];
  assert.ok(m.alias && !('id' in m), '不发送内部 id');
  assert.ok(m.myFitToThem && m.theirIdeal.length > 0);
  assert.ok(Array.isArray(r.body.mutual));
  // L2 金额对他人只显示分档
  assert.match(m.facts['年收入（税前劳动收入）'], /–|以上/);
  assert.ok(!JSON.stringify(r.body).includes('SIM-'), '结果里没有内部编号');
  assert.equal((await call('GET', '/api/config')).body.limits.matches, 5);

  // 数据最小化：未注册字段被丢弃
  const me = await call('GET', '/api/me', token);
  assert.equal(me.body.profile.secretField, undefined);
  assert.equal(me.body.identity.nickname, '小测');

  // 落盘内容中资料、要求、身份都是密文
  const [file] = readdirSync(join(dataDir, 'users'));
  const raw = readFileSync(join(dataDir, 'users', file), 'utf8');
  assert.ok(!raw.includes('180000') && !raw.includes('希望育儿') && !raw.includes('小测'));
  assert.ok(!raw.includes('"age"') && raw.includes('"gender":"female"'));

  const exp = await call('GET', '/api/me/export', token);
  assert.equal(exp.body.account.profile.incomeAnnual, 180000);

  assert.equal((await call('DELETE', '/api/me', token)).status, 200);
  assert.equal((await call('GET', '/api/me', token)).status, 401);
  assert.ok(!readdirSync(join(dataDir, 'users')).includes(file));
  assert.ok(!readFileSync(join(dataDir, 'audit.log'), 'utf8').includes(file.slice(0, -5)), '审计日志不含原 id');
});

test('拒绝同性方向和无效选项', async () => {
  const { body: { token } } = await call('POST', '/api/session');
  await call('PUT', '/api/me/profile', token, { gender: 'female', profile: { age: 30 } });
  const me = await call('GET', '/api/me', token);
  assert.equal(me.body.gender, 'female');
  assert.equal((await call('PUT', '/api/me/profile', token, { gender: 'female', profile: { housing: '城堡' } })).status, 400);
  assert.equal((await call('PUT', '/api/me/requirements', token, { requirements: [{ field: 'age', op: 'range', target: [1, 2], importance: 2 }] })).status, 400);
});

test('匿名分布：小于 k 的档位合并', async () => {
  const r = await call('GET', '/api/stats?field=education');
  assert.equal(r.status, 200);
  assert.ok(Object.values(r.body.counts).every((n) => n >= 10));
  assert.equal((await call('GET', '/api/stats?field=incomeAnnual')).status, 400);
});

test('虚拟人选带婚姻状况和有没有孩子', async () => {
  const { generateCityPool } = await import('../src/sim-generate.js');
  const pool = generateCityPool({ cityId: 'SH', cityName: '上海', count: 200 });
  assert.ok(pool.every((p) => ['未婚', '离异', '丧偶'].includes(p.profile.maritalStatus)));
  assert.ok(pool.some((p) => p.requirements.some((r) => r.field === 'maritalStatus')));
});
