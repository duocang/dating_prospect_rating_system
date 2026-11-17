// 牵线：甲看中乙 → 乙看到甲的极简信息并自己决定 → 乙同意后，甲的联系方式发给乙一次。
// 规则见 docs/CONTACT-BROKER.md。这里只管状态和存储，HTTP 路由在 app.js。
//
//   data/contacts/<id>.json  联系方式（L3），整体加密；不进入人选池、评分和结果
//   data/broker.json         请求、“愿意被牵线”开关、屏蔽，整体加密
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { encryptJson, decryptJson } from './crypto.js';
import { ValidationError } from './validate.js';

const ID_RE = /^u_[0-9a-f]{24}$/;
const REQ_RE = /^r_[0-9a-f]{16}$/;
const HOUR = 3600 * 1000, DAY = 24 * HOUR;

export const BROKER_DEFAULTS = { expireDays: 7, cancelCooldownHours: 1, notAgreedCooldownDays: 7 };

// 对甲来说，拒绝、过期、乙关闭牵线、乙退出人选池都是同一句话，分辨不出原因
const NOT_AGREED = new Set(['declined', 'expired', 'withdrawn']);

export class BrokerError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const CONTACT_RULES = {
  phone: { re: /^1[3-9]\d{9}$/, hint: '请填 11 位手机号' },
  wechat: { re: /^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/, hint: '微信号是 6 到 20 位，字母开头，可以有数字、下划线和减号' },
};

export function validateContact(body) {
  const type = body?.type;
  const rule = CONTACT_RULES[type];
  if (!rule) throw new ValidationError('请选择手机号或微信号');
  const value = String(body.value ?? '').replace(/\s+/g, '');
  if (!rule.re.test(value)) throw new ValidationError(rule.hint);
  return { type, value };
}

// 极简信息里的年龄只给 5 岁一段
export const ageBand = (age) => {
  if (typeof age !== 'number' || !Number.isFinite(age)) return null;
  const lo = Math.floor(age / 5) * 5;
  return `${lo}–${lo + 4} 岁`;
};

export class Broker {
  constructor({ dataDir, key, config = {}, audit = () => {} }) {
    this.dir = dataDir;
    this.key = key;
    this.cfg = { ...BROKER_DEFAULTS, ...config };
    this.audit = audit;
    this.statePath = join(dataDir, 'broker.json');
    mkdirSync(join(dataDir, 'contacts'), { recursive: true });
  }

  // ---------- 存储 ----------
  #write(path, obj) {
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    renameSync(tmp, path);
  }

  #contactPath(id) { if (!ID_RE.test(id)) throw new Error('bad id'); return join(this.dir, 'contacts', id + '.json'); }

  #load() {
    const s = existsSync(this.statePath) ? decryptJson(this.key, JSON.parse(readFileSync(this.statePath, 'utf8')).box) : null;
    const state = { requests: [], willing: {}, blocks: [], ...s };
    // 过期：等待超过 expireDays 的请求作废，甲看到“对方暂未同意”
    const now = Date.now();
    let changed = false;
    for (const r of state.requests) {
      if (r.status === 'pending' && now - Date.parse(r.createdAt) > this.cfg.expireDays * DAY) {
        Object.assign(r, { status: 'expired', closedAt: new Date(now).toISOString() });
        changed = true;
      }
    }
    if (changed) this.#save(state);
    return state;
  }

  #save(state) { this.#write(this.statePath, { box: encryptJson(this.key, state) }); }

  #mutate(fn) { const s = this.#load(); const out = fn(s); this.#save(s); return out; }

  // ---------- 联系方式 ----------
  getContact(id) {
    const p = this.#contactPath(id);
    return existsSync(p) ? decryptJson(this.key, JSON.parse(readFileSync(p, 'utf8')).box) : null;
  }

  saveContact(id, contact) {
    const c = { ...validateContact(contact), savedAt: new Date().toISOString() };
    this.#write(this.#contactPath(id), { box: encryptJson(this.key, c) });
    this.audit('broker.contact_saved', id, { type: c.type });
    return c;
  }

  // 删除联系方式：自己还在等待的请求撤回；已经发给对方的不可撤回
  deleteContact(id) {
    const p = this.#contactPath(id);
    if (existsSync(p)) rmSync(p);
    const now = new Date().toISOString();
    const n = this.#mutate((s) => {
      let k = 0;
      for (const r of s.requests) if (r.from === id && r.status === 'pending') { Object.assign(r, { status: 'cancelled', closedAt: now, by: 'contact_deleted' }); k++; }
      return k;
    });
    this.audit('broker.contact_deleted', id, { withdrawn: n });
  }

  // ---------- 愿意被牵线 ----------
  isWilling(id) { return !!this.#load().willing[id]; }

  // 关闭时，别人发给你、还在等待的请求作废（甲看到“对方暂未同意”）
  setWilling(id, willing, { inPool }) {
    if (willing && !inPool) throw new BrokerError(400, '先打开“让别人也能找到我”，才能打开牵线');
    const now = new Date().toISOString();
    const n = this.#mutate((s) => {
      if (willing) { s.willing[id] = true; return 0; }
      delete s.willing[id];
      let k = 0;
      for (const r of s.requests) if (r.to === id && r.status === 'pending') { Object.assign(r, { status: 'withdrawn', closedAt: now }); k++; }
      return k;
    });
    this.audit(willing ? 'broker.willing_on' : 'broker.willing_off', id, { withdrawn: n });
  }

  // ---------- 卡片状态（结果页用） ----------
  // ctx：{ simulated, gateOk } —— gateOk 表示双方的“必须有”都通过
  cardState(viewerId, personId, { simulated, gateOk }, state = this.#load()) {
    if (simulated) return { state: 'demo' };
    const mine = state.requests.filter((r) => r.from === viewerId && r.to === personId);
    const live = mine.find((r) => r.status === 'pending' || r.status === 'accepted');
    if (live) return { state: live.status, requestId: live.id };
    if (!state.willing[personId] || this.#blocked(state, personId, viewerId) || this.#blocked(state, viewerId, personId)) return { state: 'closed' };
    if (!gateOk) return { state: 'ineligible' };
    const until = this.#cooldownUntil(mine);
    if (until) return { state: 'cooldown', until };
    return { state: 'open' };
  }

  snapshot() { return this.#load(); }

  #blocked(state, by, target) { return state.blocks.some((b) => b.by === by && b.target === target); }

  #cooldownUntil(mine) {
    const last = mine.filter((r) => r.closedAt).sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt))[0];
    if (!last) return null;
    const wait = last.status === 'cancelled' ? this.cfg.cancelCooldownHours * HOUR : NOT_AGREED.has(last.status) ? this.cfg.notAgreedCooldownDays * DAY : 0;
    const until = Date.parse(last.closedAt) + wait;
    return until > Date.now() ? new Date(until).toISOString() : null;
  }

  // ---------- 请求 ----------
  // 前置条件（对方在你的人选池里、双方必须有都通过、对方开放）由调用方先查好，这里再按状态把关
  createRequest({ from, to, minimal }) {
    if (!this.getContact(from)) throw new BrokerError(400, '先留下你的联系方式');
    const id = this.#mutate((s) => {
      if (!s.willing[to] || this.#blocked(s, to, from) || this.#blocked(s, from, to)) throw new BrokerError(403, '该用户暂未开放牵线');
      const mine = s.requests.filter((r) => r.from === from && r.to === to);
      if (mine.some((r) => r.status === 'pending')) throw new BrokerError(409, '已经发过了，等对方回应');
      if (mine.some((r) => r.status === 'accepted')) throw new BrokerError(409, '对方已经同意过，联系方式已发给对方');
      const until = this.#cooldownUntil(mine);
      if (until) throw new BrokerError(429, '暂时不能再次发起，请稍后再试', { until });
      const r = { id: 'r_' + randomBytes(8).toString('hex'), from, to, status: 'pending', minimal, createdAt: new Date().toISOString() };
      s.requests.push(r);
      return r.id;
    });
    this.audit('broker.requested', from, { request: id });
    return id;
  }

  #own(s, id, who, role) {
    const r = REQ_RE.test(id) ? s.requests.find((x) => x.id === id) : null;
    if (!r || r[role] !== who) throw new BrokerError(404, '找不到这个请求');
    return r;
  }

  cancel(uid, id) {
    this.#mutate((s) => {
      const r = this.#own(s, id, uid, 'from');
      if (r.status !== 'pending') throw new BrokerError(409, r.status === 'accepted' ? '对方已经同意，不能撤回了' : '这个请求已经结束');
      Object.assign(r, { status: 'cancelled', closedAt: new Date().toISOString(), by: 'initiator' });
    });
    this.audit('broker.cancelled', uid, { request: id });
  }

  // 乙同意：必须带 confirm，每一次都要本人确认；把甲的联系方式加密复制一份给乙
  accept(uid, id, { confirm }) {
    if (confirm !== true) throw new BrokerError(400, '请再确认一次');
    const contact = this.#mutate((s) => {
      const r = this.#own(s, id, uid, 'to');
      if (r.status !== 'pending') throw new BrokerError(409, '这个请求已经结束');
      const c = this.getContact(r.from);
      if (!c) { Object.assign(r, { status: 'cancelled', closedAt: new Date().toISOString(), by: 'contact_deleted' }); return null; }
      Object.assign(r, { status: 'accepted', acceptedAt: new Date().toISOString(), released: encryptJson(this.key, { type: c.type, value: c.value }) });
      return { type: c.type, value: c.value };
    });
    if (!contact) throw new BrokerError(409, '对方已经撤回了请求');
    this.audit('broker.accepted', uid, { request: id });
    return contact;
  }

  decline(uid, id) {
    this.#mutate((s) => {
      const r = this.#own(s, id, uid, 'to');
      if (r.status !== 'pending') throw new BrokerError(409, '这个请求已经结束');
      Object.assign(r, { status: 'declined', closedAt: new Date().toISOString() });
    });
    this.audit('broker.declined', uid, { request: id });
  }

  // 用后即隐藏：乙记下号码后，服务器上这份号码删除
  markSeen(uid, id) {
    this.#mutate((s) => {
      const r = this.#own(s, id, uid, 'to');
      if (r.status !== 'accepted') throw new BrokerError(409, '这个请求还没有同意');
      delete r.released;
      r.seenAt ||= new Date().toISOString();
    });
    this.audit('broker.contact_hidden', uid, { request: id });
  }

  // 屏蔽请求里的对方（单向）；等待中的请求随之结束
  block(uid, id) {
    this.#mutate((s) => {
      const r = s.requests.find((x) => x.id === id && (x.from === uid || x.to === uid));
      if (!REQ_RE.test(id) || !r) throw new BrokerError(404, '找不到这个请求');
      const other = r.from === uid ? r.to : r.from;
      if (!this.#blocked(s, uid, other)) s.blocks.push({ by: uid, target: other, at: new Date().toISOString() });
      if (r.status === 'pending') Object.assign(r, r.to === uid ? { status: 'declined' } : { status: 'cancelled', by: 'initiator' }, { closedAt: new Date().toISOString() });
      if (r.to === uid) delete r.released;
    });
    this.audit('broker.blocked', uid, { request: id });
  }

  // ---------- 给本人看的视图 ----------
  // aliasOf(otherId) 由调用方提供：同一个人在你眼里的代号，与结果页一致
  overview(uid, aliasOf) {
    const s = this.#load();
    const blockedByMe = (other) => this.#blocked(s, uid, other);
    const outgoing = s.requests.filter((r) => r.from === uid).map((r) => ({
      id: r.id,
      alias: aliasOf(r.to),
      status: r.status === 'pending' || r.status === 'accepted' || r.status === 'cancelled' ? r.status : 'not_agreed',
      createdAt: r.createdAt,
      blocked: blockedByMe(r.to),
    }));
    const incoming = s.requests.filter((r) => r.to === uid && (r.status === 'pending' || r.status === 'accepted') && !blockedByMe(r.from)).map((r) => ({
      id: r.id,
      alias: aliasOf(r.from),
      status: r.status,
      minimal: r.minimal,
      createdAt: r.createdAt,
      contact: r.status === 'accepted' && r.released ? decryptJson(this.key, r.released) : null,
      hidden: r.status === 'accepted' && !r.released,
    }));
    const newest = (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return {
      contact: this.getContact(uid),
      willing: !!s.willing[uid],
      incoming: incoming.sort(newest),
      outgoing: outgoing.sort(newest),
      cooldown: this.cfg,
    };
  }

  // 给首页和结果页的提示数字
  counts(uid) {
    const s = this.#load();
    return {
      incomingPending: s.requests.filter((r) => r.to === uid && r.status === 'pending' && !this.#blocked(s, uid, r.from)).length,
      contactsToRead: s.requests.filter((r) => r.to === uid && r.status === 'accepted' && r.released).length,
    };
  }

  // 本人导出：只含自己的联系方式、开关和自己发出的请求状态，不含对方信息
  exportFor(uid) {
    const s = this.#load();
    return {
      contact: this.getContact(uid),
      willing: !!s.willing[uid],
      sent: s.requests.filter((r) => r.from === uid).map((r) => ({ status: r.status, createdAt: r.createdAt })),
      received: s.requests.filter((r) => r.to === uid).map((r) => ({ status: r.status, createdAt: r.createdAt })),
    };
  }

  // 删除账户：联系方式、所有相关请求、双方的屏蔽记录一起删除
  purgeUser(uid) {
    const p = this.#contactPath(uid);
    if (existsSync(p)) rmSync(p);
    this.#mutate((s) => {
      s.requests = s.requests.filter((r) => r.from !== uid && r.to !== uid);
      s.blocks = s.blocks.filter((b) => b.by !== uid && b.target !== uid);
      delete s.willing[uid];
    });
  }
}
