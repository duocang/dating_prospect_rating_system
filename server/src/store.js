// 文件存储（开发与小规模试点用）。接口刻意保持简单，正式上线时换成数据库实现同样的方法即可。
//
// 目录结构（data/ 不进 git）
//   data/users/<id>.json   账户：性别方向、同意记录为明文；资料（L1+L2）与择偶要求整体加密
//   data/vault/<id>.json   L3 身份库：昵称等，整体加密，与资料分开存放
//   data/audit.log         审计日志（JSON Lines），主体只记哈希，不记资料内容
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIELD_MAP } from '../../packages/schema/fields.js';
import { createHmac, randomInt } from 'node:crypto';
import { encryptJson, decryptJson, newId, newToken, sha256, safeEqualHex, auditSubject } from './crypto.js';

const ID_RE = /^u_[0-9a-f]{24}$/;

// 恢复码：12 位，去掉 0/O、1/I/L 这些容易看错的字符，显示成 XXXX-XXXX-XXXX；输入时不分大小写、不管横线空格
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const RECOVERY_LEN = 12;
export const normalizeRecoveryCode = (code) => String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
function makeRecoveryCode() {
  let s = '';
  for (let i = 0; i < RECOVERY_LEN; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return s.match(/.{4}/g).join('-');
}

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

  // ---------- 恢复码 ----------
  // 换设备找回用。索引只存带密钥的哈希 → 用户 id，明文只在生成时给用户看一次
  #recoveryKey(code) { return createHmac('sha256', this.key).update('recovery:' + normalizeRecoveryCode(code)).digest('hex'); }
  #recoveryIndexPath() { return join(this.dir, 'recovery-index.json'); }
  #recoveryIndex() { const p = this.#recoveryIndexPath(); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}; }
  newRecoveryCode(id) {
    const code = makeRecoveryCode();
    const idx = this.#recoveryIndex();
    // 一人只有一个有效恢复码：先删掉旧的
    for (const [k, v] of Object.entries(idx)) if (v === id) delete idx[k];
    idx[this.#recoveryKey(code)] = id;
    this.#write(this.#recoveryIndexPath(), idx);
    this.saveIdentity(id, { ...this.getIdentity(id), recovery: true });
    this.audit('recovery.created', id);
    return code;
  }
  findByRecoveryCode(code) {
    if (normalizeRecoveryCode(code).length !== RECOVERY_LEN) return null;
    const id = this.#recoveryIndex()[this.#recoveryKey(code)];
    return id && existsSync(this.#userPath(id)) ? id : null;
  }
  // 换设备后发新令牌；旧设备上的令牌失效
  issueToken(id) {
    const token = newToken();
    this.#mutate(id, (raw) => { raw.tokenHash = sha256(token); });
    this.audit('user.recovered', id);
    return token;
  }
  #dropRecovery(id) {
    const idx = this.#recoveryIndex();
    let changed = false;
    for (const [k, v] of Object.entries(idx)) if (v === id) { delete idx[k]; changed = true; }
    if (changed) this.#write(this.#recoveryIndexPath(), idx);
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
    // 改昵称时保留“已生成恢复码”的标记
    if (!identity.recovery && existsSync(this.#vaultPath(id))) { const cur = this.getIdentity(id); if (cur?.recovery) identity = { ...identity, recovery: true }; }
    this.#write(this.#vaultPath(id), { box: encryptJson(this.key, identity) });
    this.audit('identity.saved', id);
  }

  getIdentity(id) {
    const p = this.#vaultPath(id);
    return existsSync(p) ? decryptJson(this.key, JSON.parse(readFileSync(p, 'utf8')).box) : {};
  }

  // 彻底删除：资料、要求、同意记录与身份库一起删除；审计只留哈希化主体
  deleteUser(id) {
    this.#dropRecovery(id);
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

// 开了会话却一题没填、也没生成恢复码的空账户，几天后删掉，免得被人刷出大量空文件
FileStore.prototype.purgeEmpty = function purgeEmpty(days) {
  const cutoff = Date.now() - days * 86400000;
  let n = 0;
  for (const id of this.listUserIds()) {
    const u = this.getUser(id);
    if (u && !u.gender && Date.parse(u.lastActiveAt) < cutoff && !this.getIdentity(id)?.recovery) { this.deleteUser(id); n++; }
  }
  return n;
};

export const latestConsent = (user) => user?.consents?.[user.consents.length - 1] || null;
