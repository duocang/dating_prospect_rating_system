# 管理后台

地址：`/#/admin`。口令是服务器环境变量 `ADMIN_TOKEN`；测试环境（`testMode: true`）没设时为 `admin`，正式环境不设就进不去。口令用随机长串，例如 `ADMIN_TOKEN="$(openssl rand -base64 24)"`。同一 IP 一小时内错 10 次锁一小时，每次失败记 `admin.auth_failed`。登录后口令存在浏览器 localStorage，点“退出”清除，不要在公用电脑上登录。

## 能做什么

- 看所有账户：性别、年龄、城市、职业、最近活跃、是否在人选池、是否存了恢复码、资料是否填完。可按城市、职业、用户 id 搜索。
- **查看全部资料**：一个用户的所有资料字段和对另一半的所有要求（连同在意程度），按组列出，没填的显示“未填写”；金额显示具体数字，不分档。每次查看记 `admin.user_viewed`。
- **删除**：永久删除资料、要求、恢复码，必须写理由，审计日志记录 `admin.user_deleted`。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/overview` | 用户列表 |
| GET | `/api/admin/users/<id>` | 单个用户的全部资料和要求 |
| DELETE | `/api/admin/users/<id>` | 删除 `{ reason }` |

所有请求带请求头 `x-admin-token`。
