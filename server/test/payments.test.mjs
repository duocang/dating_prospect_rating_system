import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { alipayProvider, signContent } from '../src/payments/alipay.js';
import { wechatProvider } from '../src/payments/wechat.js';
import { loadProviders } from '../src/payments/index.js';

const dir = mkdtempSync(join(tmpdir(), 'vier-pay-'));
const pem = () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { priv: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: publicKey.export({ type: 'spki', format: 'pem' }) };
};

test('未配置商户参数时不提供真实渠道；模拟模式提供两个入口', () => {
  assert.equal(wechatProvider().isConfigured(), false);
  assert.deepEqual(loadProviders({ payments: { mode: 'live', providers: ['wechat', 'alipay'] } }), []);
  assert.deepEqual(loadProviders({ payments: { mode: 'mock' } }).map((p) => p.id), ['wechat', 'alipay']);
});

test('支付宝通知：验签通过才解析，篡改金额会失败', () => {
  const k = pem();
  writeFileSync(join(dir, 'ali.pub'), k.pub);
  process.env.ALIPAY_APP_ID = '2021000000000000';
  process.env.ALIPAY_PRIVATE_KEY_PATH = join(dir, 'unused');
  process.env.ALIPAY_PUBLIC_KEY_PATH = join(dir, 'ali.pub');
  const params = { app_id: '2021000000000000', out_trade_no: 'V20261116000000ABCDEF12', trade_no: '2026111622001', trade_status: 'TRADE_SUCCESS', total_amount: '1.99', sign_type: 'RSA2' };
  const s = createSign('RSA-SHA256'); s.update(signContent(params), 'utf8');
  params.sign = s.sign(k.priv, 'base64');
  const p = alipayProvider();
  const n = p.parseNotify({ rawBody: new URLSearchParams(params).toString() });
  assert.deepEqual(n, { orderNo: 'V20261116000000ABCDEF12', paid: true, amountFen: 199, providerTradeNo: '2026111622001' });
  const forged = new URLSearchParams({ ...params, total_amount: '0.01' }).toString();
  assert.throws(() => p.parseNotify({ rawBody: forged }), /验签失败/);
  rmSync(dir, { recursive: true, force: true });
});
