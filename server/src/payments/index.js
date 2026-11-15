// 支付接口。每个渠道实现同样的方法，服务端只通过这里调用，接入真实商户时不用改业务代码。
//
// 渠道接口
//   id, label
//   isConfigured()                                        是否已配置好商户参数
//   createOrder({ orderNo, amountFen, subject, expireAt, notifyUrl }) -> { codeUrl }
//                                                         codeUrl 是二维码内容，前端把它画成二维码让用户扫码
//   parseNotify({ headers, rawBody }) -> { orderNo, paid, amountFen, providerTradeNo }
//                                                         处理渠道的异步通知，必须先验签，验签失败要抛错
//   ackNotify(ok) -> { status, contentType, body }        渠道要求的回执格式
//   queryOrder(orderNo) -> { paid, amountFen, providerTradeNo } | null
//                                                         主动查单，通知丢失时兜底（可选）
import { mockProvider } from './mock.js';
import { wechatProvider } from './wechat.js';
import { alipayProvider } from './alipay.js';

export function loadProviders(config) {
  const all = [wechatProvider(), alipayProvider()];
  if (config.payments?.mode === 'mock') {
    // 模拟模式：微信和支付宝两个入口都由模拟渠道代替，可以完整走通扫码到升级的流程
    return [mockProvider('wechat', '微信支付（模拟）'), mockProvider('alipay', '支付宝（模拟）')];
  }
  return all.filter((p) => (config.payments?.providers || []).includes(p.id) && p.isConfigured());
}
