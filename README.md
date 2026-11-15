# VIER 择偶坐标

帮用户看清三件事：**你想遇见的人是谁、他们自己在找什么样的人、谁的理想型恰好是你。** 分数只表示“条件拟合”，不是好感概率，也不是对人的价值评价。当前服务范围只包含异性恋用户。

## 运行

只需要 Node.js 18 以上，没有第三方依赖。

```bash
npm start          # 或 node server/server.mjs，然后打开 http://localhost:8787
npm test           # 评分、关系引擎、接口、隐私与支付共 23 项测试
```

默认是**模拟模式**：人选池是 archive 里上海 500 人模拟库转换来的档案，页面顶部会一直提示“全部是模拟档案”。切到真人模式见 `docs/ARCHITECTURE.md`。

## 目录

| 路径 | 内容 |
|---|---|
| `web/` | 新网页前端（关于你 → 理想型 → 同意 → 结果 → 人选详情 → 我的数据，每步独立页面） |
| `server/` | HTTP 服务、加密存储、同意、导出、删除、审计、对外展示的脱敏层、扫码支付 |
| `packages/schema/` | 字段注册表：资料、要求、评分、隐私分级共用的唯一来源 |
| `packages/scoring/` | **可替换的评分模块**（当前 `fit-v1`），只通过接口被调用 |
| `packages/matching/` | 关系引擎：理想型人选、TA 的理想型、你与 TA 理想型的契合度、在找你的人、双向相合 |
| `config/app.json` | 人选池模式、免费/VIP 数量、评分器与参数、隐私参数 |
| `scripts/` | 生成模拟人选池、清理长期不活跃账户 |
| `docs/` | 架构、命名、评分、隐私、决策记录 |
| `archive/2026-11-15-pure-web/` | 旧的纯网页版本、模拟库、宣传图与研究资料，原样保留 |
| `data/` | 运行时数据（不进 git） |

## 文档

- [架构](docs/ARCHITECTURE.md)
- [新命名（取代 A/B/C/D）](docs/NAMING.md)
- [评分算法 fit-v1 与替换方法](docs/SCORING.md)
- [隐私与数据保护](docs/PRIVACY.md)
- [扫码支付接入](docs/PAYMENTS.md)
- [关键决策与理由](docs/DECISIONS.md)
