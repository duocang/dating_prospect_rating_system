# VIER 择偶坐标

帮用户看清三件事：**你想遇见的人是谁、他们自己在找什么样的人、谁的理想型恰好是你。** 分数只表示“条件拟合”，不是好感概率，也不是对人的价值评价。当前服务范围只包含异性恋用户。

## 运行

只需要 Node.js 18 以上，没有第三方依赖。

```bash
npm start          # 或 node server/server.mjs，然后打开 http://localhost:8787
npm run dev        # 开发用：server/、packages/、config/ 改动后自动重启；网页文件改了刷新浏览器即可
npm test           # 评分、关系引擎、接口、安全
```

本机默认是测试环境（`testMode: true`）：人选池是同意进入人选池的真人加上你所在城市的虚拟人选。

## 部署上线

上线用的是正式配置（`config/app.production.json`）：虚拟人选在卡片上标“虚拟”。备案号填在 `site.icp`，页脚自动显示。

**准备**：一台装好 Docker 的服务器，一个已解析到这台服务器的域名（大陆服务器需 ICP 备案）。

```bash
git clone <仓库地址> vier && cd vier
cp .env.example .env
docker compose up -d
```

第二步之后编辑 `.env`：`DOMAIN` 是你的域名，`VIER_DATA_KEY` 用 `openssl rand -base64 32` 生成，`ADMIN_TOKEN` 是后台口令。

打开 `https://你的域名` 就能用。HTTPS 证书由 Caddy 自动申请和续期；不活跃满一年的账户由服务每天自动清理。

**密钥**：另存一份，和备份分开放。**密钥丢了或换了，所有资料都打不开。** 没填密钥时，服务拒绝启动。

**更新**：`git pull && docker compose up -d --build`，用户数据不受影响。

**备份**：资料在 Docker 数据卷里，每天拷一份出来（拷出的是加密后的文件）：

```bash
docker compose cp app:/data ./backup-$(date +%F)
```

**看日志**：`docker compose logs -f app`

**现在的限制**：限流计数在内存里，只适合单进程；文件存储只适合试点规模；用户协议和隐私政策是大白话初稿，上线前请懂法的人看一遍。

## 目录

| 路径 | 内容 |
|---|---|
| `web/` | 新网页前端（关于你 → 理想型 → 同意 → 结果 → 人选详情 → 我的数据，每步独立页面） |
| `server/` | HTTP 服务、加密存储、同意、导出、删除、审计、对外展示的脱敏层、恢复码 |
| `packages/schema/` | 字段注册表：资料、要求、评分、隐私分级共用的唯一来源 |
| `packages/scoring/` | **可替换的评分模块**（当前 `fit-v1`），只通过接口被调用 |
| `packages/matching/` | 关系引擎：理想型人选、对方的理想型、你符合对方理想型的程度、在找你的人、双向相合 |
| `config/app.json` | 演示配置：人选池、每组人数、评分器、隐私参数 |
| `config/app.production.json` | 正式上线配置：`testMode: false`，其余同上 |
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
- [账户与恢复码](docs/AUTH.md)
- [关键决策与理由](docs/DECISIONS.md)
