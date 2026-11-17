// 牵线：按 docs/CONTACT-BROKER.md 的规则逐条验证。用真人模式，甲乙丙都是真实账户。
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dirs = [];
let base, server, dataDir;

// 每个用例一个全新的真人模式实例，互不串人
async function fresh() {
  if (server) server.close();
  dataDir = mkdtempSync(join(tmpdir(), 'vier-broker-'));
  dirs.push(dataDir);
  const configPath = join(dataDir, 'app.json');
  const cfg = JSON.parse(readFileSync(join(root, 'config/app.json'), 'utf8'));
  writeFileSync(configPath, JSON.stringify({ ...cfg, poolMode: 'real' }));
  ({ server } = createApp({ root, dataDir, configPath }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
}
beforeEach(fresh);
after(() => { server?.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const call = async (method, path, token, body) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

const reqs = [
  { field: 'age', op: 'range', target: [25, 40], importance: 3 },
  { field: 'heightCm', op: 'atLeast', target: 150, importance: 2 },
];

async function person(gender, profile, { pool = true, requirements = reqs } = {}) {
  const { body: { token } } = await call('POST', '/api/session');
  await call('PUT', '/api/me/profile', token, { gender, profile: { city: '上海', occupation: '软件与技术', incomeAnnual: 300000, ...profile }, identity: { nickname: '不该出现' } });
  await call('PUT', '/api/me/requirements', token, { requirements });
  await call('PUT', '/api/me/consent', token, { scoring: true, pool, research: false });
  return token;
}

const results = async (token) => (await call('GET', '/api/me/results', token)).body;
const aliasIn = (r) => r.idealMatches[0].alias;
const PHONE = '13812345678';

test('结果页：没开放牵线的人显示“暂未开放”，开放后可以联系；卡片不带内部 id', async () => {
  const jia = await person('male', { age: 30, heightCm: 178 });
  const yi = await person('female', { age: 28, heightCm: 165 });
  let r = await results(jia);
  assert.equal(r.idealMatches[0].broker.state, 'closed');
  assert.ok(!('id' in r.idealMatches[0]));

  assert.equal((await call('PUT', '/api/me/broker/willing', yi, { willing: true })).status, 200);
  r = await results(jia);
  assert.equal(r.idealMatches[0].broker.state, 'open');
});

test('完整流程：甲发起 → 乙只看到极简信息 → 乙二次确认同意 → 号码只给乙一次，用后删除', async () => {
  const jia = await person('male', { age: 31, heightCm: 180, incomeAnnual: 800000 });
  const yi = await person('female', { age: 29, heightCm: 163 });
  await call('PUT', '/api/me/broker/willing', yi, { willing: true });
  const alias = aliasIn(await results(jia));

  // 没留联系方式、没勾同意，都发不出去
  assert.equal((await call('POST', '/api/me/broker/requests', jia, { alias, consent: true })).status, 400);
  assert.equal((await call('PUT', '/api/me/broker/contact', jia, { type: 'phone', value: '123' })).status, 400);
  assert.equal((await call('PUT', '/api/me/broker/contact', jia, { type: 'phone', value: PHONE })).status, 200);
  assert.equal((await call('POST', '/api/me/broker/requests', jia, { alias })).status, 400);
  assert.equal((await call('POST', '/api/me/broker/requests', jia, { alias: 'nobody00', consent: true })).status, 404);

  const sent = await call('POST', '/api/me/broker/requests', jia, { alias, consent: true });
  assert.equal(sent.status, 201);
  assert.equal((await call('POST', '/api/me/broker/requests', jia, { alias, consent: true })).status, 409, '不能重复发');
  assert.equal((await results(jia)).idealMatches[0].broker.state, 'pending');

  // 乙看到的极简信息
  const ov = (await call('GET', '/api/me/broker', yi)).body;
  assert.equal((await call('GET', '/api/me', yi)).body.broker.incomingPending, 1);
  const inc = ov.incoming[0];
  assert.deepEqual(Object.keys(inc.minimal).sort(), ['ageBand', 'city', 'gender', 'occupation', 'theyFitYou', 'youFitThem']);
  assert.equal(inc.minimal.ageBand, '30–34 岁');
  assert.equal(inc.minimal.occupation, '软件与技术');
  assert.deepEqual(inc.minimal.theyFitYou, { met: 2, of: 2 });
  const raw = JSON.stringify(ov);
  for (const leak of [PHONE, '不该出现', '800000', '"31"', '180']) assert.ok(!raw.includes(leak), `乙不应看到 ${leak}`);
  assert.equal(inc.contact, null);

  // 每次同意都要再确认
  assert.equal((await call('POST', `/api/me/broker/requests/${inc.id}/accept`, yi, {})).status, 400);
  // 别人不能替乙同意，甲也不能
  assert.equal((await call('POST', `/api/me/broker/requests/${inc.id}/accept`, jia, { confirm: true })).status, 404);
  const ok = await call('POST', `/api/me/broker/requests/${inc.id}/accept`, yi, { confirm: true });
  assert.deepEqual(ok.body.contact, { type: 'phone', value: PHONE });

  // 同意后甲不能撤回
  assert.equal((await call('POST', `/api/me/broker/requests/${inc.id}/cancel`, jia)).status, 409);
  const jiaView = (await call('GET', '/api/me/broker', jia)).body;
  assert.equal(jiaView.outgoing[0].status, 'accepted');
  assert.ok(!JSON.stringify(jiaView.outgoing).includes('"minimal"'), '甲看不到乙的信息');

  // 乙记下后号码从服务器删掉
  assert.equal((await call('GET', '/api/me/broker', yi)).body.incoming[0].contact.value, PHONE);
  await call('POST', `/api/me/broker/requests/${inc.id}/seen`, yi);
  const after = (await call('GET', '/api/me/broker', yi)).body.incoming[0];
  assert.equal(after.contact, null);
  assert.equal(after.hidden, true);
});

test('乙拒绝：甲只看到“对方暂未同意”，并进入冷却期', async () => {
  const jia = await person('male', { age: 33, heightCm: 175 });
  const yi = await person('female', { age: 27, heightCm: 160 });
  await call('PUT', '/api/me/broker/willing', yi, { willing: true });
  await call('PUT', '/api/me/broker/contact', jia, { type: 'wechat', value: 'jia_2026' });
  const alias = aliasIn(await results(jia));
  const { body: { requestId } } = await call('POST', '/api/me/broker/requests', jia, { alias, consent: true });
  assert.equal((await call('POST', `/api/me/broker/requests/${requestId}/decline`, yi)).status, 200);

  const out = (await call('GET', '/api/me/broker', jia)).body.outgoing[0];
  assert.equal(out.status, 'not_agreed');
  assert.equal((await results(jia)).idealMatches[0].broker.state, 'cooldown');
  const again = await call('POST', '/api/me/broker/requests', jia, { alias, consent: true });
  assert.equal(again.status, 429);
  assert.ok(again.body.until);
  assert.equal((await call('GET', '/api/me/broker', yi)).body.incoming.length, 0, '拒绝后乙那边不再显示');
});

test('甲在乙同意前可以取消；取消后冷却 1 小时', async () => {
  const jia = await person('male', { age: 30, heightCm: 172 });
  const yi = await person('female', { age: 30, heightCm: 168 });
  await call('PUT', '/api/me/broker/willing', yi, { willing: true });
  await call('PUT', '/api/me/broker/contact', jia, { type: 'phone', value: '13900001111' });
  const alias = aliasIn(await results(jia));
  const { body: { requestId } } = await call('POST', '/api/me/broker/requests', jia, { alias, consent: true });
  assert.equal((await call('POST', `/api/me/broker/requests/${requestId}/cancel`, yi)).status, 404, '乙不能替甲取消');
  assert.equal((await call('POST', `/api/me/broker/requests/${requestId}/cancel`, jia)).status, 200);
  assert.equal((await call('POST', `/api/me/broker/requests/${requestId}/accept`, yi, { confirm: true })).status, 409);
  assert.equal((await call('POST', '/api/me/broker/requests', jia, { alias, consent: true })).status, 429);
});

test('屏蔽是单向的：乙屏蔽甲后，甲看到“暂未开放”；丙不受影响', async () => {
  const jia = await person('male', { age: 30, heightCm: 176 });
  const bing = await person('male', { age: 31, heightCm: 177 });
  const yi = await person('female', { age: 28, heightCm: 162 });
  await call('PUT', '/api/me/broker/willing', yi, { willing: true });
  for (const t of [jia, bing]) await call('PUT', '/api/me/broker/contact', t, { type: 'phone', value: '13700002222' });
  const { body: { requestId } } = await call('POST', '/api/me/broker/requests', jia, { alias: aliasIn(await results(jia)), consent: true });
  await call('POST', `/api/me/broker/requests/${requestId}/block`, yi);

  const r = await results(jia);
  assert.equal(r.idealMatches[0].broker.state, 'closed');
  assert.equal((await call('POST', '/api/me/broker/requests', jia, { alias: aliasIn(r), consent: true })).status, 403);
  assert.equal((await call('GET', '/api/me/broker', jia)).body.outgoing[0].status, 'not_agreed', '甲不知道被屏蔽');
  const rb = await results(bing);
  assert.equal(rb.idealMatches.find((m) => m.broker.state === 'open') !== undefined, true, '丙仍可联系乙');
});

test('甲同意后屏蔽乙：乙不能再向甲发起', async () => {
  const jia = await person('male', { age: 30, heightCm: 176 });
  const yi = await person('female', { age: 28, heightCm: 162 });
  for (const t of [jia, yi]) {
    await call('PUT', '/api/me/broker/willing', t, { willing: true });
    await call('PUT', '/api/me/broker/contact', t, { type: 'phone', value: '13600003333' });
  }
  const { body: { requestId } } = await call('POST', '/api/me/broker/requests', jia, { alias: aliasIn(await results(jia)), consent: true });
  await call('POST', `/api/me/broker/requests/${requestId}/accept`, yi, { confirm: true });
  assert.equal((await call('POST', `/api/me/broker/requests/${requestId}/block`, jia)).status, 200);
  const r = await results(yi);
  const jiaCard = r.idealMatches.find((m) => m.broker);
  assert.equal(jiaCard.broker.state, 'closed');
  assert.equal((await call('POST', '/api/me/broker/requests', yi, { alias: jiaCard.alias, consent: true })).status, 403);
});

test('乙关闭牵线或退出人选池：等待中的请求作废，甲看到“对方暂未同意”；退出人选池时开关不能再打开', async () => {
  const jia = await person('male', { age: 30, heightCm: 176 });
  const yi = await person('female', { age: 28, heightCm: 162 });
  await call('PUT', '/api/me/broker/willing', yi, { willing: true });
  await call('PUT', '/api/me/broker/contact', jia, { type: 'phone', value: '13500004444' });
  await call('POST', '/api/me/broker/requests', jia, { alias: aliasIn(await results(jia)), consent: true });

  await call('PUT', '/api/me/consent', yi, { scoring: true, pool: false, research: false });
  assert.equal((await call('GET', '/api/me/broker', jia)).body.outgoing[0].status, 'not_agreed');
  const yv = (await call('GET', '/api/me/broker', yi)).body;
  assert.equal(yv.willing, false);
  assert.equal(yv.inPool, false);
  assert.equal((await call('PUT', '/api/me/broker/willing', yi, { willing: true })).status, 400);
});

test('“必须有”没对上时不能发起', async () => {
  const jia = await person('male', { age: 30, heightCm: 176 });
  const yi = await person('female', { age: 28, heightCm: 162 }, { requirements: [{ field: 'age', op: 'range', target: [25, 28], importance: 'must' }, reqs[1]] });
  await call('PUT', '/api/me/broker/willing', yi, { willing: true });
  await call('PUT', '/api/me/broker/contact', jia, { type: 'phone', value: '13400005555' });
  const r = await results(jia);
  const card = r.idealMatches[0];
  assert.equal(card.broker.state, 'ineligible');
  assert.equal((await call('POST', '/api/me/broker/requests', jia, { alias: card.alias, consent: true })).status, 403);
});

test('隐私：号码加密落盘，不进审计；删除联系方式撤回等待中的请求；删除账户清掉全部牵线数据', async () => {
  const jia = await person('male', { age: 30, heightCm: 176 });
  const yi = await person('female', { age: 28, heightCm: 162 });
  await call('PUT', '/api/me/broker/willing', yi, { willing: true });
  const secret = '13311112222';
  await call('PUT', '/api/me/broker/contact', jia, { type: 'phone', value: secret });
  await call('POST', '/api/me/broker/requests', jia, { alias: aliasIn(await results(jia)), consent: true });

  const files = ['broker.json', 'audit.log', ...readdirSync(join(dataDir, 'contacts')).map((f) => join('contacts', f))];
  for (const f of files) assert.ok(!readFileSync(join(dataDir, f), 'utf8').includes(secret), `${f} 里不应有明文号码`);
  const exp = (await call('GET', '/api/me/export', jia)).body;
  assert.equal(exp.broker.contact.value, secret, '本人导出包含自己的联系方式');

  await call('DELETE', '/api/me/broker/contact', jia);
  assert.equal((await call('GET', '/api/me/broker', jia)).body.outgoing[0].status, 'cancelled');
  assert.equal((await call('GET', '/api/me/broker', yi)).body.incoming.length, 0);

  const before = readdirSync(join(dataDir, 'contacts')).length;
  await call('PUT', '/api/me/broker/contact', yi, { type: 'phone', value: '13322223333' });
  await call('DELETE', '/api/me', yi);
  assert.equal(readdirSync(join(dataDir, 'contacts')).length, before);
  assert.equal((await call('GET', '/api/me/broker', jia)).body.outgoing.length, 0);
});

test('演示模式：模拟人选不能牵线', async () => {
  const cfg = JSON.parse(readFileSync(join(root, 'config/app.json'), 'utf8'));
  const dir2 = mkdtempSync(join(tmpdir(), 'vier-broker-sim-'));
  const { server: s2 } = createApp({ root, dataDir: dir2, configPath: join(root, 'config/app.json') });
  await new Promise((r) => s2.listen(0, r));
  const b2 = `http://127.0.0.1:${s2.address().port}`;
  const c2 = async (method, path, token, body) => {
    const res = await fetch(b2 + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal(cfg.poolMode, 'simulated');
    const { body: { token } } = await c2('POST', '/api/session');
    await c2('PUT', '/api/me/profile', token, { gender: 'female', profile: { age: 29, heightCm: 165, city: '上海' } });
    await c2('PUT', '/api/me/requirements', token, { requirements: reqs });
    await c2('PUT', '/api/me/consent', token, { scoring: true, pool: false, research: false });
    const r = (await c2('GET', '/api/me/results', token)).body;
    assert.equal(r.idealMatches[0].broker.state, 'demo');
    await c2('PUT', '/api/me/broker/contact', token, { type: 'phone', value: '13800001111' });
    assert.equal((await c2('POST', '/api/me/broker/requests', token, { alias: r.idealMatches[0].alias, consent: true })).status, 400);
  } finally { s2.close(); rmSync(dir2, { recursive: true, force: true }); }
});
