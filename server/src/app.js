// HTTP 服务：零依赖，Node 18+。所有打分都在服务端完成，浏览器永远拿不到人选池原始数据。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, normalize, sep } from 'node:path';
import { FileStore, latestConsent } from './store.js';
import { createHmac, randomBytes } from 'node:crypto';
import { loadKey, sha256, safeEqualHex } from './crypto.js';
import { validateProfile, validateRequirements, ValidationError, checkHandle, checkRecall, HANDLE_KINDS, RECALL_KEYS, recallAnswered } from './validate.js';
import { presentRelations, formatRequirement, formatValue, FIELD_SECTIONS } from './present.js';
import { namer } from './names.js';
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
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const virtualCache = new Map();
  function virtualFor(cityName) {
    const n = Number(config.virtualPerCity ?? 1000);
    const c = cityByName.get(cityName) || cityByName.get('上海');
    if (!n || !c) return [];
    if (!virtualCache.has(c.id)) virtualCache.set(c.id, generateCityPool({ cityId: c.id, cityName: c.name, count: n, occ: c.occ }));
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

  // ---------- 凭号进入 ----------
  // 同一个号连续答错 3 次，锁一天（存在内存里，重启清零）
  const FAIL_MAX = 3, FAIL_LOCK = 24 * 3600e3;
  const fails = new Map(), passes = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, f] of fails) if (f.until && f.until < now) fails.delete(k);
    for (const [k, t] of passes) if (t.exp < now) passes.delete(k);
  }, 10 * 60e3).unref();
  const locked = (lockKey) => (fails.get(lockKey)?.until || 0) > Date.now();
  const norm = (h) => String(h || '').trim().toLowerCase();
  function findByHandle(kind, h) {
    const want = norm(h);
    return want ? store.listUserIds().filter((id) => norm(store.getIdentity(id)?.[kind]) === want) : [];
  }
  function handleInput(body) {
    const kind = String(body?.kind || '');
    if (!HANDLE_KINDS[kind]) throw new HttpError(400, '选一下用哪个号');
    const handle = norm(body.handle);
    if (!handle || handle.length > 30) throw new HttpError(400, `请输入${HANDLE_KINDS[kind]}`);
    const lockKey = `${kind}:${handle}`;
    if (locked(lockKey)) throw new HttpError(429, '这个号答错太多次了，明天再试');
    return { kind, handle, lockKey, uid: findByHandle(kind, handle)[0] || null };
  }
  // 问哪 3 道：从 TA 答过的题里按密钥固定挑出，每次问的都一样
  function recallQuestions(u) {
    const answered = recallAnswered(u.profile);
    return answered.map((k) => [createHmac('sha256', key).update(`recall:${u.id}:${k}`).digest('hex'), k]).sort().slice(0, 3).map(([, k]) => k).sort((a, b) => RECALL_KEYS.indexOf(a) - RECALL_KEYS.indexOf(b));
  }
  // 管理员登记号：至少一个；同一个号不能给两个人
  function checkHandles(body, selfId) {
    const out = {};
    for (const k of Object.keys(HANDLE_KINDS)) {
      if (body[k] === undefined) continue;
      const h = checkHandle(k, body[k]);
      if (h && findByHandle(k, h).some((x) => x !== selfId)) throw new HttpError(409, `这个${HANDLE_KINDS[k]}已经登记给别人了`);
      out[k] = h;
    }
    return out;
  }
  // 年龄、身高差 1 也算对（年龄会长）
  const sameAnswer = (want, got) => (typeof want === 'number' ? Math.abs(Number(got) - want) <= 1 : want !== undefined && String(got ?? '') === String(want));
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
  const sectionRows = () => {
    const listed = new Set(FIELD_SECTIONS.flatMap(([, ks]) => ks));
    return [...FIELD_SECTIONS.flatMap(([g, ks]) => ks.map((k) => [g, FIELD_MAP[k]])), ...FIELDS.filter((f) => !listed.has(f.key)).map((f) => ['其他', f])];
  };
  // 后台用一个常驻的命名器：同一个人始终同名，名字够用时互不重名（总览和详情一致）
  const adminNamer = namer(key, 'admin');
  const nameOf = (p, idn) => idn?.nickname || adminNamer(p);
  function findPerson(id) {
    if (id.startsWith('u_')) return store.getUser(id);
    const c = cityById.get(id.split('-SIM-')[0]);
    return c ? virtualFor(c.name).find((p) => p.id === id) : null;
  }
  function adminRow(p, idn) {
    const c = p.simulated ? null : latestConsent(p);
    const facts = {};
    for (const [, f] of sectionRows()) facts[f.key] = isUnknown(p.profile?.[f.key]) ? '' : formatValue(f.key, p.profile[f.key], { full: true });
    return { ...brief(p), name: nameOf(p, idn), wechat: idn?.wechat || '', xhs: idn?.xhs || '', douyin: idn?.douyin || '', createdAt: p.createdAt || null, lastActiveAt: p.lastActiveAt || null,
      filled: !!p.gender && p.requirements.length > 0, pool: p.simulated ? true : !!c?.pool, reqCount: p.requirements.length, facts };
  }
  async function handleAdmin(req, res, path, method) {
    const ip = clientIp(req);
    if (limiter.count('adminFail:' + ip, LIM.adminFail[1]) >= LIM.adminFail[0]) return json(res, 429, { error: '口令错太多次，1 小时后再试' });
    if (!adminOk(req)) { limiter.hit('adminFail:' + ip, Infinity, LIM.adminFail[1]); store.audit('admin.auth_failed', null); return json(res, 401, { error: '管理员口令不对' }); }
    const body = ['POST', 'PUT', 'DELETE'].includes(method) ? await readBody(req) : {};
    // 总览：全部真人 + 一个城市的虚构人选（标“虚构”）。每人带全部字段，表格的“详细”模式直接用
    if (path === '/api/admin/overview' && method === 'GET') {
      const real = store.listUserIds().map((id) => store.getUser(id)).filter(Boolean);
      const qCity = new URL(req.url, 'http://x').searchParams.get('city');
      const city = cityByName.has(qCity) ? qCity : (real.find((u) => cityByName.has(u.profile?.city))?.profile.city || '上海');
      const people = [...real.map((u) => adminRow(u, store.getIdentity(u.id))), ...virtualFor(city).map((p) => adminRow(p))]
        .sort((a, b) => (a.virtual - b.virtual) || (Date.parse(b.lastActiveAt || 0) - Date.parse(a.lastActiveAt || 0)));
      return json(res, 200, { testMode, city, cities: cities.map((c) => c.name), fields: sectionRows().map(([g, f]) => ({ group: g, key: f.key, label: f.label })), people });
    }
    const um = path.match(/^\/api\/admin\/users\/(u_[0-9a-f]{24}|[A-Za-z0-9]+-SIM-\d+)$/);
    // 单个用户的完整资料：所有字段都列出来（没填的标“未填写”），连同全部要求；每次查看都记审计日志
    if (um && method === 'GET') {
      const u = findPerson(um[1]);
      if (!u) return json(res, 404, { error: '找不到这个用户' });
      const idn = u.simulated ? null : store.getIdentity(u.id), c = u.simulated ? null : latestConsent(u);
      if (!u.simulated) store.audit('admin.user_viewed', u.id);
      // 这个人的星空关系：和 TA 自己看到的结果同样计算（不受查看次数限制，也不改动 TA 的任何数据）
      const relations = u.gender && u.requirements.length ? presentRelations(key, u, computeRelations({ me: u, pool: buildPool(u.profile?.city), limits, scorerId: config.scorer.id, params: config.scorer.params }), { nameOf: (p) => nameOf(p, p.simulated ? null : store.getIdentity(p.id)) }) : null;
      const rows = sectionRows();
      const asked = new Map(u.requirements.map((r) => [r.field, formatRequirement(r)]));
      return json(res, 200, {
        ...brief(u), name: nameOf(u, idn), nickname: idn?.nickname || '', wechat: idn?.wechat || '', xhs: idn?.xhs || '', douyin: idn?.douyin || '', relations, createdAt: u.createdAt, lastActiveAt: u.lastActiveAt,
        consent: c ? { scoring: !!c.scoring, pool: !!c.pool, adult: !!c.adult, at: c.at || null } : null,
        profile: rows.map(([group, f]) => ({ group, label: f.label, value: formatValue(f.key, u.profile?.[f.key], { full: true }), filled: !isUnknown(u.profile?.[f.key]) })),
        requirements: rows.map(([group, f]) => { const r = asked.get(f.key); return { group, label: f.label, text: r ? r.text : '未填写', importance: r ? r.importance : '', filled: !!r }; }),
      });
    }
    // 新建用户：只登记号（微信号、小红书号、抖音号至少一个），资料由本人进来后填
    if (path === '/api/admin/users' && method === 'POST') {
      const hs = checkHandles(body);
      if (!Object.values(hs).some(Boolean)) throw new ValidationError('微信号、小红书号、抖音号至少填一个');
      const { id } = store.createUser();
      store.saveIdentity(id, { nickname: String(body.nickname || '').trim().slice(0, 20), ...hs });
      store.audit('admin.user_created', id);
      return json(res, 201, { id });
    }
    // 改号：本人可以凭其中任何一个号进入
    const hm = path.match(/^\/api\/admin\/users\/(u_[0-9a-f]{24})\/(handles|reset)$/);
    if (hm && !store.getUser(hm[1])) return json(res, 404, { error: '找不到这个用户' });
    if (hm?.[2] === 'handles' && method === 'PUT') {
      const id = hm[1], next = { ...(store.getIdentity(id) || {}), ...checkHandles(body, id) };
      if (typeof body.nickname === 'string') next.nickname = body.nickname.trim().slice(0, 20);
      store.saveIdentity(id, next);
      store.audit('admin.handles_saved', id);
      return json(res, 200, { nickname: next.nickname || '', wechat: next.wechat || '', xhs: next.xhs || '', douyin: next.douyin || '' });
    }
    // 清空重填：资料、要求、同意记录清掉，号保留，已登录的设备退出（被人冒填时用）
    if (hm?.[2] === 'reset' && method === 'POST') {
      store.resetUser(hm[1]);
      store.audit('admin.user_reset', hm[1]);
      return json(res, 200, { ok: true });
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
    // 进入：只有管理员登记过号的人能进（docs/AUTH.md）。先过验证码再查号，每查一次都要一张新验证码
    //   还没填过的账户 → 直接发令牌，开始填写
    //   已经填过的账户 → 要答对 3 道 TA 自己填过的题，才发令牌
    if (path === '/api/start' && method === 'POST') {
      limit('session', clientIp(req));
      const body = await readBody(req), h = handleInput(body);
      if (!body.captchaId || !body.answer) throw new HttpError(400, '请先输入验证码');
      if (!captcha.verify(body.captchaId, body.answer)) throw new HttpError(400, '验证码不对，换一张再试');
      const u = h.uid && store.getUser(h.uid);
      if (!u) throw new HttpError(404, `这个${HANDLE_KINDS[h.kind]}还没登记，请联系我们`);
      if (!u.gender) {
        store.audit('user.started', u.id);
        return json(res, 200, { token: `${u.id}.${store.issueToken(u.id)}` });
      }
      const questions = recallQuestions(u);
      if (!questions.length) throw new HttpError(403, '这个账户没法自己进入，请联系我们');
      const pass = randomBytes(18).toString('base64url');
      passes.set(pass, { uid: u.id, lockKey: h.lockKey, questions, exp: Date.now() + 10 * 60e3 });
      return json(res, 200, { questions, pass });
    }
    if (path === '/api/start/answer' && method === 'POST') {
      limit('recover', clientIp(req), '试得太多了，1 小时后再试');
      const body = await readBody(req), p = passes.get(String(body.pass || ''));
      if (!p || p.exp < Date.now()) throw new HttpError(400, '时间太久了，请重新输入你的号');
      if (locked(p.lockKey)) { passes.delete(body.pass); throw new HttpError(429, '这个号答错太多次了，明天再试'); }
      const ans = body.answers || {}, prof = store.getUser(p.uid)?.profile || {};
      if (!p.questions.every((k) => sameAnswer(prof[k], ans[k]))) {
        const f = fails.get(p.lockKey) || { n: 0, until: 0 };
        f.n++;
        if (f.n >= FAIL_MAX) { f.n = 0; f.until = Date.now() + FAIL_LOCK; passes.delete(body.pass); }
        fails.set(p.lockKey, f);
        throw new HttpError(f.until > Date.now() ? 429 : 400, f.until > Date.now() ? '答错 3 次了，这个号明天才能再试' : `答案不对，还能试 ${FAIL_MAX - f.n} 次`);
      }
      fails.delete(p.lockKey); passes.delete(body.pass);
      store.audit('user.returned', p.uid);
      return json(res, 200, { token: `${p.uid}.${store.issueToken(p.uid)}` });
    }

    if (path.startsWith('/api/admin/')) return await handleAdmin(req, res, path, method);
    const uid = auth(req);
    if (!uid) return json(res, 401, { error: '请先开始测试' });
    const body = ['PUT', 'POST'].includes(method) ? await readBody(req) : null;
    if (method === 'PUT') limit('saves', uid);

    if (path === '/api/me' && method === 'GET') {
      const u = store.getUser(uid);
      const idn = store.getIdentity(uid);
      return json(res, 200, { gender: u.gender, profile: u.profile, requirements: u.requirements, consent: latestConsent(u), identity: { nickname: idn?.nickname, wechat: idn?.wechat || '', xhs: idn?.xhs || '', douyin: idn?.douyin || '' } });
    }
    if (path === '/api/me/profile' && method === 'PUT') {
      const prof = validateProfile(body);
      // 改资料时不能把“介绍自己”答过的题删到 3 道以下（早期账户不够 3 道的，只要不比原来少就行）
      if (recallAnswered(prof.profile).length < recallAnswered(store.getUser(uid)?.profile).length) checkRecall(prof.profile);
      store.saveProfile(uid, prof);
      if (body.identity) {
        const cur = store.getIdentity(uid) || {};
        // 号由管理员登记，本人这里只能改昵称
        if (typeof body.identity.nickname === 'string') store.saveIdentity(uid, { ...cur, nickname: body.identity.nickname.slice(0, 20) });
      }
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
      if (c.scoring) checkRecall(store.getUser(uid).profile);
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
      const identity = store.getIdentity(uid) || {};
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
