// HTTP 服务：零依赖，Node 18+。所有打分都在服务端完成，浏览器永远拿不到人选池原始数据。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, normalize, sep } from 'node:path';
import { FileStore, latestConsent } from './store.js';
import { loadKey, auditSubject, aliasFor, sha256, safeEqualHex } from './crypto.js';
import { nameFor } from './names.js';
import { validateProfile, validateRequirements, ValidationError } from './validate.js';
import { presentRelations, formatRequirement } from './present.js';
import { computeRelations, directionOk } from '../../packages/matching/src/relations.js';
import { getScorer } from '../../packages/scoring/src/index.js';
import { FIELDS, GROUP_LABELS, FIELD_MAP, GENDERS, isUnknown } from '../../packages/schema/fields.js';
import { loadProviders } from './payments/index.js';
import { OrderService } from './payments/orders.js';
import { Broker, BrokerError, ageBand } from './broker.js';
import { generateCityPool } from './sim-generate.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createApp({ root, dataDir, configPath }) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const { key, source: keySource } = loadKey(join(dataDir, '.dev-key'));
  const store = new FileStore(dataDir, key);
  const orders = new OrderService({ dataDir, store, providers: loadProviders(config), config });
  // 测试环境：界面上不标“虚拟”，虚拟人选带假号码、默认愿意被牵线，后台可以替他们回应，用来走通牵线。
  // 正式环境（testMode=false）：虚拟人选标“虚拟”，不能被牵线，真实用户的号码不会发给不存在的人。
  const testMode = config.testMode === true;
  const isVirtual = (id) => /-SIM-\d+$/.test(String(id));
  const fakePhone = (id) => '199' + String(parseInt(sha256(id).slice(0, 12), 16) % 1e8).padStart(8, '0');
  const virtual = testMode ? { is: isVirtual, contact: (id) => (isVirtual(id) ? { type: 'phone', value: fakePhone(id) } : null) } : null;
  const broker = new Broker({ dataDir, key, config: config.broker, audit: (a, id, extra) => store.audit(a, id, extra), virtual });
  const scorer = getScorer(config.scorer.id);
  // 虚拟人选：100 城各 virtualPerCity 人（男女各半），按城首次用到时生成并缓存，可复现
  const cities = JSON.parse(readFileSync(join(root, 'config/cities.json'), 'utf8'));
  const cityByName = new Map(cities.map((c) => [c.name, c]));
  const virtualCache = new Map();
  function virtualFor(cityName) {
    const n = Number(config.virtualPerCity ?? 1000);
    const c = cityByName.get(cityName) || cityByName.get('上海');
    if (!n || !c) return [];
    if (!virtualCache.has(c.id)) virtualCache.set(c.id, generateCityPool({ cityId: c.id, cityName: c.name, count: n, incomeBand: c.incomeBand, eduTilt: c.eduTilt, ageSkew: c.ageSkew, occ: c.occ }));
    return virtualCache.get(c.id);
  }
  const webRoot = resolve(root, 'web');
  const schemaRoot = resolve(root, 'packages/schema');

  // 人选池：同意进入人选池的真人（不分城市）+ 你所在城市的虚拟人选（每张卡片标“虚拟”）
  function realPeople() {
    return store.listUserIds().map((id) => store.getUser(id)).filter((u) => {
      const c = latestConsent(u);
      return c?.pool && c?.scoring && u.gender && u.requirements.length >= 1 && !broker.isSuspended(u.id);
    });
  }
  function buildPool(cityName) {
    return [...realPeople(), ...virtualFor(cityName)];
  }

  // ---------- 牵线（docs/CONTACT-BROKER.md） ----------
  const fitOf = (profile, reqs) => scorer.score(profile || {}, reqs || [], { params: config.scorer.params });
  const gateOk = (a, b) => fitOf(a.profile, b.requirements).gate.status !== 'fail' && fitOf(b.profile, a.requirements).gate.status !== 'fail';

  // 结果卡片上的牵线状态；只给状态，不给对方 id
  function brokerCards(me) {
    const snap = broker.snapshot();
    return (p) => broker.cardState(me.id, p.id, { simulated: !testMode && !!p.simulated, gateOk: gateOk(me, p) }, snap);
  }

  // 发给乙的极简信息：性别、年龄段、城市、职业大类、双向符合的条数
  function minimalInfo(from, to) {
    const met = (r) => r.items.filter((i) => i.status === 'met').length;
    const known = (v) => (isUnknown(v) ? null : v);
    const fromFitsTo = fitOf(from.profile, to.requirements), toFitsFrom = fitOf(to.profile, from.requirements);
    return {
      gender: GENDERS[from.gender] || '',
      ageBand: ageBand(from.profile?.age),
      city: known(from.profile?.city),
      occupation: known(from.profile?.occupation),
      theyFitYou: { met: met(fromFitsTo), of: to.requirements.length },
      youFitThem: { met: met(toFitsFrom), of: from.requirements.length },
    };
  }

  // ---------- 手机号 + 验证码登录 ----------
  // 测试环境不发短信，验证码直接返回给页面并打印在终端；正式环境要接短信服务（docs/AUTH.md）
  const PHONE_RE = /^1[3-9]\d{9}$/;
  const codes = new Map(); // phoneKey -> { hash, exp, tries, sentAt }
  const isLoggedIn = (uid) => !!store.getIdentity(uid)?.phone;
  const maskPhone = (p) => (p ? p.slice(0, 3) + '****' + p.slice(-4) : null);
  async function handleAuth(req, res, path, method) {
    const body = await readBody(req);
    const phone = String(body.phone || '').replace(/\s+/g, '');
    if (!PHONE_RE.test(phone)) throw new ValidationError('请填 11 位手机号');
    const k = store.phoneKey(phone);
    if (path === '/api/auth/code' && method === 'POST') {
      const prev = codes.get(k);
      if (prev && Date.now() - prev.sentAt < 60000) throw new BrokerError(429, '验证码发得太频繁，请 1 分钟后再试');
      if (!testMode) throw new BrokerError(503, '短信服务还没有接入');
      const code = String(Math.floor(100000 + Math.random() * 900000));
      codes.set(k, { hash: sha256(k + code), exp: Date.now() + 5 * 60000, tries: 0, sentAt: Date.now() });
      console.log(`[测试环境] ${maskPhone(phone)} 的验证码：${code}`);
      return json(res, 200, { ok: true, devCode: code });
    }
    if (path === '/api/auth/verify' && method === 'POST') {
      const c = codes.get(k);
      if (!c || c.exp < Date.now()) throw new BrokerError(400, '验证码过期了，请重新获取');
      if (++c.tries > 5) { codes.delete(k); throw new BrokerError(429, '试错太多次，请重新获取验证码'); }
      if (!safeEqualHex(c.hash, sha256(k + String(body.code || '').trim()))) throw new BrokerError(400, '验证码不对');
      codes.delete(k);
      const current = auth(req);
      const existing = store.findByPhone(phone);
      let id, token = null;
      const currentPhone = current ? store.getIdentity(current)?.phone : null;
      if (existing) {
        // 这个号码已有账户：换到那个账户（换设备找回）
        id = existing;
        if (existing !== current) {
          token = `${id}.${store.issueToken(id)}`;
          // 本机刚填的匿名账户没绑号码，换走后就再也回不来：删掉，免得变成没人管的“幽灵人选”留在人选池里
          if (current && !currentPhone) { broker.purgeUser(current); store.deleteUser(current); }
        }
      } else if (current && !currentPhone) {
        // 匿名账户第一次登录：直接绑上这个号码，资料都保留
        id = current;
        store.bindPhone(id, phone);
      } else {
        // 没有账户，或者当前账户已经绑了别的号码：用新号码开一个新账户，不改动别人的绑定
        const n = store.createUser(); id = n.id; token = `${n.id}.${n.token}`;
        store.bindPhone(id, phone);
      }
      // 登录手机号顺便作为默认联系方式
      if (!broker.getContact(id)) broker.saveContact(id, { type: 'phone', value: phone });
      return json(res, 200, { ok: true, token, switched: !!existing && existing !== current });
    }
    return json(res, 404, { error: 'not found' });
  }

  async function handleBroker(req, res, uid, path, method, body) {
    const u = store.getUser(uid);
    if (method !== 'GET' && !isLoggedIn(uid)) return json(res, 403, { error: '请先用手机号登录', needLogin: true });
    const aliasOf = (otherId) => aliasFor(key, uid, otherId);
    const nameOf = (otherId) => { const p = (isVirtual(otherId) ? null : store.getUser(otherId)) || virtualFor(u.profile?.city).find((x) => x.id === otherId); return p ? nameFor(key, uid, p) : null; };
    if (path === '/api/me/broker' && method === 'GET') return json(res, 200, { ...broker.overview(uid, aliasOf, nameOf), inPool: !!latestConsent(u)?.pool, loggedIn: isLoggedIn(uid) });
    if (path === '/api/me/broker/contact' && method === 'PUT') {
      const c = broker.saveContact(uid, body);
      return json(res, 200, { ok: true, contact: c });
    }
    if (path === '/api/me/broker/contact' && method === 'DELETE') { broker.deleteContact(uid); return json(res, 200, { ok: true }); }
    if (path === '/api/me/broker/willing' && method === 'PUT') {
      // 登录手机号就是默认联系方式：还没留过时自动用它，避免“先开开关、后存号码”被拒
      const phone = store.getIdentity(uid)?.phone;
      if (body.willing === true && !broker.getContact(uid) && phone) broker.saveContact(uid, { type: 'phone', value: phone });
      broker.setWilling(uid, body.willing === true, { inPool: !!latestConsent(u)?.pool });
      return json(res, 200, { ok: true, willing: body.willing === true });
    }
    if (path === '/api/me/broker/requests' && method === 'POST') {
      if (body.consent !== true) throw new BrokerError(400, '请先勾选同意');
      if (!latestConsent(u)?.scoring || !u.gender) throw new BrokerError(400, '请先填写资料');
      // 在“你自己的人选池”里用代号找回对方；找不到就说找不到，不透露原因
      const alias = String(body.alias || '');
      const target = alias && buildPool(u.profile?.city).find((p) => p.id !== uid && directionOk(u, p) && aliasOf(p.id) === alias);
      if (!target) throw new BrokerError(404, '找不到这位人选');
      if (target.simulated && !testMode) throw new BrokerError(400, '虚拟人选不能牵线');
      if (!gateOk(u, target)) throw new BrokerError(403, '你们有“必须有”的条件没对上，不能牵线');
      // 限流：24 小时内最多发起 10 次，防止群发骚扰
      const dayAgo = Date.now() - 24 * 3600e3;
      const sent = broker.allRequests().filter((r) => r.from === uid && Date.parse(r.createdAt) > dayAgo).length;
      if (sent >= Number(config.broker?.dailyLimit ?? 10)) throw new BrokerError(429, '今天发得太多了，明天再试');
      const id = broker.createRequest({ from: uid, to: target.id, minimal: minimalInfo(u, target) });
      return json(res, 201, { ok: true, requestId: id });
    }
    const m = path.match(/^\/api\/me\/broker\/requests\/(r_[0-9a-f]{16})\/(cancel|accept|decline|seen|block)$/);
    if (m && method === 'POST') {
      const [, id, act] = m;
      if (act === 'accept') return json(res, 200, { ok: true, contact: broker.accept(uid, id, { confirm: body.confirm }) });
      ({ cancel: () => broker.cancel(uid, id), decline: () => broker.decline(uid, id), seen: () => broker.markSeen(uid, id), block: () => broker.block(uid, id) })[act]();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  // ---------- 管理后台（docs/ADMIN.md）----------
  // 正式环境必须设置 ADMIN_TOKEN；测试环境没设时口令是 admin。号码默认打码，查看完整号码要写理由并记审计。
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const virtualById = (id) => virtualFor(cityById.get(String(id).split('-SIM-')[0])?.name).find((p) => p.id === id) || null;
  const personOf = (id) => (isVirtual(id) ? virtualById(id) : store.getUser(id));
  const brief = (p) => p && ({ id: p.id, virtual: !!p.simulated, gender: GENDERS[p.gender] || '', age: p.profile?.age ?? null, city: p.profile?.city ?? null, occupation: p.profile?.occupation ?? null });
  const maskContact = (c) => (c ? { type: c.type, value: c.type === 'phone' ? maskPhone(c.value) : c.value.slice(0, 2) + '***' } : null);
  function adminOk(req) {
    const expected = process.env.ADMIN_TOKEN || (testMode ? 'admin' : '');
    const got = String(req.headers['x-admin-token'] || '');
    return !!expected && !!got && safeEqualHex(sha256(got), sha256(expected));
  }
  async function handleAdmin(req, res, path, method) {
    if (!adminOk(req)) return json(res, 401, { error: '管理员口令不对' });
    const body = ['POST', 'DELETE'].includes(method) ? await readBody(req) : {};
    if (path === '/api/admin/overview' && method === 'GET') {
      const users = store.listUserIds().map((id) => store.getUser(id)).filter(Boolean).map((u) => {
        const c = latestConsent(u), idn = store.getIdentity(u.id);
        return {
          ...brief(u), createdAt: u.createdAt, lastActiveAt: u.lastActiveAt, plan: u.plan,
          filled: !!u.gender && u.requirements.length > 0, pool: !!c?.pool,
          loginPhone: maskPhone(idn?.phone), contact: maskContact(broker.getContact(u.id)),
          willing: broker.isWilling(u.id), suspended: broker.isSuspended(u.id), ...broker.stats(u.id),
        };
      }).sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt));
      const requests = broker.allRequests().map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, from: brief(personOf(r.from)), to: brief(personOf(r.to)) })).reverse();
      return json(res, 200, { testMode, users, requests });
    }
    const um = path.match(/^\/api\/admin\/users\/(u_[0-9a-f]{24})(?:\/(reveal|suspend|unsuspend))?$/);
    if (um) {
      const [, id, act] = um;
      if (!store.getUser(id)) return json(res, 404, { error: '找不到这个用户' });
      const reason = String(body.reason || '').trim().slice(0, 200);
      if (act === 'reveal' && method === 'POST') {
        if (reason.length < 2) throw new ValidationError('请写明查看号码的理由');
        store.audit('admin.contact_revealed', id, { reason });
        return json(res, 200, { loginPhone: store.getIdentity(id)?.phone || null, contact: broker.getContact(id) });
      }
      if ((act === 'suspend' || act === 'unsuspend') && method === 'POST') {
        broker.setSuspended(id, act === 'suspend');
        store.audit(`admin.${act}`, id, { reason });
        return json(res, 200, { ok: true });
      }
      if (!act && method === 'DELETE') {
        if (reason.length < 2) throw new ValidationError('请写明删除理由');
        orders.anonymizeUser(id, (x) => auditSubject(key, x));
        broker.purgeUser(id);
        store.deleteUser(id);
        store.audit('admin.user_deleted', id, { reason });
        return json(res, 200, { ok: true });
      }
    }
    // 以下只在测试环境：替虚拟人回应、让虚拟人发起
    if (!testMode) return json(res, 404, { error: 'not found' });
    const m = path.match(/^\/api\/admin\/broker\/requests\/(r_[0-9a-f]{16})\/(accept|decline)$/);
    if (m && method === 'POST') {
      const r = broker.allRequests().find((x) => x.id === m[1]);
      if (!r || !isVirtual(r.to)) return json(res, 404, { error: '找不到这个请求' });
      if (m[2] === 'accept') broker.accept(r.to, r.id, { confirm: true }); else broker.decline(r.to, r.id);
      return json(res, 200, { ok: true });
    }
    if (path === '/api/admin/broker/virtual-request' && method === 'POST') {
      const to = store.getUser(String(body.to || ''));
      if (!to) return json(res, 404, { error: '找不到这个用户' });
      // 只挑双方“必须有”都满足的人，再按双向符合条数从高到低选第一个
      const score = (p) => { const m = minimalInfo(p, to); return m.theyFitYou.met + m.youFitThem.met; };
      const from = virtualFor(to.profile?.city)
        .filter((p) => directionOk(p, to) && gateOk(p, to) && broker.cardState(p.id, to.id, { simulated: false, gateOk: true }).state === 'open')
        .map((p) => [score(p), p]).sort((x, y) => y[0] - x[0])[0]?.[1];
      if (!from) return json(res, 400, { error: '这个用户还没打开“愿意被牵线”，或者找不到合适的虚拟人选' });
      const id = broker.createRequest({ from: from.id, to: to.id, minimal: minimalInfo(from, to) });
      return json(res, 201, { ok: true, requestId: id, from: brief(from) });
    }
    return json(res, 404, { error: 'not found' });
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };

  async function readRaw(req) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > 64 * 1024) throw new ValidationError('请求过大'); chunks.push(c); }
    return Buffer.concat(chunks).toString('utf8');
  }

  async function readBody(req) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > 64 * 1024) throw new ValidationError('请求过大'); chunks.push(c); }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ValidationError('JSON 格式错误'); }
  }

  function auth(req) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer ([^.]+)\.(.+)$/);
    return m ? store.authenticate(m[1], m[2]) : null;
  }

  function serveStatic(res, base, rel) {
    const p = normalize(join(base, rel));
    if (!p.startsWith(base + sep) && p !== base) return json(res, 404, { error: 'not found' });
    const file = existsSync(p) && statSync(p).isDirectory() ? join(p, 'index.html') : p;
    if (!existsSync(file)) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-cache',
      'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
    });
    res.end(readFileSync(file));
  }

  // k-匿名的分布统计：任何一档人数少于 k 时合并为“其他”，避免单个人被识别
  function stats(field) {
    const f = FIELD_MAP[field];
    if (!f || f.tier !== 'L1') return null;
    const pool = realPeople();
    const counts = {};
    for (const p of pool) {
      const v = p.profile[field];
      const k = isUnknown(v) ? '未填写' : String(v);
      counts[k] = (counts[k] || 0) + 1;
    }
    const k = config.privacy.kAnonymity;
    const out = {}; let other = 0;
    for (const [v, n] of Object.entries(counts)) (n >= k ? (out[v] = n) : (other += n));
    if (other) out['其他（合并小样本）'] = other;
    return { field, label: f.label, counts: out };
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const method = req.method;

    if (!path.startsWith('/api/')) {
      if (path.startsWith('/schema/')) return serveStatic(res, schemaRoot, path.slice('/schema/'.length));
      return serveStatic(res, webRoot, path === '/' ? 'index.html' : path.slice(1));
    }

    if (path === '/api/config' && method === 'GET') {
      return json(res, 200, {
        fields: FIELDS, groups: GROUP_LABELS, plans: config.plans, testMode,
        consentVersion: config.privacy.consentVersion, scorer: config.scorer.id,
        payments: { mode: config.payments.mode, providers: orders.listProviders() },
      });
    }
    if (path === '/api/stats' && method === 'GET') {
      const s = stats(url.searchParams.get('field'));
      return s ? json(res, 200, s) : json(res, 400, { error: '只能查询基础字段的匿名分布' });
    }
    if (path === '/api/session' && method === 'POST') {
      const { id, token } = store.createUser();
      return json(res, 201, { token: `${id}.${token}` });
    }

    // 支付渠道的异步通知：渠道直接调用，不带用户令牌，靠渠道签名验证
    const notify = path.match(/^\/api\/payments\/notify\/([a-z]+)$/);
    if (notify && method === 'POST') {
      const provider = orders.provider(notify[1]);
      if (!provider || provider.mock) return json(res, 404, { error: 'not found' });
      let ok = false;
      try {
        const n = provider.parseNotify({ headers: req.headers, rawBody: await readRaw(req) });
        if (n.paid) orders.markPaid(n.orderNo, n);
        ok = true;
      } catch (e) {
        store.audit('payment.notify_rejected', null, { provider: provider.id, reason: e.message });
      }
      const a = provider.ackNotify(ok);
      res.writeHead(a.status, { 'content-type': a.contentType });
      return res.end(a.body);
    }

    if (path.startsWith('/api/admin/')) return await handleAdmin(req, res, path, method);
    if (path.startsWith('/api/auth/')) return await handleAuth(req, res, path, method);
    const uid = auth(req);
    if (!uid) return json(res, 401, { error: '请先开始测试' });
    const body = ['PUT', 'POST'].includes(method) ? await readBody(req) : null;
    if (path.startsWith('/api/me/broker')) return await handleBroker(req, res, uid, path, method, body);

    if (path === '/api/me' && method === 'GET') {
      const u = store.getUser(uid);
      return json(res, 200, { gender: u.gender, profile: u.profile, requirements: u.requirements, plan: u.plan, consent: latestConsent(u), identity: { nickname: store.getIdentity(uid)?.nickname }, phone: maskPhone(store.getIdentity(uid)?.phone), broker: broker.counts(uid) });
    }
    if (path === '/api/me/profile' && method === 'PUT') {
      store.saveProfile(uid, validateProfile(body));
      if (body.identity) store.saveIdentity(uid, { nickname: String(body.identity.nickname || '').slice(0, 20) });
      return json(res, 200, { ok: true });
    }
    if (path === '/api/me/requirements' && method === 'PUT') {
      const reqs = validateRequirements(body.requirements);
      store.saveRequirements(uid, reqs);
      return json(res, 200, { ok: true, requirements: reqs.map(formatRequirement) });
    }
    if (path === '/api/me/consent' && method === 'PUT') {
      const c = { version: config.privacy.consentVersion, at: new Date().toISOString(), scoring: !!body.scoring, pool: !!body.pool, research: !!body.research };
      store.saveConsents(uid, c);
      // 退出人选池时，“愿意被牵线”自动关闭（没有匹配数据，牵线无意义）
      if (!c.pool && broker.isWilling(uid)) broker.setWilling(uid, false, { inPool: false });
      return json(res, 200, { ok: true, consent: c });
    }
    if (path === '/api/me/orders' && method === 'POST') {
      const o = await orders.create(uid, String(body.plan || ''), String(body.provider || '')).catch((e) => { throw new ValidationError(e.message); });
      return json(res, 201, { orderNo: o.orderNo, codeUrl: o.codeUrl, amountFen: o.amountFen, expireAt: o.expireAt, provider: o.provider, mock: !!orders.provider(o.provider).mock });
    }
    const orderPath = path.match(/^\/api\/me\/orders\/(V[0-9A-F]+)(\/mock-pay)?$/);
    if (orderPath && method === 'GET' && !orderPath[2]) {
      const s = await orders.status(uid, orderPath[1]);
      return s ? json(res, 200, s) : json(res, 404, { error: '订单不存在' });
    }
    if (orderPath && method === 'POST' && orderPath[2]) {
      // 只在模拟支付模式下可用，用来走通“扫码 → 支付成功 → 升级”的流程
      if (config.payments.mode !== 'mock') return json(res, 404, { error: 'not found' });
      const o = orders.get(orderPath[1]);
      if (!o || o.userId !== uid) return json(res, 404, { error: '订单不存在' });
      orders.markPaid(o.orderNo, { amountFen: o.amountFen, providerTradeNo: 'MOCK-' + o.orderNo });
      return json(res, 200, { ok: true });
    }
    if (path === '/api/me/results' && method === 'GET') {
      const u = store.getUser(uid);
      const c = latestConsent(u);
      if (!c?.scoring) return json(res, 403, { error: '需要先同意“用你的资料计算结果”' });
      if (!u.gender || !u.requirements.length) return json(res, 400, { error: '请先填写资料和理想型' });
      const limits = config.plans[u.plan] || config.plans.free;
      const rel = computeRelations({ me: u, pool: buildPool(u.profile?.city), limits, scorerId: config.scorer.id, params: config.scorer.params });
      store.audit('results.computed', uid, { plan: u.plan });
      return json(res, 200, { plan: u.plan, ...presentRelations(key, u, rel, { brokerFor: brokerCards(u), hideVirtual: testMode }) });
    }
    if (path === '/api/me/export' && method === 'GET') {
      const u = store.getUser(uid);
      store.audit('data.exported', uid);
      return json(res, 200, { exportedAt: new Date().toISOString(), account: u, identity: store.getIdentity(uid), broker: broker.exportFor(uid) });
    }
    if (path === '/api/me' && method === 'DELETE') {
      orders.anonymizeUser(uid, (id) => auditSubject(key, id));
      broker.purgeUser(uid);
      store.deleteUser(uid);
      return json(res, 200, { ok: true, deleted: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (e instanceof ValidationError) return json(res, 400, { error: e.message });
      if (e instanceof BrokerError) return json(res, e.status, { error: e.message, ...(e.until ? { until: e.until } : {}) });
      console.error(e);
      json(res, 500, { error: '服务器错误' });
    });
  });
  return { server, store, config, keySource, broker };
}
