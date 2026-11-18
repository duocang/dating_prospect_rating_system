import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = mkdtempSync(join(tmpdir(), 'vier-sec-'));
let base, server;

before(async () => {
  const configPath = join(dataDir, 'app.json');
  const cfg = JSON.parse(readFileSync(join(root, 'config/app.json'), 'utf8'));
  cfg.rateLimits = { session: [8, 3600e3], results: [3, 3600e3], adminFail: [3, 3600e3] };
  writeFileSync(configPath, JSON.stringify(cfg));
  ({ server } = createApp({ root, dataDir, configPath }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); rmSync(dataDir, { recursive: true, force: true }); });

const call = async (method, path, token, body, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
};
const profile = (age) => ({ gender: 'male', profile: { age, heightCm: 178, city: '上海', education: '本科', childrenPlan: '希望育儿' } });
const requirements = [{ field: 'age', op: 'range', target: [24, 32], importance: 3 }];
async function filled(age = 30) {
  const { body: { token } } = await call('POST', '/api/session');
  await call('PUT', '/api/me/profile', token, profile(age));
  await call('PUT', '/api/me/requirements', token, { requirements });
  return token;
}

test('同意时必须确认已满 18 岁', async () => {
  const t = await filled();
  assert.equal((await call('PUT', '/api/me/consent', t, { scoring: true, pool: false })).status, 400);
  assert.equal((await call('PUT', '/api/me/consent', t, { adult: true, scoring: true, pool: false })).status, 200);
});

test('看结果有次数上限，防止反复改要求扫描人选池', async () => {
  const t = await filled();
  await call('PUT', '/api/me/consent', t, { adult: true, scoring: true, pool: false });
  for (let i = 0; i < 3; i++) assert.equal((await call('GET', '/api/me/results', t)).status, 200);
  assert.equal((await call('GET', '/api/me/results', t)).status, 429);
});

test('结果里带“你的位置”和第一名并列人数', async () => {
  const t = await filled(29);
  await call('PUT', '/api/me/consent', t, { adult: true, scoring: true, pool: false });
  const r = (await call('GET', '/api/me/results', t)).body;
  for (const k of ['ideal', 'seekers', 'mutual']) {
    assert.ok(r.summary.position[k].of > 0);
    assert.ok(r.summary.position[k].allMet <= r.summary.position[k].of);
  }
  assert.ok(r.summary.position.mutual.allMet <= Math.min(r.summary.position.ideal.allMet, r.summary.position.seekers.allMet));
  assert.ok(r.summary.topTie >= 1);
});

test('登录时本机和号码各有一份资料：先问保留哪一份，选“这一份”就覆盖旧资料', async () => {
  const phone = '13800001111';
  const a = await filled(30);
  const { body: { devCode: c1 } } = await call('POST', '/api/auth/code', a, { phone });
  await call('POST', '/api/auth/verify', a, { phone, code: c1 });
  // 换一台手机，不登录先填了一份新的
  const b = await filled(33);
  const send = await call('POST', '/api/auth/code', b, { phone });
  const devCode = send.body?.devCode;
  assert.ok(devCode);
  const ask = await call('POST', '/api/auth/verify', b, { phone, code: devCode });
  assert.equal(ask.status, 409);
  assert.equal(ask.body.choose, true);
  const ok = await call('POST', '/api/auth/verify', b, { phone, code: devCode, keep: 'this' });
  assert.equal(ok.status, 200);
  const me = await call('GET', '/api/me', ok.body.token);
  assert.equal(me.body.profile.age, 33);
});

test('网页不能被别的网站套进框里', async () => {
  const res = await fetch(base + '/');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('管理口令错太多次会被锁', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await call('GET', '/api/admin/overview', null, null, { 'x-admin-token': 'wrong' })).status, 401);
  assert.equal((await call('GET', '/api/admin/overview', null, null, { 'x-admin-token': 'admin' })).status, 429);
});

test('开新会话有次数上限', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = (await call('POST', '/api/session')).status;
  assert.equal(last, 429);
});
