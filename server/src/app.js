// HTTP 服务：零依赖，Node 18+。所有打分都在服务端完成，浏览器永远拿不到人选池原始数据。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, normalize, sep } from 'node:path';
import { FileStore, latestConsent } from './store.js';
import { loadKey, auditSubject, aliasFor } from './crypto.js';
import { validateProfile, validateRequirements, ValidationError } from './validate.js';
import { presentRelations, formatRequirement } from './present.js';
import { computeRelations, directionOk } from '../../packages/matching/src/relations.js';
import { getScorer } from '../../packages/scoring/src/index.js';
import { FIELDS, GROUP_LABELS, FIELD_MAP, GENDERS, isUnknown } from '../../packages/schema/fields.js';
import { loadProviders } from './payments/index.js';
import { OrderService } from './payments/orders.js';
import { Broker, BrokerError, ageBand } from './broker.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createApp({ root, dataDir, configPath }) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const { key, source: keySource } = loadKey(join(dataDir, '.dev-key'));
  const store = new FileStore(dataDir, key);
  const orders = new OrderService({ dataDir, store, providers: loadProviders(config), config });
  const broker = new Broker({ dataDir, key, config: config.broker, audit: (a, id, extra) => store.audit(a, id, extra) });
  const scorer = getScorer(config.scorer.id);
  const simPath = join(root, 'server/seed/sim-pool.json');
  const simPool = existsSync(simPath) ? JSON.parse(readFileSync(simPath, 'utf8')).people : [];
  const webRoot = resolve(root, 'web');
  const schemaRoot = resolve(root, 'packages/schema');

  // 人选池：模拟模式只用模拟档案；真人模式只用同意进入人选池的真人。两者永不混用。
  function buildPool() {
    if (config.poolMode === 'simulated') return simPool;
    return store.listUserIds().map((id) => store.getUser(id)).filter((u) => {
      const c = latestConsent(u);
      return c?.pool && c?.scoring && u.gender && u.requirements.length >= 1;
    });
  }

  // ---------- 牵线（docs/CONTACT-BROKER.md） ----------
  const fitOf = (profile, reqs) => scorer.score(profile || {}, reqs || [], { params: config.scorer.params });
  const gateOk = (a, b) => fitOf(a.profile, b.requirements).gate.status !== 'fail' && fitOf(b.profile, a.requirements).gate.status !== 'fail';

  // 结果卡片上的牵线状态；只给状态，不给对方 id
  function brokerCards(me) {
    const snap = broker.snapshot();
    return (p) => broker.cardState(me.id, p.id, { simulated: !!p.simulated, gateOk: !p.simulated && gateOk(me, p) }, snap);
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

  async function handleBroker(req, res, uid, path, method, body) {
    const u = store.getUser(uid);
    const aliasOf = (otherId) => aliasFor(key, uid, otherId);
    if (path === '/api/me/broker' && method === 'GET') return json(res, 200, { ...broker.overview(uid, aliasOf), inPool: !!latestConsent(u)?.pool, poolMode: config.poolMode });
    if (path === '/api/me/broker/contact' && method === 'PUT') {
      const c = broker.saveContact(uid, body);
      return json(res, 200, { ok: true, contact: c });
    }
    if (path === '/api/me/broker/contact' && method === 'DELETE') { broker.deleteContact(uid); return json(res, 200, { ok: true }); }
    if (path === '/api/me/broker/willing' && method === 'PUT') {
      broker.setWilling(uid, body.willing === true, { inPool: !!latestConsent(u)?.pool });
      return json(res, 200, { ok: true, willing: body.willing === true });
    }
    if (path === '/api/me/broker/requests' && method === 'POST') {
      if (body.consent !== true) throw new BrokerError(400, '请先勾选同意');
      if (config.poolMode !== 'real') throw new BrokerError(400, '演示模式下的人选是模拟的，不能牵线');
      if (!latestConsent(u)?.scoring || !u.gender) throw new BrokerError(400, '请先填写资料');
      // 在“你自己的人选池”里用代号找回对方；找不到就说找不到，不透露原因
      const alias = String(body.alias || '');
      const target = alias && buildPool().find((p) => p.id !== uid && directionOk(u, p) && aliasOf(p.id) === alias);
      if (!target) throw new BrokerError(404, '找不到这位人选');
      if (!gateOk(u, target)) throw new BrokerError(403, '你们有“必须有”的条件没对上，不能牵线');
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
    const pool = buildPool();
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
    return { field, label: f.label, simulated: config.poolMode === 'simulated', counts: out };
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
        fields: FIELDS, groups: GROUP_LABELS, plans: config.plans, poolMode: config.poolMode,
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

    const uid = auth(req);
    if (!uid) return json(res, 401, { error: '请先开始测试' });
    const body = ['PUT', 'POST'].includes(method) ? await readBody(req) : null;
    if (path.startsWith('/api/me/broker')) return await handleBroker(req, res, uid, path, method, body);

    if (path === '/api/me' && method === 'GET') {
      const u = store.getUser(uid);
      return json(res, 200, { gender: u.gender, profile: u.profile, requirements: u.requirements, plan: u.plan, consent: latestConsent(u), identity: store.getIdentity(uid), broker: broker.counts(uid) });
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
      const rel = computeRelations({ me: u, pool: buildPool(), limits, scorerId: config.scorer.id, params: config.scorer.params });
      store.audit('results.computed', uid, { plan: u.plan });
      return json(res, 200, { plan: u.plan, poolMode: config.poolMode, ...presentRelations(key, u, rel, { brokerFor: brokerCards(u) }) });
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
