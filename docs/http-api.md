# HTTP API

## 通用约定

- Server：`http://localhost:3000`；Web 通过 `http://localhost:5173` 同源代理。
- 业务成功：`{"data":...}`；失败：`{"error":{"code","message","requestId"}}`。
- 身份只来自 `wepoker_session` HttpOnly/SameSite=Lax Cookie；生产 Cookie 同时为 Secure。
- 非安全方法要求 Origin 精确匹配 `CLIENT_ORIGIN`；不匹配返回 `ORIGIN_NOT_ALLOWED`，提示从启动终端显示的网址重新打开。输入使用严格 Zod Schema。
- 普通响应不包含密码 hash、Session token/hash、其他用户 Wallet、Snapshot、deck 或未授权私牌。所有 `/api` 响应都带 `Cache-Control: no-store, max-age=0`。

## Health 与 Readiness

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/health` | 进程可响应；不证明数据库、migration 或恢复完成 |
| GET | `/ready` | 数据库可用、34 个 migration 全部完成、启动恢复结束、未处于 shutdown 才返回 200 |

`/ready` 响应包含 `status/database/recoveryComplete/degradedRooms/activeRuntimes/timestamp`。恢复中的健康进程返回 503 starting；数据库不可用返回 503 unavailable；单个损坏 Snapshot 可让 `degradedRooms>0`，但其他房间恢复完成后整体仍可 ready。

## 认证与 Wallet

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | `phoneNumber/password/nickname`；事务创建 User、Wallet、INITIAL_GRANT 和 Session，服务端从内置头像库随机分配 `avatarId` |
| POST | `/api/auth/login` | `identifier/password`；公开 UI 只提交手机号，旧用户名仅供受控迁移兼容；Argon2id 验证并设置 Cookie |
| POST | `/api/auth/logout` | 撤销 Session、立即断开该 Session 的 Socket、清 Cookie；可重复 |
| GET | `/api/me` | 当前安全用户 DTO |
| GET | `/api/wallet` | 本人 balance/version |
| GET | `/api/wallet/ledger?limit=25&cursor=` | 本人分页流水，最多 100 条 |
| GET | `/api/profile` | 本人安全资料、Wallet 和已结算牌局统计 |
| PATCH | `/api/profile` | 更新本人 `nickname` 和/或内置 `avatarId`；至少提供一项，严格拒绝额外字段及上传内容 |
| POST | `/api/account/phone` | 旧账号携带 `phoneNumber/currentPassword/operationId` 一次绑定 |

无公开 Wallet 加减接口；坐下、补充牌桌点数和离桌只修改房间 GameSession/Table Stack，不触发 Wallet 流水。钻石变化只来自固定四类费用、初始发放或管理员受审计调整。

## 私人房间

| 方法 | 路径 | 权限/语义 |
| --- | --- | --- |
| POST | `/api/rooms` | 登录用户；要求高熵 `Idempotency-Key` header；创建者为 OWNER |
| POST | `/api/rooms/join` | 房间码/可选密码；限流且幂等 |
| GET | `/api/rooms` | 只列当前用户已加入的房间 |
| GET | `/api/rooms/closed?limit=&cursor=` | 本人未归档的 CLOSED 房间；稳定游标 |
| GET | `/api/rooms/:roomId` | 仅 RoomMember；安全成员资料与配置 |
| POST | `/api/rooms/:roomId/pause` | OWNER；只暂停下一手 |
| POST | `/api/rooms/:roomId/resume` | OWNER；恢复下一手 |
| POST | `/api/rooms/:roomId/close` | OWNER；统一结算在座与离座活动会话；活动手先进入 CLOSING 并等待 Review |
| POST | `/api/rooms/:roomId/archive` | OWNER 对 CLOSED 房间软归档；body 为 `operationId` |

`POST /api/rooms` 只接受 `bigBlind`，不接受客户端 `smallBlind`。`bigBlind` 必须为不小于 2 且严格低于普通/鱿鱼/暴击桌 `initialBuyIn` 或短牌桌 `minimumBuyIn` 的整数；服务器在边界解析后写入 `smallBlind = ceil(bigBlind/2)`。

pause/resume/close 在 Room/Snapshot 事务中提交，再通知同一桌 Runtime。`RECOVERY_ERROR` 或 `PERSISTENCE_ERROR` 牌桌拒绝会改变权威状态的房主命令；close 与 buy-in 通过 Room 行锁线性化。唯一例外是管理员对仍处于 `RECOVERY_ERROR` 的房间执行 CLOSE：在已备份前提下，服务器按关系型数据库最后持久化的会话后手废止未完成手牌并提交 CLOSED 快照，随后才允许管理员删除房间数据。

## 历史、回放与钻石看牌

| 方法 | 路径 | 权限/语义 |
| --- | --- | --- |
| GET | `/api/games?limit=&cursor=&roomId=&status=` | 只列本人 GameSession；稳定 keyset 游标 |
| GET | `/api/games/:gameSessionId` | 只读本人的对局详情和参与手牌 |
| GET | `/api/hands?limit=&cursor=&roomId=&result=&finishedFrom=&finishedTo=` | 只列本人参与手牌；按完成范围/结果筛选 |
| GET | `/api/hands/:handId` | 仅参与者；返回服务器已过滤的牌、事件和底池 |
| GET | `/api/hands/:handId/replay` | 仅参与者；返回确定性、隐私过滤的回放时间线 |
| POST | `/api/hands/:handId/paid-reveals` | 参与者结算后购买未公开对手牌；body 为 `operationId/targetUserId` |
| POST | `/api/hands/:handId/paid-hand-reveal` | Review 后一次购买整手隐藏牌；body 为 `operationId` |
| POST | `/api/hands/:handId/hypothetical-runout` | Review 后为 board<5 的完成手生成/读取模拟补牌；body 为 `operationId` |

分页游标绑定签发用户、端点类型与筛选条件；跨用户/跨筛选/跨端点游标返回 `INVALID_CURSOR`。不存在或无权访问的 hand/game 都使用 owner-scoped 404，避免暴露资源是否存在。隐藏牌在 DTO 中就是 `null`，不是由浏览器 CSS 隐藏。整手看牌在 30 天记录保留期内以 `(buyerUserId,handId)` 唯一，旧逐目标授权兼容；模拟补牌以 hand 唯一且不改变原历史。重复 operation 精确重放，改变 payload 返回 `IDEMPOTENCY_CONFLICT`。

完整手机号只存在认证输入/数据库内部。`/api/me`、Profile 和认证响应只返回 `hasPhoneNumber/phoneMasked`；Room、History、Wallet metadata 和错误不返回 `phoneNumber`。

## Table 为什么使用 Socket

订阅、选座、买入、sit-out、return、leave 和 action 需要 per-room queue、`stateVersion`、typed acknowledgement、按接收者私牌投影和实时广播，因此定义于 [Realtime Protocol](realtime-protocol.md)。HTTP 不提供进行中 Snapshot、私牌或恢复管理接口。

## Step 7 管理和请求安全

所有非安全方法要求精确 Origin 与 `X-Wepoker-Request: 1`；`/api/admin/*` 每次从有效、未撤销、未过期 Session 重新读取当前 ADMIN 角色。管理端点覆盖 dashboard、用户/搜索/详情、房间/活动桌、对局/完成 Hand、Ledger/四类钻石费用、AuditLog、Recovery/System。完整 Hand 审计仅允许已完成 Hand 并追加 `ADMIN_VIEW_FULL_HAND`；活动未来牌、Snapshot payload、Session、密码和完整手机号从不返回。
