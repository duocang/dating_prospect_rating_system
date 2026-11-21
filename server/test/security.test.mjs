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
// 进程内拿到验证码明文（只有测试会传 onCaptcha，HTTP 上拿不到）
const answers = new Map();

before(async () => {
  const configPath = join(dataDir, 'app.json');
  const cfg = JSON.parse(readFileSync(join(root, 'config/app.json'), 'utf8'));
  cfg.rateLimits = { session: [8, 3600e3], results: [3, 3600e3], adminFail: [3, 3600e3] };
  writeFileSync(configPath, JSON.stringify(cfg));
  ({ server } = createApp({ root, dataDir, configPath, onCaptcha: (id, a) => answers.set(id, a) }));
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
// 新流程：过了验证码才建账户，资料、要求、同意一起交
async function session(age, consent) {
  const c = await call('GET', '/api/captcha');
  return call('POST', '/api/session', null, { captchaId: c.body.id, answer: answers.get(c.body.id), ...profile(age), requirements, consent });
}
async function filled(age = 30) {
  return (await session(age, { adult: true, scoring: true, pool: false })).body.token;
}

test('同意时必须确认已满 18 岁', async () => {
  const r = await session(30, { scoring: true, pool: false });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /18/);
  const t = await filled();
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

test('恢复码：在另一台设备找回账户，旧令牌失效，重新生成后旧码作废', async () => {
  const a = await filled(31);
  const { status, body: { code } } = await call('POST', '/api/me/recovery', a);
  assert.equal(status, 201);
  assert.match(code, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  assert.equal((await call('GET', '/api/me', a)).body.hasRecovery, true);
  // 不分大小写、不管横线
  const r = await call('POST', '/api/recover', null, { code: code.toLowerCase().replace(/-/g, ' ') });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/me', r.body.token)).body.profile.age, 31);
  assert.equal((await call('GET', '/api/me', a)).status, 401, '旧设备的令牌失效');
  assert.equal((await call('POST', '/api/recover', null, { code: 'ABCD-EFGH-JKMN' })).status, 400);
  const again = (await call('POST', '/api/me/recovery', r.body.token)).body.code;
  assert.notEqual(again, code);
  assert.equal((await call('POST', '/api/recover', null, { code })).status, 400, '旧码作废');
  const r2 = await call('POST', '/api/recover', null, { code: again });
  assert.equal(r2.status, 200);
  // 删除账户后恢复码也没了
  await call('DELETE', '/api/me', r2.body.token);
  assert.equal((await call('POST', '/api/recover', null, { code: again })).status, 400);
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
