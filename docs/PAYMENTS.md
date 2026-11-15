# 扫码支付（微信支付 / 支付宝）

用户在结果页点“扫码升级”，弹窗显示二维码，用手机微信或支付宝扫码付款。支付完成后自动升级为 VIP，每组从 3 位增加到 5 位。

## 现在的状态

- 接口、订单、弹窗、支付成功后自动升级已经完成，可以完整走通。
- `config/app.json` 里 `payments.mode` 为 `mock`（模拟支付）：二维码只是演示内容，弹窗里有“模拟支付成功”按钮，不会真的扣款。
- 微信支付（Native 支付）和支付宝（当面付）的签名、验签、通知解密已经按官方文档写好，在 `server/src/payments/`，**尚未用真实商户联调**。
- 价格：`plans.vip.priceFen`，单位是分，目前是 199（¥1.99）。
- VIP 目前是一次购买、长期有效。以后如果要按月，在订单里加有效期即可。

## 流程

```
浏览器                           服务端                               微信 / 支付宝
点“扫码升级” ──POST /api/me/orders──▶ 生成订单号，向渠道下单 ─────────▶ 返回二维码内容
弹窗显示二维码 ◀──── codeUrl ──────
用户扫码付款 ───────────────────────────────────────────────────────▶
                                   POST /api/payments/notify/<渠道> ◀── 支付结果通知（带签名）
                                   验签 → 核对金额 → 订单已付 → 升级 VIP
每 2 秒查询订单 ─GET /api/me/orders/<订单号>─▶ 已付？（若仍待付，主动向渠道查单兜底）
显示“支付成功”，刷新结果
```

## 你需要准备什么

这两项都要求**企业或个体工商户**主体，个人身份通常无法开通。

### 微信支付

1. 在 [微信支付商户平台](https://pay.weixin.qq.com) 申请商户号，开通 **Native 支付**。
2. 准备一个与商户号绑定的 AppID（服务号或小程序）。
3. 在商户平台下载商户 API 证书，设置 APIv3 密钥，下载微信支付公钥。
4. 填写以下环境变量：

| 变量 | 内容 |
|---|---|
| `WECHAT_PAY_APP_ID` | 绑定的 AppID |
| `WECHAT_PAY_MCH_ID` | 商户号 |
| `WECHAT_PAY_SERIAL_NO` | 商户 API 证书序列号 |
| `WECHAT_PAY_PRIVATE_KEY_PATH` | `apiclient_key.pem` 的路径 |
| `WECHAT_PAY_API_V3_KEY` | APIv3 密钥 |
| `WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH` | 微信支付公钥的路径 |

### 支付宝

1. 在 [支付宝开放平台](https://open.alipay.com) 创建网页/移动应用，签约 **当面付**。
2. 生成应用 RSA2 密钥，上传应用公钥，拿到支付宝公钥。
3. 建议先用沙箱环境测试。
4. 填写以下环境变量：

| 变量 | 内容 |
|---|---|
| `ALIPAY_APP_ID` | 应用 AppID |
| `ALIPAY_PRIVATE_KEY_PATH` | 应用私钥（PKCS8 PEM）路径 |
| `ALIPAY_PUBLIC_KEY_PATH` | 支付宝公钥路径 |
| `ALIPAY_GATEWAY` | 可选；沙箱填 `https://openapi-sandbox.dl.alipaydev.com/gateway.do` |

### 上线配置

在 `config/app.json` 里：

```json
"payments": {
  "mode": "live",
  "providers": ["wechat", "alipay"],
  "orderExpireMinutes": 15,
  "notifyBaseUrl": "https://你的域名"
}
```

- `notifyBaseUrl` 必须是公网可访问的 HTTPS 域名，并完成 ICP 备案；支付结果会通知到 `https://你的域名/api/payments/notify/wechat` 和 `/alipay`。
- 只配好一个渠道也可以，弹窗只会显示已配置的渠道。
- 上线前用真实账户各付一笔小额订单，确认能自动升级，再在商户后台退款。

## 安全要点

- 支付结果只认渠道的签名通知或主动查单，前端说“付了”不算数。
- 通知中的金额必须与订单金额一致，否则拒绝。
- 同一订单重复通知只处理一次。
- 订单不含个人资料；用户删除账户后，订单依法保留，但用户 id 替换成不可逆哈希。
- 私钥和密钥只放在服务器环境变量指向的文件里，不进 git。
