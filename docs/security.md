# 安全与隐私

## 身份与浏览器边界

- Session token 是高熵随机值，只放 HttpOnly、SameSite=Lax Cookie；数据库只存 hash，Web 不存 localStorage。
- 生产 Cookie 为 Secure。非安全 HTTP 方法同时要求 Origin 精确等于 `CLIENT_ORIGIN` 和 `X-Wepoker-Request: 1`；Socket 握手同样要求精确 Origin 与有效 Session。
- 注册/登录/加入房间限流；密码用 Argon2id；手机号格式与唯一性由 Zod、应用事务和数据库 CHECK/unique 共同保护。旧用户名仅作迁移兼容。
- logout 撤销数据库 Session、清 Cookie，并立即断开同 Session 的全部 Socket。
- Socket 每条命令、每次私有广播、开手参与者都会复核 Session；绝对过期计时器主动断开静默连接。

## 授权与输入

HTTP 房间读写要求 RoomMember/OWNER；Socket subscribe 要求 RoomMember。用户身份永远来自 Session，不接受 payload userId。所有 HTTP/实时 payload 使用严格 Zod，未知字段拒绝；Body 上限 64 KiB；错误 envelope 只返回稳定码、消息和 UUID requestId。

测试牌组和故障注入只有 `NODE_ENV=test` 可配置，development/production 启动时拒绝。外部无法通过 HTTP/Socket 选择牌组或故障点。

## 隐藏信息

Snapshot 包含完整 deck 与所有私牌，属于服务器最高敏感状态。它：

- 只保存在 PostgreSQL，绝不通过通用 DTO 返回；
- 不写结构化日志、错误摘要或测试快照输出；
- 恢复时只记录 roomId/handId/version/revision/安全 reason；
- 广播前始终调用 recipient-specific projector。

玩家只看到自己的 hole cards；管理员/房主无绕过；非行动者没有 legalActions；fold-to-win 不公开对手牌；showdown/Review 只公开领域规则允许的牌槽。active hand 的 `pendingShowCardIndices` 只投影给本人，其他玩家在 Review 前无法观察待亮选择；Review 内每次添加/撤回都由服务器提交后按接收者投影。逐张公开投影固定使用两槽结构，未公开槽为 `null`，不能因同一玩家公开另一张而泄漏。历史详情与回放同样由服务器按当前用户白名单投影，隐藏牌在 JSON 中为 `null`。整手钻石看牌与发发看授权在该手 30 天保留期内只对各自买方可见，不广播、不改变其他玩家投影。模拟补牌响应不含真实隐藏牌、排除集合或 remaining deck。

完整手机号只允许出现在认证输入和数据库内部。本人资料只返回掩码；Room member、Seat、Table State、Socket、Hand/Replay、Wallet metadata、URL、Storage、Cache、普通日志和错误均禁止完整号码。内部随机 username 不编码手机号。

PWA 只缓存构建产生的静态应用壳，不持久化 `/api`、`/socket.io`、health/readiness、牌桌投影、历史响应或私牌。所有 API 响应为 no-store；生产 PWA 测试会枚举 Cache Storage 并验证这些路径不存在。离线时所有 HTTP/Socket 写意图禁用。

`PERSISTENCE_ERROR` 投影隐藏未提交 finished hand 和未提交最终 stacks；`RECOVERY_ERROR` 隐藏无法验证的 hand，冻结操作，绝不猜测/重置/发新手。

## 日志和秘密

Fastify redact Cookie、Authorization、Set-Cookie、password/currentPassword/passwordHash、phoneNumber、identifier、搜索输入、rawToken/tokenHash。禁止记录完整 Snapshot、deck、remaining deck、future board、未公开私牌、DATABASE_URL、数据库密码或 Cookie。AuditLog metadata 采用白名单安全摘要，不保存这些字段。

允许记录安全标识：roomId、handId、userId、requestId、action type、stateVersion、snapshotRevision、错误码。已覆盖数据库连接/版本、恢复、deadline、Snapshot commit/conflict、Receipt replay/conflict、settlement、CLOSING、eviction、readiness 和 shutdown。

本地真实秘密只在 `.env`、`.env.docker`、`.env.docker.dev`、`.env.docker.test`，均被 Git 忽略；仓库只提交示例。

## 数据完整性

应用在每次转换后运行 Poker Core invariants；Snapshot 恢复还检查 schema version、严格字段、Room/Seat/GameSession 关系、牌唯一性、actor/action sequence 和筹码守恒。数据库用唯一键、CHECK、复合外键和 RESTRICT 提供最终防线。

所有成功变化 commit-before-broadcast。Snapshot CAS、持久 Action Receipt、hand settlement fingerprint、Room/Wallet/Seat 行锁防止重放、丢更新和双结算。每手开局钻石、Hand、Snapshot 在同一事务；整手钻石看牌在 Wallet 行锁内原子提交唯一授权、唯一 debit、请求 fingerprint 和精确响应；旧授权避免二次收费。模拟补牌在 Hand 锁和唯一键下只生成一次，生产抽样使用 `node:crypto`。发生未知数据库错误时停止相关操作，而不是返回未经提交的成功。

## Step 7 加固与限制

Fastify/Caddy 同时设置 CSP、nosniff、DENY frame、no-referrer、Permissions Policy；生产 HTTPS 启用 HSTS。HTTP Body 限制 64 KiB，Socket 应用 payload 限制 64 KiB，每用户最多 5 个 Socket，并有连接/命令限流、未知事件拒绝和 Session 撤销断开。认证、管理员写和敏感读取分别限流。

生产环境拒绝 HTTP CLIENT_ORIGIN、弱数据库密码和占位值。镜像使用非 root 用户，无源码挂载和生产 Seed；PostgreSQL 不公开端口。依赖策略阻断所有可达 high/critical，只对白名单中的 Prisma CLI 配置链 advisory 作有界例外。

仍只支持一个活动应用实例；两个副本没有牌桌所有权租约。未完成短信验证、手机号归属验证、密钥管理服务、告警平台或真实公网部署；本阶段验证的 Caddy local internal TLS 不是公网 TLS 声明。
