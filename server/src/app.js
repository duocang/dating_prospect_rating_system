// HTTP 服务：零依赖，Node 18+。所有打分都在服务端完成，浏览器永远拿不到人选池原始数据。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, normalize, sep } from 'node:path';
import { FileStore, latestConsent } from './store.js';
import { loadKey, sha256, safeEqualHex } from './crypto.js';
import { validateProfile, validateRequirements, ValidationError } from './validate.js';
import { presentRelations, formatRequirement, formatValue, FIELD_SECTIONS } from './present.js';
import { computeRelations } from '../../packages/matching/src/relations.js';
import { FIELDS, GROUP_LABELS, FIELD_MAP, GENDERS, isUnknown } from '../../packages/schema/fields.js';
import { generateCityPool } from './sim-generate.js';
import { RateLimiter } from './ratelimit.js';
import { createCaptcha } from './captcha.js';


const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createApp({ root, dataDir, configPath, onCaptcha }) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const { key, source: keySource } = loadKey(join(dataDir, '.dev-key'));
  const store = new FileStore(dataDir, key);
  store.tokenTtlDays = Number(config.privacy?.tokenTtlDays ?? 90);
  // 测试环境：界面上不标“虚拟”；正式环境（testMode=false）虚拟人选标“虚拟”
  const testMode = config.testMode === true;
  // 每组看几位：所有人都一样（docs/DECISIONS.md）
  const limits = config.limits;
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
  // 解密全部用户很慢：按存储的版本号缓存，有人保存或删除时自动失效
  let poolCache = { version: -1, list: [] };
  function realPeople() {
    if (poolCache.version !== store.version) {
      const list = store.listUserIds().map((id) => store.getUser(id)).filter((u) => {
        const c = latestConsent(u);
        return u && c?.pool && c?.scoring && u.gender && u.requirements.length >= 1;
      });
      poolCache = { version: store.version, list };
    }
    return poolCache.list;
  }
  function buildPool(cityName) {
    return [...realPeople(), ...virtualFor(cityName)];
  }

  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  // ---------- 限流（按 IP 或账户计次，见 docs/SECURITY.md）----------
  const limiter = new RateLimiter();
  const LIM = { recover: [10, 3600e3], captcha: [60, 3600e3], session: [30, 3600e3], results: [60, 3600e3], saves: [300, 3600e3], adminFail: [10, 3600e3], ...(config.rateLimits || {}) };
  // 部署在 Caddy 后面时（TRUST_PROXY=1），真实 IP 在 X-Forwarded-For 第一段；否则直接取连接地址，防止伪造
  const trustProxy = process.env.TRUST_PROXY === '1';
  const clientIp = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  function limit(name, key, msg = '操作太频繁，请稍后再试') {
    const [max, win] = LIM[name];
    if (!limiter.hit(name + ':' + key, max, win)) throw new HttpError(429, msg);
  }
  setInterval(() => limiter.sweep(), 10 * 60e3).unref();
  // 图片验证码：过了验证才建账户（docs/AUTH.md）。onCaptcha 只有进程内的测试会传
  const captcha = createCaptcha({ onIssue: onCaptcha });
  setInterval(() => captcha.sweep(), 60e3).unref();
  // 同意记录：用于计算结果时必须确认已满 18 岁
  function makeConsent(body, prevAdult) {
    const adult = body.adult === true || prevAdult === true;
    if (body.scoring && !adult) throw new ValidationError('请先确认你已满 18 岁');
    return { version: config.privacy.consentVersion, at: new Date().toISOString(), adult, scoring: !!body.scoring, pool: !!body.pool, research: !!body.research };
  }

  // ---------- 管理后台（docs/ADMIN.md）----------
  // 正式环境必须设置 ADMIN_TOKEN；测试环境没设时口令是 admin。
  const brief = (p) => p && ({ id: p.id, virtual: !!p.simulated, gender: GENDERS[p.gender] || '', age: p.profile?.age ?? null, city: p.profile?.city ?? null, occupation: p.profile?.occupation ?? null });
  function adminOk(req) {
    const expected = process.env.ADMIN_TOKEN || (testMode ? 'admin' : '');
    const got = String(req.headers['x-admin-token'] || '');
    return !!expected && !!got && safeEqualHex(sha256(got), sha256(expected));
  }
  async function handleAdmin(req, res, path, method) {
    const ip = clientIp(req);
    if (limiter.count('adminFail:' + ip, LIM.adminFail[1]) >= LIM.adminFail[0]) return json(res, 429, { error: '口令错太多次，1 小时后再试' });
    if (!adminOk(req)) { limiter.hit('adminFail:' + ip, Infinity, LIM.adminFail[1]); store.audit('admin.auth_failed', null); return json(res, 401, { error: '管理员口令不对' }); }
    const body = ['POST', 'DELETE'].includes(method) ? await readBody(req) : {};
    if (path === '/api/admin/overview' && method === 'GET') {
      const users = store.listUserIds().map((id) => store.getUser(id)).filter(Boolean).map((u) => {
        const c = latestConsent(u), idn = store.getIdentity(u.id);
        return {
          ...brief(u), createdAt: u.createdAt, lastActiveAt: u.lastActiveAt,
          filled: !!u.gender && u.requirements.length > 0, pool: !!c?.pool, recovery: !!idn?.recovery,
        };
      }).sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt));
      return json(res, 200, { testMode, users });
    }
    const um = path.match(/^\/api\/admin\/users\/(u_[0-9a-f]{24})$/);
    // 单个用户的完整资料：所有字段都列出来（没填的标“未填写”），连同全部要求；每次查看都记审计日志
    if (um && method === 'GET') {
      const u = store.getUser(um[1]);
      if (!u) return json(res, 404, { error: '找不到这个用户' });
      const idn = store.getIdentity(u.id), c = latestConsent(u);
      store.audit('admin.user_viewed', u.id);
      const listed = new Set(FIELD_SECTIONS.flatMap(([, ks]) => ks));
      const rows = [...FIELD_SECTIONS.flatMap(([g, ks]) => ks.map((k) => [g, FIELD_MAP[k]])), ...FIELDS.filter((f) => !listed.has(f.key)).map((f) => ['其他', f])];
      const asked = new Map(u.requirements.map((r) => [r.field, formatRequirement(r)]));
      return json(res, 200, {
        ...brief(u), nickname: idn?.nickname || '', createdAt: u.createdAt, lastActiveAt: u.lastActiveAt,
        consent: c ? { scoring: !!c.scoring, pool: !!c.pool, adult: !!c.adult, at: c.at || null } : null, recovery: !!idn?.recovery,
        profile: rows.map(([group, f]) => ({ group, label: f.label, value: formatValue(f.key, u.profile?.[f.key], { full: true }), filled: !isUnknown(u.profile?.[f.key]) })),
        requirements: rows.map(([group, f]) => { const r = asked.get(f.key); return { group, label: f.label, text: r ? r.text : '未填写', importance: r ? r.importance : '', filled: !!r }; }),
      });
    }
    if (um && method === 'DELETE') {
      const id = um[1];
      if (!store.getUser(id)) return json(res, 404, { error: '找不到这个用户' });
      const reason = String(body.reason || '').trim().slice(0, 200);
      if (reason.length < 2) throw new ValidationError('请写明删除理由');
      store.deleteUser(id);
      store.audit('admin.user_deleted', id, { reason });
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };

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
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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
        fields: FIELDS, groups: GROUP_LABELS, limits, testMode, site: config.site || {},
        consentVersion: config.privacy.consentVersion, scorer: config.scorer.id,
      });
    }
    if (path === '/api/stats' && method === 'GET') {
      const s = stats(url.searchParams.get('field'));
      return s ? json(res, 200, s) : json(res, 400, { error: '只能查询基础字段的匿名分布' });
    }
    if (path === '/api/health' && method === 'GET') return json(res, 200, { ok: true });
    if (path === '/api/captcha' && method === 'GET') {
      limit('captcha', clientIp(req));
      return json(res, 200, captcha.issue());
    }
    // 过了验证码才建账户：资料、要求、同意记录一次存好；没过验证的人在服务器上不留任何记录
    if (path === '/api/session' && method === 'POST') {
      limit('session', clientIp(req));
      const body = await readBody(req);
      if (!body.captchaId || !body.answer) throw new HttpError(400, '请先输入验证码');
      if (!captcha.verify(body.captchaId, body.answer)) throw new HttpError(400, '验证码不对，换一张再试');
      // 先全部校验，再建账户：任何一项不对都不落盘
      const prof = validateProfile(body);
      const reqs = validateRequirements(body.requirements);
      const c = body.consent || {};
      if (!c.scoring) throw new ValidationError('需要先同意“用你的资料计算结果”');
      const consent = makeConsent(c);
      const { id, token } = store.createUser();
      try {
        store.saveProfile(id, prof);
        store.saveIdentity(id, { nickname: String(body.identity?.nickname || '').slice(0, 20) });
        store.saveRequirements(id, reqs);
        store.saveConsents(id, consent);
      } catch (e) { store.deleteUser(id); throw e; }
      return json(res, 201, { token: `${id}.${token}` });
    }
    // 用恢复码在另一台设备找回账户：发新令牌，旧设备上的令牌失效
    if (path === '/api/recover' && method === 'POST') {
      limit('recover', clientIp(req), '试得太多了，1 小时后再试');
      const body = await readBody(req);
      const id = store.findByRecoveryCode(String(body.code || ''));
      if (!id) throw new HttpError(400, '恢复码不对');
      return json(res, 200, { token: `${id}.${store.issueToken(id)}` });
    }

    if (path.startsWith('/api/admin/')) return await handleAdmin(req, res, path, method);
    const uid = auth(req);
    if (!uid) return json(res, 401, { error: '请先开始测试' });
    const body = ['PUT', 'POST'].includes(method) ? await readBody(req) : null;
    if (method === 'PUT') limit('saves', uid);

    if (path === '/api/me' && method === 'GET') {
      const u = store.getUser(uid);
      const idn = store.getIdentity(uid);
      return json(res, 200, { gender: u.gender, profile: u.profile, requirements: u.requirements, consent: latestConsent(u), identity: { nickname: idn?.nickname }, hasRecovery: !!idn?.recovery });
    }
    // 生成恢复码：明文只在这次返回，服务端只存带密钥的哈希；再生成一次，旧码作废
    if (path === '/api/me/recovery' && method === 'POST') {
      return json(res, 201, { code: store.newRecoveryCode(uid) });
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
      // 只服务成年人：同意时必须确认已满 18 岁（资料里的年龄也限定 18 岁起）
      const c = makeConsent(body, latestConsent(store.getUser(uid))?.adult);
      store.saveConsents(uid, c);
      return json(res, 200, { ok: true, consent: c });
    }
    if (path === '/api/me/results' && method === 'GET') {
      const u = store.getUser(uid);
      const c = latestConsent(u);
      if (!c?.scoring) return json(res, 403, { error: '需要先同意“用你的资料计算结果”' });
      if (!u.gender || !u.requirements.length) return json(res, 400, { error: '请先填写资料和理想型' });
      // 防扫描：反复改要求来遍历人选池（docs/PRIVACY.md）
      limit('results', uid, '看得太频繁了，过一会儿再来');
      const rel = computeRelations({ me: u, pool: buildPool(u.profile?.city), limits, scorerId: config.scorer.id, params: config.scorer.params });
      store.audit('results.computed', uid);
      return json(res, 200, presentRelations(key, u, rel, { hideVirtual: testMode }));
    }
    if (path === '/api/me/export' && method === 'GET') {
      const u = store.getUser(uid);
      store.audit('data.exported', uid);
      const { recovery, ...identity } = store.getIdentity(uid) || {};
      return json(res, 200, { exportedAt: new Date().toISOString(), account: u, identity });
    }
    if (path === '/api/me' && method === 'DELETE') {
      store.deleteUser(uid);
      return json(res, 200, { ok: true, deleted: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (e instanceof ValidationError) return json(res, 400, { error: e.message });
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      console.error(e);
      json(res, 500, { error: '服务器错误' });
    });
  });
  return { server, store, config, keySource };
}
