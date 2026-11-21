# 管理后台

地址：`/#/admin`。口令是服务器环境变量 `ADMIN_TOKEN`；测试环境（`testMode: true`）没设时为 `admin`，正式环境不设就进不去。

## 能做什么

- 看所有账户：性别、年龄、城市、职业、最近活跃、是否在人选池、是否存了恢复码、资料是否填完。可按城市、职业、用户 id 搜索。
- **删除**：永久删除资料、要求、恢复码，必须写理由，审计日志记录 `admin.user_deleted`。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/overview` | 用户列表 |
| DELETE | `/api/admin/users/<id>` | 删除 `{ reason }` |

所有请求带请求头 `x-admin-token`。
