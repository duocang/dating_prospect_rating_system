// 支付宝 · 当面付扫码（alipay.trade.precreate 生成二维码，用户用支付宝扫码付款）。
// 文档：https://opendocs.alipay.com/open/02ekfg
//
// 需要的环境变量（在支付宝开放平台创建应用并签约“当面付”后获取）：
//   ALIPAY_APP_ID               应用 AppID
//   ALIPAY_PRIVATE_KEY_PATH     应用私钥（PKCS8 PEM）路径
//   ALIPAY_PUBLIC_KEY_PATH      支付宝公钥（PEM）路径，用于验证异步通知
//   ALIPAY_GATEWAY              可选，默认正式网关；沙箱用 https://openapi-sandbox.dl.alipaydev.com/gateway.do
//
// 注意：本文件按官方文档实现了 RSA2 签名与验签，尚未用真实应用联调，上线前必须先在沙箱环境完成测试。
import { createSign, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const env = (k) => process.env[k] || '';

// 支付宝要求北京时间 yyyy-MM-dd HH:mm:ss
function beijingTime(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 19)}`;
}

export function signContent(params) {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export function alipayProvider() {
  const cfg = () => ({
    appId: env('ALIPAY_APP_ID'), keyPath: env('ALIPAY_PRIVATE_KEY_PATH'), alipayKeyPath: env('ALIPAY_PUBLIC_KEY_PATH'),
    gateway: env('ALIPAY_GATEWAY') || 'https://openapi.alipay.com/gateway.do',
  });

  async function call(method, biz, extra = {}) {
    const c = cfg();
    const params = {
      app_id: c.appId, method, format: 'JSON', charset: 'utf-8', sign_type: 'RSA2',
      timestamp: beijingTime(), version: '1.0', biz_content: JSON.stringify(biz), ...extra,
    };
    const s = createSign('RSA-SHA256');
    s.update(signContent(params), 'utf8');
    params.sign = s.sign(readFileSync(c.keyPath, 'utf8'), 'base64');
    const res = await fetch(c.gateway, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
    });
    const data = await res.json();
    const key = method.replace(/\./g, '_') + '_response';
    const r = data[key] || {};
    if (r.code !== '10000') throw new Error(`支付宝请求失败：${r.code || res.status} ${r.sub_msg || r.msg || ''}`);
    return r;
  }

  return {
    id: 'alipay',
    label: '支付宝',
    isConfigured() {
      const c = cfg();
      return !!(c.appId && c.keyPath && c.alipayKeyPath);
    },
    async createOrder({ orderNo, amountFen, subject, expireAt, notifyUrl }) {
      const minutes = Math.max(1, Math.round((expireAt - Date.now()) / 60000));
      const r = await call('alipay.trade.precreate', {
        out_trade_no: orderNo, total_amount: (amountFen / 100).toFixed(2), subject, timeout_express: `${minutes}m`,
      }, { notify_url: notifyUrl });
      return { codeUrl: r.qr_code };
    },
    parseNotify({ rawBody }) {
      const params = Object.fromEntries(new URLSearchParams(rawBody));
      const v = createVerify('RSA-SHA256');
      v.update(signContent(params), 'utf8');
      if (!v.verify(readFileSync(cfg().alipayKeyPath, 'utf8'), params.sign || '', 'base64')) throw new Error('支付宝通知验签失败');
      if (params.app_id !== cfg().appId) throw new Error('支付宝通知 app_id 不匹配');
      return {
        orderNo: params.out_trade_no,
        paid: params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED',
        amountFen: Math.round(Number(params.total_amount) * 100),
        providerTradeNo: params.trade_no,
      };
    },
    ackNotify: (ok) => ({ status: 200, contentType: 'text/plain', body: ok ? 'success' : 'fail' }),
    async queryOrder(orderNo) {
      const r = await call('alipay.trade.query', { out_trade_no: orderNo });
      return {
        paid: r.trade_status === 'TRADE_SUCCESS' || r.trade_status === 'TRADE_FINISHED',
        amountFen: Math.round(Number(r.total_amount) * 100),
        providerTradeNo: r.trade_no,
      };
    },
  };
}
