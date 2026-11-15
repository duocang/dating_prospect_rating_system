// HTTP 服务：零依赖，Node 18+。所有打分都在服务端完成，浏览器永远拿不到人选池原始数据。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, normalize, sep } from 'node:path';
import { FileStore, latestConsent } from './store.js';
import { loadKey, auditSubject } from './crypto.js';
import { validateProfile, validateRequirements, ValidationError } from './validate.js';
import { presentRelations, formatRequirement } from './present.js';
import { computeRelations } from '../../packages/matching/src/relations.js';
import { FIELDS, GROUP_LABELS, FIELD_MAP, isUnknown } from '../../packages/schema/fields.js';
import { loadProviders } from './payments/index.js';
import { OrderService } from './payments/orders.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createApp({ root, dataDir, configPath }) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const { key, source: keySource } = loadKey(join(dataDir, '.dev-key'));
  const store = new FileStore(dataDir, key);
  const orders = new OrderService({ dataDir, store, providers: loadProviders(config), config });
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

    if (path === '/api/me' && method === 'GET') {
      const u = store.getUser(uid);
      return json(res, 200, { gender: u.gender, profile: u.profile, requirements: u.requirements, plan: u.plan, consent: latestConsent(u), identity: store.getIdentity(uid) });
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
      return json(res, 200, { plan: u.plan, poolMode: config.poolMode, ...presentRelations(key, u, rel) });
    }
    if (path === '/api/me/export' && method === 'GET') {
      const u = store.getUser(uid);
      store.audit('data.exported', uid);
      return json(res, 200, { exportedAt: new Date().toISOString(), account: u, identity: store.getIdentity(uid) });
    }
    if (path === '/api/me' && method === 'DELETE') {
      orders.anonymizeUser(uid, (id) => auditSubject(key, id));
      store.deleteUser(uid);
      return json(res, 200, { ok: true, deleted: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (e instanceof ValidationError) return json(res, 400, { error: e.message });
      console.error(e);
      json(res, 500, { error: '服务器错误' });
    });
  });
  return { server, store, config, keySource };
}
