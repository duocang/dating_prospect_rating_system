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
// 进程内拿到验证码明文（只有测试会传 onCaptcha，HTTP 上拿不到）
const answers = new Map();

before(async () => {
  // 这组用例验证结果的结构：池子里有上海的虚拟人选
  const configPath = join(dataDir, 'app.json');
  writeFileSync(configPath, JSON.stringify({ ...JSON.parse(readFileSync(join(root, 'config/app.json'), 'utf8')) }));
  ({ server } = createApp({ root, dataDir, configPath, onCaptcha: (id, a) => answers.set(id, a) }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); rmSync(dataDir, { recursive: true, force: true }); });

const call = async (method, path, token, body) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

const profile = { gender: 'female', profile: { age: 29, heightCm: 165, city: '上海', education: '硕士', incomeAnnual: 180000, personalNetAssets: '50–100万元', childrenPlan: '希望育儿', secretField: 'x' }, identity: { nickname: '小测', wechat: 'xiaoce_2026' } };
const requirements = [
  { field: 'age', op: 'range', target: [28, 34], importance: 3 },
  { field: 'incomeAnnual', op: 'atLeast', target: 150000, importance: 3 },
  { field: 'childrenPlan', op: 'in', target: ['希望育儿', '尚未决定'], importance: 'must' },
];

const consent = { adult: true, scoring: true, pool: false, research: false };
const admin = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-admin-token': 'admin' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
// 新流程：管理员登记号 → 本人输号 + 验证码进入 → 填资料、要求、同意
async function enter(kind, handle, answer) {
  const c = await call('GET', '/api/captcha');
  return call('POST', '/api/start', null, { kind, handle, captchaId: c.body.id, answer: answer ?? answers.get(c.body.id) });
}
let seq = 0;
async function signup({ identity = {}, consent: cs = consent, ...extra } = {}) {
  const wechat = identity.wechat || `user_test_${++seq}`;
  const { body: { id } } = await admin('POST', '/api/admin/users', { wechat, nickname: identity.nickname ?? profile.identity.nickname });
  const { body: { token } } = await enter('wechat', wechat);
  await call('PUT', '/api/me/profile', token, { gender: profile.gender, profile: profile.profile, ...extra });
  await call('PUT', '/api/me/requirements', token, { requirements });
  await call('PUT', '/api/me/consent', token, cs);
  return { id, wechat, body: { token } };
}

test('验证码是画出来的 SVG，没有 <text>，也不带答案', async () => {
  const r = await call('GET', '/api/captcha');
  assert.equal(r.status, 200);
  assert.match(r.body.id, /^c_[0-9a-f]{24}$/);
  assert.match(r.body.svg, /^<svg[^>]*>/);
  assert.ok(r.body.svg.includes('<path'));
  assert.ok(!/<text|<title|<desc|<metadata|font/i.test(r.body.svg));
  assert.ok(!r.body.svg.includes(answers.get(r.body.id)));
  assert.deepEqual(Object.keys(r.body).sort(), ['id', 'svg']);
});

test('凭号进入：没验证码、答错、重复用同一张、没登记的号都进不去', async () => {
  const { body: { id } } = await admin('POST', '/api/admin/users', { xhs: 'Gate_01' });
  assert.equal((await call('POST', '/api/start', null, { kind: 'xhs', handle: 'gate_01' })).status, 400);
  const c = await call('GET', '/api/captcha');
  const right = answers.get(c.body.id);
  const wrong = right.slice(0, 4) + (right[4] === '2' ? '3' : '2');
  const r1 = await call('POST', '/api/start', null, { kind: 'xhs', handle: 'gate_01', captchaId: c.body.id, answer: wrong });
  assert.equal(r1.status, 400);
  assert.match(r1.body.error, /验证码/);
  // 答错后这张就作废了，答对也不行
  assert.equal((await call('POST', '/api/start', null, { kind: 'xhs', handle: 'gate_01', captchaId: c.body.id, answer: right })).status, 400);
  const none = await enter('xhs', 'not_registered');
  assert.equal(none.status, 404);
  assert.match(none.body.error, /还没登记/);
  // 空账户：大小写不同也认，直接拿到令牌，就是管理员建的那个账户
  const ok = await enter('xhs', 'GATE_01');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.token.split('.')[0], id);
  assert.equal((await call('GET', '/api/me', ok.body.token)).body.identity.xhs, 'Gate_01');
});

test('后台建号：至少一个号，同一个号不能给两个人，格式要对', async () => {
  assert.equal((await admin('POST', '/api/admin/users', {})).status, 400);
  assert.equal((await admin('POST', '/api/admin/users', { wechat: '12ab' })).status, 400);
  assert.equal((await admin('POST', '/api/admin/users', { douyin: '有中文' })).status, 400);
  const a = (await admin('POST', '/api/admin/users', { douyin: 'dy.only' })).body.id;
  assert.equal((await admin('POST', '/api/admin/users', { douyin: 'DY.ONLY' })).status, 409);
  const b = (await admin('POST', '/api/admin/users', { wechat: 'second_one' })).body.id;
  assert.equal((await admin('PUT', `/api/admin/users/${b}/handles`, { douyin: 'dy.only' })).status, 409);
  const r = await admin('PUT', `/api/admin/users/${a}/handles`, { xhs: 'Hong_shu88' });
  assert.equal(r.body.xhs, 'Hong_shu88');
  assert.equal((await admin('GET', `/api/admin/users/${a}`)).body.douyin, 'dy.only');
  assert.equal((await fetch(`${base}/api/admin/users`, { method: 'POST', headers: { 'x-admin-token': 'no' } })).status, 401);
});

test('完整流程：注册、填写、同意、结果、导出、删除', async () => {
  const { body: { token } } = await signup();
  assert.equal((await call('PUT', '/api/me/profile', token, profile)).status, 200);
  assert.equal((await call('PUT', '/api/me/requirements', token, { requirements })).status, 200);

  // 撤回同意时不计算
  await call('PUT', '/api/me/consent', token, { scoring: false, pool: false, research: false });
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
  const file = token.split('.')[0] + '.json';
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
  const { body: { token } } = await signup();
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

test('管理员查看单个用户：全部字段和要求都列出，没填的标未填写', async () => {
  const { body: { token } } = await signup();
  const id = token.split('.')[0];
  const get = async (tok) => { const r = await fetch(`${base}/api/admin/users/${id}`, { headers: { 'x-admin-token': tok } }); return { status: r.status, body: await r.json() }; };
  assert.equal((await get('wrong')).status, 401);
  const { status, body } = await get('admin');
  assert.equal(status, 200);
  assert.equal(body.nickname, '小测');
  const p = Object.fromEntries(body.profile.map((r) => [r.label, r]));
  assert.equal(p['身高'].value, '165 cm');
  assert.equal(p['身高'].filled, true);
  assert.ok(body.profile.some((r) => !r.filled && r.value === '未填写'));
  assert.ok(body.requirements.length > requirements.length);
  assert.ok(body.requirements.some((r) => r.filled && r.importance === '必须'));
  assert.ok(body.requirements.some((r) => !r.filled && r.text === '未填写'));
});

test('管理员总览含虚构人选，虚构人也能看详情和星空关系', async () => {
  await signup();
  const h = { headers: { 'x-admin-token': 'admin' } };
  const o = await (await fetch(`${base}/api/admin/overview?city=上海`, h)).json();
  const sim = o.people.find((p) => p.virtual);
  assert.ok(sim && o.people.some((p) => !p.virtual));
  assert.equal(o.fields.length, Object.keys(sim.facts).length);
  const d = await (await fetch(`${base}/api/admin/users/${sim.id}`, h)).json();
  assert.equal(d.virtual, true);
  assert.ok(d.relations && Array.isArray(d.relations.idealMatches));
  const real = o.people.find((p) => !p.virtual && p.filled);
  const r = await (await fetch(`${base}/api/admin/users/${real.id}`, h)).json();
  assert.ok(r.relations.idealMatches.length > 0);
});

test('介绍自己少于 3 题不能同意计算；号只能管理员改', async () => {
  const wechat = 'few_answers';
  await admin('POST', '/api/admin/users', { wechat });
  const { body: { token } } = await enter('wechat', wechat);
  await call('PUT', '/api/me/profile', token, { gender: 'female', profile: { age: 29, incomeAnnual: 180000 }, identity: { wechat: 'hacked_1', nickname: 'x' } });
  const c = await call('PUT', '/api/me/consent', token, consent);
  assert.equal(c.status, 400);
  assert.match(c.body.error, /至少要答 3 道/);
  assert.equal((await call('GET', '/api/me', token)).body.identity.wechat, wechat);
});

test('填过的人再进来：答对 3 道题；连错 3 次锁一天；管理员可以清空重填', async () => {
  const { id, wechat, body: { token: old } } = await signup({ identity: { nickname: '找' } });
  const q = await enter('wechat', wechat.toUpperCase());
  assert.equal(q.status, 200);
  assert.equal(q.body.questions.length, 3);
  assert.ok(!q.body.token);
  const right = Object.fromEntries(q.body.questions.map((k) => [k, profile.profile[k]]));
  const wrong = { ...right, [q.body.questions[0]]: 'x' };
  // 答错两次，答对一次会清零
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', '/api/start/answer', null, { pass: q.body.pass, answers: wrong })).status, 400);
  const ok = await call('POST', '/api/start/answer', null, { pass: q.body.pass, answers: right });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/api/me', ok.body.token)).body.identity.nickname, '找');
  assert.equal((await call('GET', '/api/me', old)).status, 401, '旧设备退出');
  // 通行证只能用一次
  assert.equal((await call('POST', '/api/start/answer', null, { pass: q.body.pass, answers: right })).status, 400);
  // 连错 3 次：锁住，换新验证码也进不去
  const q2 = await enter('wechat', wechat);
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', '/api/start/answer', null, { pass: q2.body.pass, answers: wrong })).status, 400);
  assert.equal((await call('POST', '/api/start/answer', null, { pass: q2.body.pass, answers: wrong })).status, 429);
  assert.equal((await enter('wechat', wechat)).status, 429);
  // 清空重填：资料没了、令牌作废、号还在
  assert.equal((await admin('POST', `/api/admin/users/${id}/reset`)).status, 200);
  assert.equal((await call('GET', '/api/me', ok.body.token)).status, 401);
  const d = await admin('GET', `/api/admin/users/${id}`);
  assert.equal(d.body.wechat, wechat);
  assert.ok(d.body.profile.every((r) => !r.filled));
});
