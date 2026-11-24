// 文件存储（开发与小规模试点用）。接口刻意保持简单，正式上线时换成数据库实现同样的方法即可。
//
// 目录结构（data/ 不进 git）
//   data/users/<id>.json   账户：性别方向、同意记录为明文；资料（L1+L2）与择偶要求整体加密
//   data/vault/<id>.json   L3 身份库：昵称、微信号、小红书号、抖音号，整体加密，与资料分开存放
//   data/audit.log         审计日志（JSON Lines），主体只记哈希，不记资料内容
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIELD_MAP } from '../../packages/schema/fields.js';
import { encryptJson, decryptJson, newId, newToken, sha256, safeEqualHex, auditSubject } from './crypto.js';

const ID_RE = /^u_[0-9a-f]{24}$/;

export class FileStore {
  constructor(dir, key) {
    this.dir = dir;
    this.key = key;
    this.version = 0; // 每次写入或删除加一，供上层缓存判断是否过期
    this.tokenTtlDays = 90; // 令牌多少天不用就失效；createApp 会按配置改
    for (const d of ['users', 'vault']) mkdirSync(join(dir, d), { recursive: true });
  }

  #userPath(id) { if (!ID_RE.test(id)) throw new Error('bad id'); return join(this.dir, 'users', id + '.json'); }
  #vaultPath(id) { if (!ID_RE.test(id)) throw new Error('bad id'); return join(this.dir, 'vault', id + '.json'); }

  #write(path, obj) {
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    renameSync(tmp, path);
    this.version++;
  }

  audit(action, id, extra = {}) {
    const line = { ts: new Date().toISOString(), action, subject: id ? auditSubject(this.key, id) : null, ...extra };
    appendFileSync(join(this.dir, 'audit.log'), JSON.stringify(line) + '\n', { mode: 0o600 });
  }

  createUser() {
    const id = newId();
    const token = newToken();
    const now = new Date().toISOString();
    this.#write(this.#userPath(id), {
      id, createdAt: now, lastActiveAt: now, tokenHash: sha256(token),
      gender: null, seeks: [], profile: null, requirements: null, consents: [],
    });
    this.#write(this.#vaultPath(id), { box: encryptJson(this.key, {}) });
    this.audit('user.created', id);
    return { id, token };
  }

  // 换设备后发新令牌；旧设备上的令牌失效
  issueToken(id) {
    const token = newToken();
    this.#mutate(id, (raw) => { raw.tokenHash = sha256(token); });
    this.audit('user.token_issued', id);
    return token;
  }
  authenticate(id, token) {
    if (!id || !token || !ID_RE.test(id)) return null;
    const p = this.#userPath(id);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    if (!safeEqualHex(raw.tokenHash, sha256(token))) return null;
    // 太久没用的令牌失效（滑动过期）：每天第一次使用时顺便刷新最近活跃时间
    const idle = Date.now() - Date.parse(raw.lastActiveAt);
    if (this.tokenTtlDays && idle > this.tokenTtlDays * 86400e3) return null;
    if (idle > 86400e3) this.#mutate(id, () => {});
    return id;
  }

  // 读出解密后的完整用户（只在服务端内部使用）
  getUser(id) {
    const p = this.#userPath(id);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return {
      id: raw.id, createdAt: raw.createdAt, lastActiveAt: raw.lastActiveAt,
      gender: raw.gender, seeks: raw.seeks, consents: raw.consents,
      profile: decryptJson(this.key, raw.profile) || {},
      requirements: decryptJson(this.key, raw.requirements) || [],
    };
  }

  #mutate(id, fn) {
    const p = this.#userPath(id);
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    fn(raw);
    raw.lastActiveAt = new Date().toISOString();
    this.#write(p, raw);
  }

  saveProfile(id, { gender, seeks, profile }) {
    // 数据最小化：注册表之外的字段一律丢弃。分级（L1/L2）决定对他人的展示粒度，落盘一律加密。
    const clean = Object.fromEntries(Object.entries(profile || {}).filter(([k]) => FIELD_MAP[k]));
    this.#mutate(id, (raw) => {
      raw.gender = gender; raw.seeks = seeks;
      raw.profile = encryptJson(this.key, clean);
    });
    this.audit('profile.saved', id, { fields: Object.keys(clean).length });
  }

  saveRequirements(id, requirements) {
    this.#mutate(id, (raw) => { raw.requirements = encryptJson(this.key, requirements); });
    this.audit('requirements.saved', id, { count: requirements.length });
  }

  saveConsents(id, consents) {
    this.#mutate(id, (raw) => { raw.consents.push(consents); });
    this.audit('consent.recorded', id, { version: consents.version, scoring: consents.scoring, pool: consents.pool, research: consents.research });
  }

  saveIdentity(id, identity) {
    this.#write(this.#vaultPath(id), { box: encryptJson(this.key, identity) });
    this.audit('identity.saved', id);
  }

  getIdentity(id) {
    const p = this.#vaultPath(id);
    return existsSync(p) ? decryptJson(this.key, JSON.parse(readFileSync(p, 'utf8')).box) : {};
  }

  // 彻底删除：资料、要求、同意记录与身份库一起删除；审计只留哈希化主体
  // 清空重填：资料、要求、同意记录清掉，身份库（号、昵称）保留，令牌作废
  resetUser(id) {
    this.#mutate(id, (raw) => { Object.assign(raw, { gender: null, seeks: [], profile: null, requirements: null, consents: [], tokenHash: '' }); });
    this.audit('user.reset', id);
  }

  deleteUser(id) {
    for (const p of [this.#userPath(id), this.#vaultPath(id)]) if (existsSync(p)) rmSync(p);
    this.version++;
    this.audit('user.deleted', id);
  }

  listUserIds() {
    return readdirSync(join(this.dir, 'users')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  }

  // 长期不活跃的账户按保留期删除（由 scripts/purge-inactive.mjs 定时调用）
  purgeInactive(days) {
    const cutoff = Date.now() - days * 86400000;
    let n = 0;
    for (const id of this.listUserIds()) {
      const raw = JSON.parse(readFileSync(this.#userPath(id), 'utf8'));
      if (Date.parse(raw.lastActiveAt) < cutoff) { this.deleteUser(id); n++; }
    }
    return n;
  }
}

export const latestConsent = (user) => user?.consents?.[user.consents.length - 1] || null;
