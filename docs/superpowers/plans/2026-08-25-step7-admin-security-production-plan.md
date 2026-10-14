# Step 7 实施计划

日期：2026-08-25
设计：`../specs/2026-08-25-step7-admin-security-production-design.md`

## 0. 基线证据

- 确认 `main` / `bc83f95aee4a2d4fd7e51c258d3042c40a0d7ba1`、protocol v5、16 migrations、clean worktree。
- 运行 frozen install、Docker/PostgreSQL、validate、lint、typecheck、456 unit、159 integration、build、20 browser E2E、1 PWA E2E、10,000 hand seed 123456。
- 首次 Browser E2E 的 E3 瞬时 Review 等待若失败，隔离复现并保留证据；不得用 retry 掩盖。

## 1. Migration 与持久模型（TDD）

1. 先扩展 schema contract/migration upgrade tests，要求 AuditLog、索引、ADMIN scope、约束和起始 16 migration 不被修改。
2. 新增 append-only Step 7 migration 和 Prisma schema 关系。
3. 从空 test schema 应用全部 migration，并跑旧库升级测试。
4. 更新 readiness migration count 与测试。

## 2. 管理鉴权、审计与调整（TDD）

1. 写 admin authorization integration：匿名 401、USER 稳定 `ADMIN_REQUIRED`、伪造 role 无效、ADMIN 成功。
2. 写 AuditLog metadata sanitizer、reason schema 和不可修改/删除路由边界测试。
3. 写 Admin Adjustment 事务测试：正负调整、Ledger、AuditLog、相同 operation replay、不同 payload conflict、负余额/MAX_POINTS/活动 Seat 防线、并发最多一次。
4. 实现 `modules/admin` schemas/service/routes，复用 Session、Wallet 和 RequestIdempotency。

## 3. 管理查询与安全 DTO（TDD）

1. Dashboard 服务端聚合测试。
2. Users 搜索/详情测试：ID/nickname/username/完整手机号精确/后四位，响应只掩码。
3. Rooms/Tables/Games/Hands/Ledger/Point Actions/Purchases 查询和 cursor 测试。
4. 完成 Hand 全牌读取只允许已结算并写无牌值 AuditLog；活动手拒绝。
5. Point action expected/actual/ledger/idempotency 校验测试。
6. Recovery safe DTO/revalidate/retry 测试；损坏 Snapshot 保持错误。

## 4. Admin Web（TDD）

1. 先写路由与 USER 无权限组件测试。
2. 建立 Admin API client、layout/nav、Dashboard 和统一 table/filter/pagination 组件。
3. 实现所需 `/admin/*` 路由；桌面高密度、390px 可读。
4. 实现调整二次确认和房间安全动作；不暴露不允许的写控件。
5. 浏览器 E2E 覆盖普通用户拒绝、Dashboard、手机号掩码、Adjustment/AuditLog、房间状态和费用审计。

## 5. HTTP/Session/CSRF/Headers/Rate Limit（TDD）

1. 写缺 Header/错 Origin/CORS/GET/Secure Cookie/Session revoke+expiry 测试。
2. 增加 `X-Wepoker-Request` guard，并让正式 Web client 对所有写请求自动携带。
3. 加生产 CSP/nosniff/referrer/permissions/frame/HSTS；验证静态/PWA/Socket/Web Audio 兼容。
4. 为指定端点配置独立 rate limit；Fake Clock/短窗口测试，不 sleep。
5. 扩展 logger redact 与错误脱敏测试。

## 6. Socket.IO 安全（TDD）

1. 写 Origin/Session 过期、IP 连接速率、每用户 5 sockets、命令速率、payload 64 KiB、unknown event 测试。
2. 在 transport/packet middleware 增加限制，保证 typed Ack 和已提交幂等结果不受损。
3. 全量 realtime/snapshot/recovery/concurrency/settlement 回归。

## 7. 音效回归（TDD）

1. 扩展 hook tests：gesture unlock、reduced motion 独立、deal/board/chip/turn/win 去重、mute、volume、hidden、foreground、reconnect。
2. 最小补齐 turn/volume/visibility，不更换现有 Web Audio 结构和素材。
3. UI 暴露可访问音量控件；PWA fresh build 验证加载新 bundle。

## 8. 运维命令与生产配置（TDD）

1. 增加 production environment 强值校验测试和 `.env.production.example`。
2. 重构 Dockerfile 为 build/app/migration targets；完善 `.dockerignore` 和 image contract tests。
3. 完成 prod compose migration dependency、health、volume、无 DB 端口；完成 local/public Caddy configs 和 config tests。
4. 实现安全交互式 `admin:create`，密码不进 argv/日志，生产不 Seed。
5. 实现 backup create/list/verify/restore/prune；单元测试 manifest/hash/corruption/prune safety。
6. 实现只读 `audit:data` 及异常 fixture tests。
7. 增加 GitHub Actions CI/release-check、第三方 notices、release checklist。

## 9. 文档

更新全部受影响的产品、架构、模型、API、协议、安全、恢复、并发、PWA、运维和 PROGRESS 文档；新增 admin/deployment/production config/security hardening/backup restore/data audit/incident/point audit。记录单实例、无公网部署、固定费率、音效回归与依赖决定。

## 10. 最终验证

1. reset test DB；从空库应用 migration；Seed 两次验证幂等。
2. 运行 lint/typecheck/unit/integration/全部专项/build/E2E/PWA。
3. Docker image/production compose/Caddy production-like；验证 migration job、app ready、Socket/SPA/admin。
4. app restart mid-hand、PostgreSQL restart、full compose restart（不加 `-v`）。
5. 完成真实 backup/hash/new DB restore/data audit/app ready/login/history/admin/new hand。
6. 指定 12 组稳定性各独立运行 10 次，首错即停；不使用业务 retry。
7. 运行 100,000 hands seed 123456，记录 completed/failed/invariants/elapsed/native retries。
8. `pnpm audit`、敏感词/skip/only/TODO/secret 搜索、image/build context、Git diff/status 审计。
9. 只有全部阻断项为零时更新 PROGRESS、提交 `feat: add admin security production deployment and backups`，不 push/tag/Step 8。
