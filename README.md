# VIER 择偶坐标

帮用户看清三件事：**你想遇见的人是谁、他们自己在找什么样的人、谁的理想型恰好是你。** 分数只表示“条件拟合”，不是好感概率，也不是对人的价值评价。当前服务范围只包含异性恋用户。

## 运行

只需要 Node.js 18 以上，没有第三方依赖。

```bash
npm start          # 或 node server/server.mjs，然后打开 http://localhost:8787
npm test           # 评分、关系引擎、接口、隐私与支付共 24 项测试
```

默认是演示模式：结果里是 500 个模拟档案，顶部一直提示“演示模式”，支付也是模拟的。

## 部署上线

上线用的是正式配置（`config/app.production.json`）：结果里只有同意“让别人也能找到我”的真人，“演示模式”提示和 VIP 入口自动消失。提示不能单独去掉，否则用户会把模拟档案当成真人。刚上线时人选库是空的，结果页会提示“过几天再来看看”。

**准备**：一台装好 Docker 的服务器，一个已解析到这台服务器的域名（大陆服务器需 ICP 备案）。

```bash
git clone <仓库地址> vier && cd vier
cp .env.example .env
docker compose up -d
```

第二步之后编辑 `.env`，填两项：`DOMAIN` 是你的域名，`VIER_DATA_KEY` 用 `openssl rand -base64 32` 生成。

打开 `https://你的域名` 就能用。HTTPS 证书由 Caddy 自动申请和续期；不活跃满一年的账户由服务每天自动清理。

**密钥**：另存一份，和备份分开放。**密钥丢了或换了，所有资料都打不开。** 没填密钥或仍用模拟支付时，服务拒绝启动。

**更新**：`git pull && docker compose up -d --build`，用户数据不受影响。

**备份**：资料在 Docker 数据卷里，每天拷一份出来（拷出的是加密后的文件）：

```bash
docker compose cp app:/data ./backup-$(date +%F)
```

**看日志**：`docker compose logs -f app`

**打开 VIP**：按 [扫码支付接入](docs/PAYMENTS.md) 配好商户，把 `config/app.production.json` 里的 `payments.mode` 从 `off` 改成 `live`，再运行更新命令。

**现在的限制**：没有登录（换手机或清缓存就找不回资料）；没有限流；文件存储只适合试点规模；收集收入和家庭信息前，建议请人看一下隐私条款（见 [隐私与数据保护](docs/PRIVACY.md)）。

## 目录

| 路径 | 内容 |
|---|---|
| `web/` | 新网页前端（关于你 → 理想型 → 同意 → 结果 → 人选详情 → 我的数据，每步独立页面） |
| `server/` | HTTP 服务、加密存储、同意、导出、删除、审计、对外展示的脱敏层、扫码支付 |
| `packages/schema/` | 字段注册表：资料、要求、评分、隐私分级共用的唯一来源 |
| `packages/scoring/` | **可替换的评分模块**（当前 `fit-v1`），只通过接口被调用 |
| `packages/matching/` | 关系引擎：理想型人选、对方的理想型、你符合对方理想型的程度、在找你的人、双向相合 |
| `config/app.json` | 演示配置：人选池、免费/VIP 数量、评分器、隐私参数、支付模式 |
| `config/app.production.json` | 正式上线配置：真人人选池、关闭支付，其余同上 |
| `scripts/` | 生成模拟人选池、清理长期不活跃账户 |
| `docs/` | 架构、命名、评分、隐私、决策记录 |
| `archive/2026-11-15-pure-web/` | 旧的纯网页版本、模拟库、宣传图与研究资料，原样保留 |
| `data/` | 本机运行时数据（不进 git） |
| `Dockerfile`、`docker-compose.yml` | 部署：一条命令启动服务和 HTTPS |

## 文档

- [架构](docs/ARCHITECTURE.md)
- [新命名（取代 A/B/C/D）](docs/NAMING.md)
- [评分算法 fit-v1 与替换方法](docs/SCORING.md)
- [隐私与数据保护](docs/PRIVACY.md)
- [扫码支付接入](docs/PAYMENTS.md)
- [关键决策与理由](docs/DECISIONS.md)
