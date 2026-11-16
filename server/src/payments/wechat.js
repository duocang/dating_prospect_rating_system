// 微信支付 APIv3 · Native 支付（生成二维码，用户用微信扫码付款）。
// 文档：https://pay.weixin.qq.com/doc/v3/merchant/4012791874
//
// 需要的环境变量（申请商户号后在商户平台获取）：
//   WECHAT_PAY_APP_ID            与商户号绑定的公众号或小程序 AppID
//   WECHAT_PAY_MCH_ID            商户号
//   WECHAT_PAY_SERIAL_NO         商户 API 证书序列号
//   WECHAT_PAY_PRIVATE_KEY_PATH  商户 API 证书私钥 apiclient_key.pem 的路径
//   WECHAT_PAY_API_V3_KEY        APIv3 密钥（32 位），用于解密支付通知
//   WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH  微信支付公钥（或平台证书）路径，用于验证通知签名
//
// 注意：本文件按官方文档实现了签名、验签和解密，尚未用真实商户号联调，上线前必须在商户平台完成一次真实小额支付测试。
import { createSign, createVerify, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const HOST = 'https://api.mch.weixin.qq.com';
const env = (k) => process.env[k] || '';

export function wechatProvider() {
  const cfg = () => ({
    appId: env('WECHAT_PAY_APP_ID'), mchId: env('WECHAT_PAY_MCH_ID'), serialNo: env('WECHAT_PAY_SERIAL_NO'),
    keyPath: env('WECHAT_PAY_PRIVATE_KEY_PATH'), apiV3Key: env('WECHAT_PAY_API_V3_KEY'),
    platformKeyPath: env('WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH'),
  });

  function authorization(method, urlPath, body) {
    const c = cfg();
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const signer = createSign('RSA-SHA256');
    signer.update(`${method}\n${urlPath}\n${ts}\n${nonce}\n${body}\n`);
    const signature = signer.sign(readFileSync(c.keyPath, 'utf8'), 'base64');
    return `WECHATPAY2-SHA256-RSA2048 mchid="${c.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${ts}",serial_no="${c.serialNo}"`;
  }

  async function request(method, urlPath, payload) {
    const body = payload ? JSON.stringify(payload) : '';
    const res = await fetch(HOST + urlPath, {
      method,
      headers: { authorization: authorization(method, urlPath, body), accept: 'application/json', 'content-type': 'application/json' },
      body: payload ? body : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`微信支付请求失败：${data.code || res.status} ${data.message || ''}`);
    return data;
  }

  return {
    id: 'wechat',
    label: '微信支付',
    isConfigured() {
      const c = cfg();
      return !!(c.appId && c.mchId && c.serialNo && c.keyPath && c.apiV3Key && c.platformKeyPath);
    },
    async createOrder({ orderNo, amountFen, subject, expireAt, notifyUrl }) {
      const c = cfg();
      const data = await request('POST', '/v3/pay/transactions/native', {
        appid: c.appId, mchid: c.mchId, description: subject, out_trade_no: orderNo,
        time_expire: new Date(expireAt).toISOString().replace(/\.\d{3}Z$/, '+00:00'),
        notify_url: notifyUrl, amount: { total: amountFen, currency: 'CNY' },
      });
      return { codeUrl: data.code_url };
    },
    parseNotify({ headers, rawBody }) {
      const c = cfg();
      const ts = headers['wechatpay-timestamp'], nonce = headers['wechatpay-nonce'], sig = headers['wechatpay-signature'];
      if (!ts || !nonce || !sig) throw new Error('缺少微信支付签名头');
      if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new Error('通知时间戳过期');
      const v = createVerify('RSA-SHA256');
      v.update(`${ts}\n${nonce}\n${rawBody}\n`);
      if (!v.verify(readFileSync(c.platformKeyPath, 'utf8'), sig, 'base64')) throw new Error('微信支付通知验签失败');
      const { resource } = JSON.parse(rawBody);
      const buf = Buffer.from(resource.ciphertext, 'base64');
      const d = createDecipheriv('aes-256-gcm', Buffer.from(c.apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
      d.setAuthTag(buf.subarray(buf.length - 16));
      if (resource.associated_data) d.setAAD(Buffer.from(resource.associated_data, 'utf8'));
      const tx = JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8'));
      return { orderNo: tx.out_trade_no, paid: tx.trade_state === 'SUCCESS', amountFen: tx.amount?.total, providerTradeNo: tx.transaction_id };
    },
    ackNotify: (ok) => ok
      ? { status: 204, contentType: 'application/json', body: '' }
      : { status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'FAIL', message: '处理失败' }) },
    async queryOrder(orderNo) {
      const c = cfg();
      const tx = await request('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}?mchid=${c.mchId}`);
      return { paid: tx.trade_state === 'SUCCESS', amountFen: tx.amount?.total, providerTradeNo: tx.transaction_id };
    },
  };
}
