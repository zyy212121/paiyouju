# 需求追踪矩阵

版本：`0.1.0-rc.1`
日期：2026-08-31
范围：Step 0–Step 8 的有效产品、规则、数据、安全、运维与发布前需求。状态仅使用 `PASS`、`PARTIAL`、`FAIL`、`NOT APPLICABLE`；历史发布证据见 `docs/release-evidence/0.1.0-rc.1/`，当前变更证据见 `docs/PROGRESS.md`。

| Requirement ID | Requirement | Implementation Location | Test Location | Evidence Command | Status | Release Blocker | Known Limitation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S0-FOUNDATION | Windows/PowerShell 可复现 Monorepo、固定 Node/pnpm、共享类型与严格检查 | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` | 全 workspace | `corepack pnpm install --frozen-lockfile; corepack pnpm lint; corepack pnpm typecheck` | PASS | No | None |
| S0-ARCH | Web、Server、Poker Core、Shared 分层，产品代码不依赖测试驱动器 | `apps/`, `packages/`, `docs/architecture.md` | `tools/system-test-runner/src/runner-boundary.test.ts` | `corepack pnpm test:system-runner` | PASS | No | None |
| S0-ASSETS | 缺失素材可占位并记日志；不复制参考产品品牌资产 | `docs/asset-log.md`, `.gitignore`, `.dockerignore` | 静态与镜像边界审计 | `docker run --rm --entrypoint sh wepoker:0.1.0-rc.1 -c "find /app -type f"` | PASS | No | 当前声音、筹码、牌面和头像占位由代码生成 |
| S1-CARDS | 标准 52 张与短牌 6–A 的 36 张牌组、无重复、密码学洗牌适配器 | `packages/poker-core/src`, `apps/server/src/crypto-random.ts` | Poker Core / Deck Provider / 五张牌枚举 | `corepack pnpm --filter @paiyouju/poker-core test` | PASS | Yes | None |
| S1-EVALUATION | 标准牌型与短牌 A-6-7-8-9、同花大于葫芦、最佳五张和平局比较正确 | `packages/poker-core/src` | `packages/poker-core/src/**/*.test.ts` | `corepack pnpm --filter @paiyouju/poker-core test` | PASS | Yes | None |
| S1-BETTING | No-limit Fold/Check/Call/Bet/Raise/All-in 合法动作与最小加注 | `packages/poker-core/src/hand.ts` | Poker Core + Realtime Integration | `corepack pnpm test:realtime` | PASS | Yes | None |
| S1-SHORT-ALLIN | Short All-in 不错误重开已行动玩家加注权 | `packages/poker-core/src/hand.ts`, `docs/short-all-in-rules.md` | Poker Core / 百万手模拟 / Scenario S5 | `corepack pnpm --filter @paiyouju/poker-core simulate -- --hands=1000000 --seed=20260826` | PASS | Yes | None |
| S1-SIDEPOT | 多层 Side Pot 建立、资格与结算 | `packages/poker-core/src/engine/pots.ts`, `apps/server/src/modules/tables/runtime/project-table-state.ts`, `docs/side-pot-algorithm.md` | Poker Core / Projection / Scenario S2 / Simulation | `corepack pnpm test` | PASS | Yes | None |
| S1-ODDCHIP | Split Pot 奇数筹码按按钮后顺序分配 | `packages/poker-core/src/engine/settlement.ts`, `packages/poker-core/src/engine/invariants.ts` | Poker Core / Scenario S6 / Canonical Pot Regression | `corepack pnpm --filter @paiyouju/poker-core test` | PASS | Yes | None |
| S1-SHORT-DECK | 短牌与发两次/鱿鱼互斥，36 张牌，规则说明及每手上下限规范 | Poker Core / Room Schema / Hand Persistence / Mobile UI | Core / Room / Snapshot / Persistence / Component / Bot | `corepack pnpm test; corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S1-BOMB-POT | 暴击与其他模式互斥；1/5/10/15/20/25/30 分钟离散计时、全员 1–10 BB 强制投入、跳过翻前且托管不能绕过盲注 | Poker Core / Room Schema / Runtime Transition / Snapshot / History / Mobile UI | Core / Room / Timer / Snapshot / Realtime / Replay / Component | `corepack pnpm test; corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S1-CONSERVATION | 每手筹码守恒、无负 Stack、无重复 Hand | Poker Core 与持久结算 | Simulation / Data Audit | `corepack pnpm audit:data` | PASS | Yes | None |
| S2-PHONE | 11 位手机号注册/登录、并发唯一、仅返回掩码；不验证归属、不发短信 | `apps/server/src/modules/auth`, `docs/phone-accounts.md` | Auth Integration / E2E E13 | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | 无短信验证码和号码归属验证 |
| S2-LEGACY | 旧开发账号一次绑定手机号后沿用同一账户；本机管理员可直接用账号登录 | `apps/server/src/modules/auth`, `apps/web/src/pages/AuthPage.tsx` | Auth/Seed Integration | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | No | 生产仍不开放普通用户名注册 |
| S2-WALLET | 娱乐钻石 Wallet、初始 Grant、边界与版本控制 | `apps/server/src/modules/wallet` | Wallet Integration / Data Audit | `corepack pnpm audit:data` | PASS | Yes | 不充值、提现或兑换现金 |
| S2-LEDGER | Wallet Ledger 在 30 天窗口内保持余额链与幂等关联；Wallet 保存当前余额/version | `apps/server/src/modules/wallet`, Prisma schema | Wallet/Admin/费用/Retention Integration | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | 过期前缀按保留策略清理 |
| S2-ROOM | 私人房间码、Owner、成员授权、2–9 人配置；BB 档位/手输及服务端 `SB=ceil(BB/2)` | Room Schema / Create Room UI | Room Schema / Rooms Integration / Component | `corepack pnpm test; corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | 客户端不得提交 Small Blind |
| S2-BUYIN | 普通/鱿鱼首次按 Initial Buy-in、短牌首次按下限领取；自由补点、站起/退出恢复同一后手与 GameSession，全部不修改 Wallet | `apps/server/src/modules/tables`, `docs/table-accounting.md` | Accounting/Realtime/Recovery/Persistence Integration | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S2-BUST | 普通 Stack=0 自动站起；鱿鱼/短牌按模式自动补点；Wallet=0 不阻止牌桌点数行为 | Table Runtime/Persistence | Accounting/Realtime/Persistence Integration | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S3-PROTOCOL | Typed Socket.IO Protocol v9、Ack、stateVersion 与 recipient projection | `packages/shared/src`, `apps/server/src/realtime.ts` | Shared / Realtime / Scenario Runner | `corepack pnpm test:protocol; corepack pnpm test:ack` | PASS | Yes | None |
| S3-AUTHORITY | 服务器权威行动、非法动作拒绝、clientActionId 幂等 | Realtime / Hand Controller | Realtime / Action Idempotency / Fault | `corepack pnpm test:action-idempotency` | PASS | Yes | None |
| S3-TIMER | 10–45 秒行动时间、最后 3 秒提示、持久 deadline | Runtime Scheduler / Mobile UI | Timer Integration / E2E | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S3-EXTENSION | 加时立即执行，固定 10 钻石，每次增加初始时长一半且幂等 | Runtime + Diamond Action Ledger | Time Extension E2E / Integration / Audit | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S3-PREACTION | “让或弃”持续；“自动跟注 N”在最大投入变化时取消 | Runtime / Snapshot / Mobile Action UI | Realtime / E2E E3/E3b / Scenario S9 | `corepack pnpm test:realtime` | PASS | Yes | None |
| S3-AWAY | 保位离桌、60 秒返回、过期释放 Seat 并保存同一 GameSession 后手 | Runtime / Scheduler | Realtime / Recovery Process | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S3-DURATION | 房间 30–180 分钟倒计时；到期完成当前手后停发并关闭 | Room Scheduler / Snapshot | Expiry Integration / Scenario S11 | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S4-SNAPSHOT | 每个权威 transition 持久 Snapshot revision/stateVersion | `apps/server/src/modules/tables/snapshot` | Snapshot Codec/Repository | `corepack pnpm test:snapshots` | PASS | Yes | None |
| S4-RECOVERY | Preflop/Flop/Turn/River/Review/产品状态进程恢复 | `apps/server/src/modules/tables/recovery` | Recovery Component + True Process | `corepack pnpm test:recovery; corepack pnpm test:recovery:process` | PASS | Yes | 单活动 App 实例 |
| S4-RECOVERY-CLOSE | 持续 RECOVERY_ERROR 的遗留房间可由管理员在备份后安全废止未完成手牌、结清会话并关闭/删除 | Room Lifecycle Persistence / Admin Room Control | Admin Room Actions Integration | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | 不修复或结算无法验证的活动手 |
| S4-CONCURRENCY | PostgreSQL 行锁、事务边界、并发 exactly-once | Persistence Services | PostgreSQL Concurrency / Settlement | `corepack pnpm test:postgres-concurrency; corepack pnpm test:settlement-exactly-once` | PASS | Yes | None |
| S4-CLEANUP | Runtime、Timer、Socket 与 Action Receipt Cache 有界并可回收 | Runtime Manager / Realtime | Runtime Cleanup / 30 分钟 Soak | `corepack pnpm test:runtime-cleanup; corepack pnpm test:soak` | PASS | Yes | None |
| S5-HISTORY | 用户历史分页、有界 Cursor 与授权 | `apps/server/src/modules/history`, `apps/web/src/pages/HandsPage.tsx` | History Integration / E2E | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S5-HANDDETAIL | Hand Detail 只投影当前用户合法可见信息 | History Projection | Hidden Information / Browser E2E | `corepack pnpm test:realtime` | PASS | Yes | None |
| S5-REPLAY | 已完成牌局 Replay、动作顺序与可见性一致 | History/Replay API 与 UI | Replay Integration / E2E | `corepack pnpm test:e2e` | PASS | Yes | None |
| S5-REVIEW | 4 秒 POST_HAND_REVIEW 合并赢家、结算、待亮展示 | Runtime / Mobile UI | Review/Deadline Integration / E2E | `corepack pnpm test:realtime` | PASS | Yes | None |
| S5-SHOW | 玩家逐张设置待亮；Review 冻结并只公开已选牌；下一手清空 | Pending Show Runtime/Snapshot/UI | E2E E8 / Scenario S13 / Data Audit | `corepack pnpm test:system-scenarios` | PASS | Yes | None |
| S6-PAIDREVEAL | “偷偷看”仅历史入口，新手固定 50 钻石，买家授权和单次扣费 | Paid Reveal Service/UI | Integration / E2E / Scenario S14 / Audit | `corepack pnpm audit:data` | PASS | Yes | None |
| S6-RUNOUT | “发发看”固定 10 钻石；每手唯一五张 fullBoard，不改真实结算 | Hypothetical Runout Service/UI | Integration / E2E / Scenario S15 / Audit | `corepack pnpm audit:data` | PASS | Yes | None |
| S6-ARCHIVE | CLOSED 终态、软归档隐藏、30 天后自动删除房间历史 | Room Lifecycle / Data Retention | Retention Integration / Audit | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | 账户和 Wallet 当前状态持续保留 |
| S6-MOBILE | 375/390/430、横屏、平板和桌面无关键溢出；按钮/抽屉可操作 | Mobile Table CSS/Components | Chromium/Firefox/WebKit Viewport Matrix | `corepack pnpm --filter @paiyouju/web test:e2e:browsers` | PASS | No | 真实 iPhone Safari/Android Chrome 建议人工验收 |
| S6-PWA | Manifest、图标、standalone、更新提示、离线/重连；私人请求 NetworkOnly | `apps/web/vite.config.ts`, `apps/web/src/pwa` | PWA Unit + Production PWA E2E | `corepack pnpm test:e2e:pwa` | PASS | Yes | None |
| S7-ADMIN | 数据库当前角色复核、Dashboard、用户/房间/Hand/费用/System 查询 | `apps/server/src/modules/admin`, `apps/web/src/features/admin` | Admin Integration / E2E | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S7-ADJUST | Admin Adjustment 同事务写 Wallet/Ledger/AuditLog；在桌玩家也可调钻石且不改 Stack | Admin Service | Admin Adjustment Integration | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S7-RETENTION | CLOSED 房间/牌局/玩家记录与通用历史最多保留 30 天；启动及每 6 小时清理 | `apps/server/src/operations/data-retention.ts` | Retention Integration / Data Audit | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | 活动房间、User、Wallet 当前状态不删除 |
| S7-AUDITLOG | 管理敏感操作追加 AuditLog，不含私牌/完整手机号 | Admin/Audit Services | Admin Integration / Privacy Scan | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S7-IDOR | Room/Hand/Wallet/Admin 按当前身份与成员关系授权 | HTTP Services | Authorization/IDOR Integration | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S7-SESSION | HttpOnly/SameSite、生产 Secure、过期/撤销与当前角色复核 | Session/Auth Services | Security Integration | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S7-CSRF-CORS | HTTP 写请求可信 Origin + 自定义标头；精确 CORS；Socket Origin | Security Hooks / Realtime | CSRF/CORS/Socket Security Tests | `corepack pnpm --filter @paiyouju/server test:integration` | PASS | Yes | None |
| S7-INPUT | Zod 限制、请求体/速率/Socket payload 上限、中文稳定错误 | HTTP/Realtime Schemas | Security Unit/Integration | `corepack pnpm test` | PASS | Yes | None |
| S7-PRIVACY | 不泄漏底牌、剩余牌堆、未来 Board、完整手机号、Cookie/Secret | Recipient Projection / Logging Redaction | Privacy Assertions / Scenario / Image Scan | `corepack pnpm test:system-scenarios` | PASS | Yes | None |
| S7-DOCKER | 固定基础镜像、Migration Job、非 root 精简运行镜像、Scenario Runner 不入镜像 | `Dockerfile`, `.dockerignore`, `compose.prod.yaml` | Production Contract + Image Inspection | `docker build -t wepoker:0.1.0-rc.1 .` | PASS | Yes | 单活动 App 实例；无水平扩展 |
| S7-CADDY | HTTPS、SPA/API/Socket.IO 代理、安全头、压缩 | `Caddyfile`, `Caddyfile.local` | Production-like E2E / Fault | `docker compose -f compose.prod.yaml up -d` | PASS | Yes | 未验证正式域名/公网 ACME |
| S7-BACKUP | 项目外 custom dump、Manifest/SHA、原子写入与保留边界 | `apps/server/src/operations/backup.ts`, `docs/backup-restore.md` | Backup Unit/Integration + Restore Drill | `corepack pnpm backup:create; corepack pnpm backup:verify` | PASS | Yes | 不自动上传云端 |
| S7-RESTORE | 只恢复到新数据库/新卷，核对 Migration、Audit、登录与新 Hand | Backup CLI / Runbook | 最终隔离恢复演练 | `corepack pnpm backup:restore; corepack pnpm audit:data` | PASS | Yes | None |
| S7-CI | frozen install、lint、typecheck、test、build、E2E、Docker；不自动部署 | `.github/workflows` | Production Contract | `corepack pnpm --filter @paiyouju/server test` | PASS | No | 本地未触发远端 GitHub Runner |

## 判定

- 核心需求 `PARTIAL`：0
- 核心需求 `FAIL`：0
- Release Blocker：0
- 非阻断限制：见 [`KNOWN_LIMITATIONS.md`](../KNOWN_LIMITATIONS.md)
