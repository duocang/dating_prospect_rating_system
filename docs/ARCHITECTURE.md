# 架构

```
浏览器 web/                       服务端 server/                         模块 packages/
┌───────────────┐   JSON API   ┌──────────────────────────┐   调用   ┌───────────────────┐
│ 关于你 / 理想型 │ ───────────▶ │ validate  输入校验与最小化 │          │ schema  字段注册表  │
│ 同意 / 结果     │              │ store     加密存储与审计   │          │ scoring 评分器接口  │
│ 人选详情 / 数据 │ ◀─────────── │ app       路由与人选池     │ ───────▶ │ matching 关系引擎   │
└───────────────┘   脱敏结果    │ present   对外展示脱敏层   │          └───────────────────┘
                               └──────────────────────────┘
```

## 原则

1. **评分可替换**：评分器只通过接口被调用，算法、参数与业务代码分开（见 SCORING.md）。
2. **字段只定义一次**：字段的类型、单位、选项、隐私分级、权重组都在 `packages/schema/fields.js`，表单、校验、评分、展示都从这里读。
3. **结果在服务端算**：人选池不出服务端；所有发往浏览器的人选信息都经过 `present.js`。
4. **零依赖**：Node 内置模块即可运行；之后换数据库或框架时，只替换 `server/` 内部实现。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config` | 字段注册表、套餐数量、人选池模式 |
| POST | `/api/session` | 创建匿名账户，返回令牌 |
| GET | `/api/me` | 自己的资料、理想型、同意、昵称 |
| PUT | `/api/me/profile` | 保存资料（可带昵称，存入身份库） |
| PUT | `/api/me/requirements` | 保存理想型 |
| PUT | `/api/me/consent` | 记录同意（三项） |
| GET | `/api/me/results` | 计算五组结果（需同意计算） |
| POST | `/api/me/orders` | 创建 VIP 订单，返回二维码内容（见 PAYMENTS.md） |
| GET | `/api/me/orders/<订单号>` | 查询订单状态，前端每 2 秒轮询 |
| POST | `/api/me/orders/<订单号>/mock-pay` | 模拟支付成功，仅 `payments.mode = mock` 时可用 |
| POST | `/api/payments/notify/<wechat\|alipay>` | 支付渠道的异步通知，验签后升级套餐 |
| GET | `/api/me/export` | 导出全部自己的资料 |
| DELETE | `/api/me` | 永久删除 |
| GET | `/api/stats?field=` | k-匿名分布，仅基础字段 |
| GET/PUT/POST/DELETE | `/api/me/broker…` | 牵线：联系方式、愿意被牵线、发起 / 同意 / 拒绝 / 取消 / 屏蔽（见 CONTACT-BROKER.md） |

## 配置（config/app.json）

- `poolMode`：默认 `real`，只用同意进入人选池的真人；`simulated` 用模拟人选池，只用于测试和演示。
- `plans`：`free` 每组 3 位，`vip` 每组 5 位（理想型人选、TA 心中的人选、在找你的人、双向相合分别可设）。
- `scorer`：评分器 id 和参数覆盖。
- `privacy`：同意版本、k 值、不活跃保留天数。
- `payments`：支付模式（`mock` 模拟、`live` 真实商户、`off` 关闭付费且不显示 VIP 入口）、启用的渠道、订单有效期、通知地址；`plans.*.priceFen` 是价格（分）。`NODE_ENV=production` 时不允许 `mock`。

环境变量：`PORT`、`VIER_DATA_DIR`、`VIER_CONFIG`、`VIER_DATA_KEY`（生产必填，32 字节 base64），`NODE_ENV=production`。

## 数据积累路线

1. **现在**：文件存储 + 模拟人选池，跑通问卷、同意和结果。
2. **试点（上海前 100 份）**：切 `poolMode: real`，换 PostgreSQL，加登录、限流、核验状态字段；评分仍用 fit-v1。
3. **积累到 500 份以上**：用真人档案和独立评价校准评分参数，注册 `fit-v2`，两版并行比较前几名的稳定性后再切换。
4. **长期**：互动信号（查看、标记）单独建模，不混进条件分；研究数据只按 k-匿名导出。

## 与旧版的关系

旧的纯网页、500 人模拟库、宣传图、抖音研究与各类计划文档都原样移到 `archive/2026-11-15-pure-web/`。新人选池由 `scripts/build-sim-pool.mjs` 从其中的 `profiles.json` 转换生成。
