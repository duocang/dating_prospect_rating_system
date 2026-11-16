// 订单：创建、查询、确认支付并升级套餐。确认支付是幂等的，金额不符的通知一律拒绝。
//   data/orders/<订单号>.json  订单只记录用户 id、套餐、金额、渠道和状态，不含个人资料
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const ORDER_RE = /^V\d{14}[0-9A-F]{8}$/;

export class OrderService {
  constructor({ dataDir, store, providers, config }) {
    this.dir = join(dataDir, 'orders');
    mkdirSync(this.dir, { recursive: true });
    this.store = store;
    this.providers = new Map(providers.map((p) => [p.id, p]));
    this.config = config;
  }

  provider(id) { return this.providers.get(id); }
  listProviders() { return [...this.providers.values()].map((p) => ({ id: p.id, label: p.label, mock: !!p.mock })); }

  #path(no) { if (!ORDER_RE.test(no)) throw new Error('订单号无效'); return join(this.dir, no + '.json'); }
  #save(o) { const p = this.#path(o.orderNo); writeFileSync(p + '.tmp', JSON.stringify(o), { mode: 0o600 }); renameSync(p + '.tmp', p); }
  get(no) { const p = this.#path(no); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; }

  newOrderNo() {
    const t = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace(/\D/g, '').slice(0, 14);
    return `V${t}${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  async create(userId, planId, providerId) {
    const plan = this.config.plans[planId];
    if (!plan || !(plan.priceFen > 0)) throw new Error('该套餐不能购买');
    const provider = this.provider(providerId);
    if (!provider) throw new Error('暂不支持该支付方式');
    const orderNo = this.newOrderNo();
    const expireAt = Date.now() + (this.config.payments.orderExpireMinutes || 15) * 60000;
    const notifyUrl = `${this.config.payments.notifyBaseUrl || ''}/api/payments/notify/${provider.id}`;
    const { codeUrl } = await provider.createOrder({ orderNo, amountFen: plan.priceFen, subject: `VIER ${plan.label}`, expireAt, notifyUrl });
    const order = { orderNo, userId, plan: planId, amountFen: plan.priceFen, provider: provider.id, status: 'pending', createdAt: new Date().toISOString(), expireAt, codeUrl };
    this.#save(order);
    this.store.audit('order.created', userId, { orderNo, plan: planId, provider: provider.id, amountFen: plan.priceFen });
    return order;
  }

  // 支付成功：核对金额，标记已付，升级套餐。重复通知直接返回已有结果。
  markPaid(orderNo, { amountFen, providerTradeNo }) {
    const o = this.get(orderNo);
    if (!o) throw new Error('订单不存在');
    if (o.status === 'paid') return o;
    if (Number(amountFen) !== o.amountFen) throw new Error('支付金额与订单不符');
    o.status = 'paid';
    o.paidAt = new Date().toISOString();
    o.providerTradeNo = providerTradeNo || null;
    this.#save(o);
    if (!o.userId.startsWith('deleted:') && this.store.getUser(o.userId)) this.store.setPlan(o.userId, o.plan);
    this.store.audit('order.paid', o.userId, { orderNo, plan: o.plan, provider: o.provider });
    return o;
  }

  // 用户删除账户时：交易记录依法需要保留，但把用户 id 换成不可逆的哈希，订单不再能关联到个人
  anonymizeUser(userId, hashFn) {
    for (const f of readdirSync(this.dir).filter((x) => x.endsWith('.json'))) {
      const o = JSON.parse(readFileSync(join(this.dir, f), 'utf8'));
      if (o.userId === userId) { o.userId = 'deleted:' + hashFn(userId); delete o.codeUrl; this.#save(o); }
    }
  }

  // 查询状态；仍待支付时向渠道主动查一次，兜底通知丢失
  async status(userId, orderNo) {
    let o = this.get(orderNo);
    if (!o || o.userId !== userId) return null;
    if (o.status === 'pending' && Date.now() > o.expireAt) { o.status = 'expired'; this.#save(o); }
    if (o.status === 'pending') {
      const p = this.provider(o.provider);
      const q = await p?.queryOrder(orderNo).catch(() => null);
      if (q?.paid) o = this.markPaid(orderNo, q);
    }
    return { orderNo: o.orderNo, status: o.status, plan: o.plan, amountFen: o.amountFen, expireAt: o.expireAt };
  }
}
