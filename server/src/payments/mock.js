// 模拟渠道：不连任何支付机构。二维码内容是一段说明文字，页面上提供“模拟支付成功”按钮。
// 只在 config.payments.mode = "mock" 时启用。
export function mockProvider(id, label) {
  return {
    id,
    label,
    mock: true,
    isConfigured: () => true,
    async createOrder({ orderNo, amountFen }) {
      return { codeUrl: `VIER-MOCK-PAY:${id}:${orderNo}:${amountFen}` };
    },
    parseNotify() { throw new Error('模拟渠道没有异步通知'); },
    ackNotify: (ok) => ({ status: ok ? 200 : 400, contentType: 'text/plain', body: ok ? 'success' : 'fail' }),
    async queryOrder() { return null; },
  };
}
