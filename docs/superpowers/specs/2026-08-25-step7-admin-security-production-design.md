# Step 7 管理、安全、生产部署与备份恢复设计

日期：2026-08-25
基线：`bc83f95aee4a2d4fd7e51c258d3042c40a0d7ba1`
实时协议：v5
起始 Migration：16

## 1. 目标与边界

Step 7 在现有单活动 Fastify/Socket.IO 实例和 PostgreSQL 17 权威模型上增加管理、审计、安全和可部署运维能力。不得改变扑克规则、房间时长、行动时长、固定积分费率、待亮牌、预操作或发发看的既有语义，也不得引入 Redis、多应用实例、真钱、支付、真实聊天、保险或新玩法。

生产拓扑固定为：

```text
Browser/PWA -> Caddy HTTPS/WSS -> one Fastify/Socket.IO app -> PostgreSQL 17
                                      |
                                      +-> static Web build
```

Migration 是独立一次性 Job；应用本身不迁移、不 Seed、不创建固定管理员。备份默认写到仓库外，并且恢复到新数据库验证，不能覆盖唯一生产副本。

## 2. 持久模型

### 2.1 AuditLog

新增 append-only `AuditLog`，字段包括 actor、角色、动作、目标、可选 user/room/hand、requestId、operationId、reason、IP/User-Agent 安全摘要、经过白名单化的 metadata 与 createdAt。只开放 create/read，不提供 update/delete HTTP 能力。

高风险写操作必须有经过 trim、长度和字符校验的 reason。metadata 只保存业务标识、金额、前后余额、状态和校验结果；禁止密码、完整手机号、Session/Cookie/CSRF、数据库 URL、牌堆、未来牌、未公开底牌及 Snapshot payload。

### 2.2 管理幂等

复用 `RequestIdempotency`，新增 `ADMIN_WALLET_ADJUSTMENT` scope，不创建重复 Receipt 表。同一 admin + operationId + 相同 canonical request 返回首次结果；payload 不同返回 `IDEMPOTENCY_CONFLICT`。Wallet Ledger 继续以全局唯一 idempotencyKey 提供数据库最终防线。

### 2.3 积分审计数据

现有 Hand/购买记录/Ledger 是权威来源：

- 偷偷看：`PaidHandRevealPurchase`/legacy `PaidCardReveal` + `PAID_CARD_REVEAL` Ledger，期望费用 `ceil(hand.bigBlindAmount/2)`；
- 发发看：全局唯一 `HandHypotheticalRunout`、逐用户 `HypotheticalRunoutPurchase` + Ledger，期望费用 `ceil(hand.bigBlindAmount/5)`；
- 加时：`ACTION_TIME_EXTENSION` Ledger metadata 中冻结操作发生时的 handId、bigBlind、cost、deadline before/after，结算后补 `relatedHandId`。

管理查询只报告差异，不自动改账。`audit:data` 以相同规则只读验证并在异常时非零退出。

## 3. 管理权限与 API

所有 `/api/admin/*` 在服务端每次重新通过 Cookie Session 查询当前 Session 状态与 User 当前角色。普通用户统一得到 `ADMIN_REQUIRED`，不因目标是否存在返回不同错误。前端路由保护只是 UX，不是授权边界。

查询采用有界 limit 与 opaque cursor；响应 `no-store`，不返回完整手机号、密码/Session hash、活动手未公开牌、remaining deck 或 Snapshot payload。

API 模块覆盖：Dashboard、Users、Rooms、Tables、Games、Hands、Wallet Ledger、Point Actions、Paid Reveals、Hypothetical Runouts、Audit Logs、Recovery 和 System。管理员查看已完成完整 Hand 时先写 `ADMIN_VIEW_FULL_HAND` AuditLog，日志 metadata 不含牌值；活动 Hand 永远不通过该接口返回完整底牌。

## 4. 管理员积分调整

输入为 targetUserId、非零安全整数 signedAmount、8–200 字符纯文本 reason、UUID operationId。单 PostgreSQL 事务顺序：

1. 已在路由层重新验证 admin；
2. 锁定目标 Wallet；
3. 在资源锁后检查 RequestIdempotency；
4. 校验新余额 `0..MAX_POINTS`，并拒绝会破坏活动桌最坏兑现上限的正向调整；
5. 通过 Wallet 领域服务的事务内原语更新 balance/version/sequence；
6. 创建 `ADMIN_ADJUSTMENT` Ledger；
7. 创建 AuditLog；
8. 创建精确幂等回执并提交。

不修改 TableSeat.stack、Hand、Pot 或结算。UI 展示目标、当前余额、调整量、调整后余额、原因，并在提交前二次确认。

## 5. 房间、牌桌与 Recovery 管理

房间 DTO 显示 duration/expiresAt/remaining、expired-pending-hand、配置、状态、归档、Snapshot revision 与安全 recovery 摘要。管理员 Pause/Resume/Close 必须复用现有 Room/Snapshot/CLOSING/Review/CASH_OUT 流程；不提供删除、直接 Stack 修改或跳过 Review。

活动牌桌只显示 safe header：room/hand ID、street、actor、deadline、seat counts、状态与版本；不返回 hand payload。Recovery revalidate/retry 重新读取数据库并运行既有严格 Snapshot/关系/Poker invariant hydration。失败保持 `RECOVERY_ERROR`；成功才可替换 Runtime。每次操作写 AuditLog，绝不自动重置牌、Stack、Wallet 或关闭房间。

## 6. HTTP、Session 与浏览器安全

- Cookie：HttpOnly、SameSite=Lax；Production Secure；Session token 至少 32 随机字节，数据库只存 SHA-256 hash；撤销/过期拒绝并断开 Socket。
- CSRF：所有 `/api` 非安全方法同时要求精确 Origin 与 `X-Wepoker-Request: 1`；CORS 仅允许配置 Origin + credentials，不使用 wildcard。
- 安全头：CSP（无 unsafe-eval/unsafe-inline）、nosniff、Referrer-Policy、Permissions-Policy、frame-ancestors；Production HTTPS 增加 HSTS。
- 输入：Zod strict、64 KiB HTTP body；统一安全 error envelope/requestId。
- 限流：为 auth、phone bind、join、历史/购买/加时/admin search/adjustment/recovery 配置独立桶；单实例进程内实现，文档明确多实例不共享。

## 7. Socket.IO 安全

保持精确 Origin、Cookie Session、每命令重验 Session、typed Ack 和严格 Zod。增加 64 KiB transport payload、每 IP 连接速率、每用户最多 5 Socket、每 Socket 命令速率与 unknown event 安全拒绝。限流发生在业务队列之前，不改变已提交操作回执、settlement 或收费幂等。

日志只记录 event、requestId/userId/roomId/handId/version/errorCode 等安全字段，不记录 payload 中的私密状态。

## 8. 管理 Web

在现有 React 应用增加 `/admin` 布局与所列子路由，不创建第二工程。桌面高密度、移动可读；使用现有 Lucide。Dashboard 使用服务器聚合；列表使用服务端分页/筛选。完整手机号只可作为搜索请求输入，响应始终掩码。

## 9. 音效回归设计

沿用原创 Web Audio，不下载素材。首次 pointer/touch/key 手势恢复 AudioContext；reduced-motion 不影响声音。补齐 Hero turn alert、音量偏好、页面 hidden 静音/前台恢复、同一 hand/board/action 去重和重连不补播。音频异常继续 fail-soft，不阻塞扑克命令；PWA 仍只缓存当前静态 bundle。

## 10. Production 镜像、Compose 与 Caddy

Dockerfile 使用 build/app/migration 多阶段：frozen install、Prisma generate、Web/Server build、app 仅 production dependencies、非 root、healthcheck。Migration target 只运行 `prisma migrate deploy`，不 Seed。

`compose.prod.yaml` 包含 PostgreSQL 17 pinned patch、migration、app、caddy；数据库不暴露宿主端口，named volume 持久化；migration 成功后 app 才启动，app ready 后 Caddy 才代理。缺少强生产 secret 或明显示例弱值时启动失败。

提供本地 production-like Caddy 配置和 `{$APP_DOMAIN}` 公网模板；支持 HTTP/HTTPS、WebSocket、SPA fallback、压缩、安全头、请求体限制，明确本地证书不等于公网受信 TLS。

## 11. 备份、恢复与数据审计

备份使用 PostgreSQL custom format；命令产生 `.dump`、SHA-256 与无秘密 manifest。默认目录 `.-backups`，prune 只处理有效 manifest 配对，不删除未知文件。

恢复命令必须显式指定新的目标库，先校验 hash，再创建/清理目标、`pg_restore`、检查 migration、运行 data audit。演练还需启动 app 指向恢复库并验证 ready、登录、Wallet、历史、权限和一手新牌。

`audit:data` 只读验证 Wallet/Ledger chain、Table Stack、Hand/pot、房间分档、付费行为、待亮、Snapshot schema、Receipt/preaction 等；输出只含计数和安全 ID，不打印手机号、牌或 payload。

## 12. CI、依赖与验收

CI 的普通 workflow 执行 frozen install、lint、typecheck、unit、PostgreSQL integration、build、Chromium E2E、Docker build 和 Compose config；release-check 手工执行 100,000 手、backup/restore/data audit 及扩展浏览器，不部署、不 push 镜像。

定位 `pg@9 client.query()` 告警的直接/传递来源与调用栈；只有兼容低风险方案才修复，否则记录为已评估限制。运行 pnpm audit，High/Critical 必须判断生产可达性并修复或阻断。

最终必须从空库顺序应用全部 migration，完成 production-like、app/db/full restart、备份恢复、数据审计、10 次稳定性组、100,000 手固定 Seed、全量回归和工作树审计后才可提交。任一权限、私密牌、重复收费/调整、资金、恢复或部署阻断均不得创建“完成”提交。
