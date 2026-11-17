# 管理后台

地址：`/#/admin`。口令是服务器环境变量 `ADMIN_TOKEN`；测试环境（`testMode: true`）没设时为 `admin`，正式环境不设就进不去。

## 能做什么

| 页签 | 内容 |
|---|---|
| 用户 | 所有账户：性别、年龄、城市、职业、最近活跃、是否在人选池、是否愿意被牵线、VIP、发出/收到/被屏蔽次数 |
| 带号码的 | 只看留了号码的用户 |
| 牵线记录 | 所有请求：发起方、接收方、状态、时间 |

操作：

- **查看号码**：默认打码（139****5678）。查看完整号码必须写理由，审计日志记录 `admin.contact_revealed`、对象（哈希）、时间、理由。
- **暂停 / 恢复**：暂停后不出现在任何人的结果里，不能发起或接收牵线，等待中的请求作废。
- **删除**：永久删除资料、要求、号码、牵线记录，必须写理由。
- 仅测试环境：替虚拟人选同意或拒绝；让一位虚拟人选向某个真人发起牵线。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/overview` | 用户与牵线记录（号码打码） |
| POST | `/api/admin/users/<id>/reveal` | 查看完整号码 `{ reason }` |
| POST | `/api/admin/users/<id>/suspend` · `unsuspend` | 暂停 / 恢复 |
| DELETE | `/api/admin/users/<id>` | 删除 `{ reason }` |
| POST | `/api/admin/broker/requests/<id>/accept` · `decline` | 测试环境：替虚拟人回应 |
| POST | `/api/admin/broker/virtual-request` | 测试环境：让虚拟人发起 `{ to }` |

所有请求带请求头 `x-admin-token`。
