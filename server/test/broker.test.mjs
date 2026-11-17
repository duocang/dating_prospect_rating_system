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

// 每个用例一个全新的实例（不加虚拟人选），互不串人
async function fresh() {
  if (server) server.close();
  dataDir = mkdtempSync(join(tmpdir(), 'vier-broker-'));
  dirs.push(dataDir);
  const configPath = join(dataDir, 'app.json');
  const cfg = JSON.parse(readFileSync(join(root, 'config/app.json'), 'utf8'));
  writeFileSync(configPath, JSON.stringify({ ...cfg, virtualPerCity: 0 }));
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

async function person(gender, profile, { pool = true, requirements = reqs, login = true } = {}) {
  const { body: { token } } = await call('POST', '/api/session');
  await call('PUT', '/api/me/profile', token, { gender, profile: { city: '上海', occupation: '软件与技术', incomeAnnual: 300000, ...profile }, identity: { nickname: '不该出现' } });
  await call('PUT', '/api/me/requirements', token, { requirements });
  await call('PUT', '/api/me/consent', token, { scoring: true, pool, research: false });
  if (login) await loginAs(token);
  return token;
}

// 手机号登录（测试环境验证码直接返回）
let phoneSeq = 0;
async function loginAs(token, phone = `1770000${String(++phoneSeq).padStart(4, '0')}`) {
  const { body: { devCode } } = await call('POST', '/api/auth/code', token, { phone });
  const r = await call('POST', '/api/auth/verify', token, { phone, code: devCode });
  assert.equal(r.status, 200);
  return r.body;
}

// 打开“愿意被牵线”必须先留号码
const openUp = async (token) => { await call('PUT', '/api/me/broker/contact', token, { type: 'wechat', value: 'open_' + token.slice(2, 10).replace(/[^a-zA-Z0-9]/g, 'x') }); return call('PUT', '/api/me/broker/willing', token, { willing: true }); };
const results = async (token) => (await call('GET', '/api/me/results', token)).body;
const aliasIn = (r) => r.idealMatches[0].alias;
const PHONE = '13812345678';

test('结果页：没开放牵线的人显示“暂未开放”，开放后可以联系；卡片不带内部 id', async () => {
  const jia = await person('male', { age: 30, heightCm: 178 });
  const yi = await person('female', { age: 28, heightCm: 165 });
  let r = await results(jia);
  assert.equal(r.idealMatches[0].broker.state, 'closed');
  assert.ok(!('id' in r.idealMatches[0]));

  assert.equal((await openUp(yi)).status, 200);
  r = await results(jia);
  assert.equal(r.idealMatches[0].broker.state, 'open');
});

test('完整流程：甲发起 → 乙只看到极简信息 → 乙二次确认同意 → 号码只给乙一次，用后删除', async () => {
  const jia = await person('male', { age: 31, heightCm: 180, incomeAnnual: 800000 });
  const yi = await person('female', { age: 29, heightCm: 163 });
  await openUp(yi);
  const alias = aliasIn(await results(jia));

  // 没留联系方式、没勾同意，都发不出去
  await call('DELETE', '/api/me/broker/contact', jia);
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
  await openUp(yi);
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
  await openUp(yi);
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
  await openUp(yi);
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
  for (const t of [jia, yi]) { await openUp(t); await call('PUT', '/api/me/broker/contact', t, { type: 'phone', value: '13600003333' }); }
  const { body: { requestId } } = await call('POST', '/api/me/broker/requests', jia, { alias: aliasIn(await results(jia)), consent: true });
  await call('POST', `/api/me/broker/requests/${requestId}/accept`, yi, { confirm: true });
  assert.equal((await call('POST', `/api/me/broker/requests/${requestId}/block`, jia)).status, 200);
  const r = await results(yi);
  const jiaCard = r.idealMatches.find((m) => m.broker);
  assert.equal(jiaCard.broker.state, 'closed');
  assert.equal((await call('POST', '/api/me/broker/requests', yi, { alias: jiaCard.alias, consent: true })).status, 403);
});

test('删了号码再打开“愿意被牵线”，自动用登录手机号；删除号码时开关自动关闭', async () => {
  const yi = await person('female', { age: 28, heightCm: 162 });
  await call('DELETE', '/api/me/broker/contact', yi);
  assert.equal((await call('PUT', '/api/me/broker/willing', yi, { willing: true })).status, 200);
  assert.equal((await call('GET', '/api/me/broker', yi)).body.contact.type, 'phone');
  await openUp(yi);
  await call('DELETE', '/api/me/broker/contact', yi);
  assert.equal((await call('GET', '/api/me/broker', yi)).body.willing, false);
});

test('乙关闭牵线或退出人选池：等待中的请求作废，甲看到“对方暂未同意”；退出人选池时开关不能再打开', async () => {
  const jia = await person('male', { age: 30, heightCm: 176 });
  const yi = await person('female', { age: 28, heightCm: 162 });
  await openUp(yi);
  await call('PUT', '/api/me/broker/contact', jia, { type: 'phone', value: '13500004444' });
  await call('POST', '/api/me/broker/requests', jia, { alias: aliasIn(await results(jia)), consent: true });

  await call('PUT', '/api/me/consent', yi, { scoring: true, pool: false, research: false });
  assert.equal((await call('GET', '/api/me/broker', jia)).body.outgoing[0].status, 'not_agreed');
  const yv = (await call('GET', '/api/me/broker', yi)).body;
  assert.equal(yv.willing, false);
  assert.equal(yv.inPool, false);
  assert.equal((await openUp(yi)).status, 400);
});

test('“必须有”没对上时不能发起', async () => {
  const jia = await person('male', { age: 30, heightCm: 176 });
  const yi = await person('female', { age: 28, heightCm: 162 }, { requirements: [{ field: 'age', op: 'range', target: [25, 28], importance: 'must' }, reqs[1]] });
  await openUp(yi);
  await call('PUT', '/api/me/broker/contact', jia, { type: 'phone', value: '13400005555' });
  const r = await results(jia);
  const card = r.idealMatches[0];
  assert.equal(card.broker.state, 'ineligible');
  assert.equal((await call('POST', '/api/me/broker/requests', jia, { alias: card.alias, consent: true })).status, 403);
});

test('隐私：号码加密落盘，不进审计；删除联系方式撤回等待中的请求；删除账户清掉全部牵线数据', async () => {
  const jia = await person('male', { age: 30, heightCm: 176 });
  const yi = await person('female', { age: 28, heightCm: 162 });
  await openUp(yi);
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

  await call('PUT', '/api/me/broker/contact', yi, { type: 'phone', value: '13322223333' });
  const before = readdirSync(join(dataDir, 'contacts')).length;
  await call('DELETE', '/api/me', yi);
  assert.equal(readdirSync(join(dataDir, 'contacts')).length, before - 1);
  assert.equal((await call('GET', '/api/me/broker', jia)).body.outgoing.length, 0);
});

test('正式环境：虚拟人选标虚拟，不能牵线', async () => {
  const cfg = JSON.parse(readFileSync(join(root, 'config/app.json'), 'utf8'));
  const dir2 = mkdtempSync(join(tmpdir(), 'vier-broker-sim-'));
  const cfg2 = join(dir2, 'app.json');
  writeFileSync(cfg2, JSON.stringify({ ...cfg, testMode: false }));
  const { server: s2 } = createApp({ root, dataDir: dir2, configPath: cfg2 });
  await new Promise((r) => s2.listen(0, r));
  const b2 = `http://127.0.0.1:${s2.address().port}`;
  const c2 = async (method, path, token, body) => {
    const res = await fetch(b2 + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    const { body: { token } } = await c2('POST', '/api/session');
    await c2('PUT', '/api/me/profile', token, { gender: 'female', profile: { age: 29, heightCm: 165, city: '上海' } });
    await c2('PUT', '/api/me/requirements', token, { requirements: reqs });
    await c2('PUT', '/api/me/consent', token, { scoring: true, pool: false, research: false });
    const r = (await c2('GET', '/api/me/results', token)).body;
    assert.equal(r.idealMatches[0].broker.state, 'demo');
    assert.notEqual((await c2('POST', '/api/me/broker/requests', token, { alias: r.idealMatches[0].alias, consent: true })).status, 201);
  } finally { s2.close(); rmSync(dir2, { recursive: true, force: true }); }
});

test('测试环境：界面不标虚拟，可以向虚拟人选牵线，后台替虚拟人同意；虚拟人也能向真人发起', async () => {
  const cfg = JSON.parse(readFileSync(join(root, 'config/app.json'), 'utf8'));
  const dir3 = mkdtempSync(join(tmpdir(), 'vier-broker-test-'));
  dirs.push(dir3);
  const cfg3 = join(dir3, 'app.json');
  writeFileSync(cfg3, JSON.stringify({ ...cfg, testMode: true }));
  server.close();
  ({ server } = createApp({ root, dataDir: dir3, configPath: cfg3 }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const admin = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-admin-token': 'admin' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };

  const jia = await person('male', { age: 30, heightCm: 176 });
  const r = await results(jia);
  const card = r.idealMatches[0];
  assert.equal(card.simulated, false, '界面上不标虚拟');
  assert.equal(card.broker.state, 'open');
  await call('PUT', '/api/me/broker/contact', jia, { type: 'phone', value: '13812340000' });
  assert.equal((await call('POST', '/api/me/broker/requests', jia, { alias: card.alias, consent: true })).status, 201);

  assert.equal((await fetch(base + '/api/admin/overview')).status, 401);
  const list = (await admin('GET', '/api/admin/overview')).body;
  assert.equal(list.requests[0].to.virtual, true);
  assert.equal((await admin('POST', `/api/admin/broker/requests/${list.requests[0].id}/accept`)).status, 200);
  assert.equal((await call('GET', '/api/me/broker', jia)).body.outgoing[0].status, 'accepted');

  // 虚拟人向真人发起，真人同意后拿到假号码
  const yi = await person('female', { age: 28, heightCm: 165 });
  await openUp(yi);
  const users = (await admin('GET', '/api/admin/overview')).body.users;
  const target = users.find((u) => u.willing && u.gender === '女性');
  const vr = await admin('POST', '/api/admin/broker/virtual-request', { to: target.id });
  assert.equal(vr.status, 201);
  const inc = (await call('GET', '/api/me/broker', yi)).body.incoming[0];
  const ok = await call('POST', `/api/me/broker/requests/${inc.id}/accept`, yi, { confirm: true });
  assert.match(ok.body.contact.value, /^199\d{8}$/);
});

test('手机号登录：没登录不能牵线；换设备用同一号码登录回到原账户', async () => {
  const a = await person('female', { age: 28, heightCm: 162 }, { login: false });
  const blocked = await call('PUT', '/api/me/broker/contact', a, { type: 'phone', value: '13912345678' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.needLogin, true);
  assert.equal((await call('POST', '/api/auth/verify', a, { phone: '13912345678', code: '000000' })).status, 400);
  await loginAs(a, '13912345678');
  const me = (await call('GET', '/api/me', a)).body;
  assert.equal(me.phone, '139****5678');
  assert.equal((await call('GET', '/api/me/broker', a)).body.contact.value, '13912345678', '登录号码作为默认联系方式');

  // 另一台设备：新的匿名会话，用同一号码登录 → 拿到原账户的新令牌
  const { body: { token: other } } = await call('POST', '/api/session');
  const r = await loginAs(other, '13912345678');
  assert.equal(r.switched, true);
  const back = (await call('GET', '/api/me', r.token)).body;
  assert.equal(back.gender, 'female');
  assert.equal((await call('GET', '/api/me', a)).status, 401, '旧设备的令牌失效');
  assert.ok(!readFileSync(join(dataDir, 'phone-index.json'), 'utf8').includes('13912345678'), '索引里没有明文号码');
});

test('管理后台：号码默认打码，查看要写理由并记审计；暂停后不出现在结果里；可以删除用户', async () => {
  const admin = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-admin-token': 'admin' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const jia = await person('male', { age: 30, heightCm: 176 });
  const yi = await person('female', { age: 28, heightCm: 162 });
  const ov = (await admin('GET', '/api/admin/overview')).body;
  assert.equal(ov.users.length, 2);
  const yiRow = ov.users.find((u) => u.gender === '女性');
  assert.match(yiRow.loginPhone, /^\d{3}\*{4}\d{4}$/);
  assert.ok(!JSON.stringify(ov).match(/(?<!\d)1[3-9]\d{9}(?!\d)/), '总览里没有完整号码');

  assert.equal((await admin('POST', `/api/admin/users/${yiRow.id}/reveal`, {})).status, 400);
  const rv = await admin('POST', `/api/admin/users/${yiRow.id}/reveal`, { reason: '用户投诉核实' });
  assert.match(rv.body.loginPhone, /^1\d{10}$/);
  assert.ok(readFileSync(join(dataDir, 'audit.log'), 'utf8').includes('admin.contact_revealed'));

  assert.equal((await results(jia)).idealMatches.length, 1);
  await admin('POST', `/api/admin/users/${yiRow.id}/suspend`, { reason: '测试' });
  assert.equal((await results(jia)).idealMatches.length, 0, '暂停后不出现在别人的结果里');
  await admin('POST', `/api/admin/users/${yiRow.id}/unsuspend`, {});
  assert.equal((await results(jia)).idealMatches.length, 1);

  assert.equal((await admin('DELETE', `/api/admin/users/${yiRow.id}`, { reason: '用户要求删除' })).status, 200);
  assert.equal((await call('GET', '/api/me', yi)).status, 401);
});

test('登录切换：换到已有账户时丢掉没绑号的临时账户；已绑号的账户不会被改绑', async () => {
  const a = await person('female', { age: 28, heightCm: 162 }, { login: false });
  await loginAs(a, '13900000001');
  const { body: { token: temp } } = await call('POST', '/api/session');
  const r = await loginAs(temp, '13900000001');
  assert.equal(r.switched, true);
  assert.equal((await call('GET', '/api/me', temp)).status, 401, '临时账户被删除');

  // 已绑 P1 的账户再用 P2 登录：开新账户，P1 仍指向原账户
  const r2 = await loginAs(r.token, '13900000002');
  assert.ok(r2.token && r2.token !== r.token);
  assert.equal((await call('GET', '/api/me', r2.token)).body.phone, '139****0002');
  const { body: { token: t3 } } = await call('POST', '/api/session');
  const back = await loginAs(t3, '13900000001');
  assert.equal((await call('GET', '/api/me', back.token)).body.gender, 'female');
});
