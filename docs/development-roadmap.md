# 开发路线图

每一阶段都遵循 TDD：先失败测试、确认失败原因、最小实现、通过测试、重构、再运行 lint/typecheck/unit/relevant integration/build。阶段不得提前实现后续范围。

## Stage 0 — 基础工程（已完成）

交付 pnpm/strict TypeScript monorepo、React PWA 开发页、Fastify `/health`、shared 契约、零玩法 poker-core 测试入口、Prisma PostgreSQL 空模型边界、Docker Compose/Caddy、长期决策文档和 Windows 说明。

明确不含：扑克规则、牌桌 UI、用户、Wallet、房间和 Socket.IO 业务。

## Stage 1 — Poker Core：Card / Deck / Hand Evaluator（已完成）

只实现：

- 稳定、唯一、可序列化 Card 表示；
- 标准 52 张 Deck 与短牌 6–A 的 36 张 Deck、不重复与确定性预设牌堆；
- 生产可注入密码学随机源，明确禁止 `Math.random()`；
- 5–7 张牌最佳五张 Hand Evaluator 与完整牌型比较；
- 单元测试和 fast-check 属性测试（唯一性、序列化、排序性质、已知边界）。

不实现下注、玩家、房间、网络或数据库。

## Stage 2 — Poker Core：行动、底池与结算（已完成）

定义纯状态转换、街道推进、盲注、heads-up 顺序、合法动作、total-to 金额语义、all-in、单次与累计短全下加注权重开。用表驱动测试覆盖完整规则，不接 WebSocket。

## Step 3 — 身份、Wallet、私人房间与 PostgreSQL（已完成）

已建立真实 Prisma migration、Argon2id 注册/登录、服务器 Session、INITIAL_GRANT Wallet/Ledger、内部 CAS/幂等记账服务、私人房间/成员和房主暂停/恢复/关闭 HTTP API。加入房间仍不等于选座。

## Step 4 — 服务器权威实时牌桌、座位、买入与最小 H5（已完成）

已将 Socket.IO 与 Poker Core 组合，实现 2–9 人选座、与 Wallet 完全解绑的房间 Table Stack、GameSession/Ledger/完成手持久化、每桌串行队列、stateVersion/幂等、连续开局/超时、同进程刷新重连和响应式可玩 H5。坐下/补点/离桌只写房间点数记录，钻石只由明确费用行为改变。

## Step 5 — 进行中 Snapshot、重启恢复与可靠性强化（已完成）

已实现本机 PostgreSQL（开发时由 Docker 容器运行）、多连接竞争、进行中 Hand Snapshot、Server 重启恢复、持久化 Action Idempotency、未确认动作消歧、Exactly-once Settlement、恢复/故障注入、Runtime cleanup、安全停机和 30 天应用记录保留。

## Step 6 — H5/PWA 视觉与可访问性深化

在 Step 4 原创 CSS/HTML 牌桌、卡牌、座位、行动控件和 PWA 壳基础上深化 iPhone Safari/Android Chrome 矩阵、可访问性、动效与正式视觉；不得复制第三方素材或像素级布局。

本阶段不预设具体美术风格，但应覆盖全部必要视觉状态。素材缺失或下载失败时使用有明确许可证/原创声明的占位素材并写入 `docs/asset-log.md`，后续替换不得改变业务语义或可访问性。

## Step 7 — 历史、回放与积分看牌

实现参与者权限过滤历史、逐行动回放、公开牌规则、积分看牌资格/唯一授权/原子扣费/个人可见性及管理员审计测试。

## Step 8 — 个人统计与管理后台

在同一个 Web 应用加入个人统计和 `/admin`；服务端角色权限、敏感查询审计、积分管理调整，不加入单独 Admin App。

## Step 9 — 生产加固与发布候选

完成 Playwright 移动/桌面矩阵、并发/长时间集成测试、备份恢复演练、迁移部署、TLS/WSS、安全头/CSP、限速、日志与维护手册。仍不引入 Redis/微服务，除非实测兼容性阻断并经书面架构决策批准。

## 已授权的玩法扩展

普通模式双人 All-in 协商“发两次”、鱿鱼模式和短牌模式已经由项目所有者明确授权，三者互斥。短牌使用 6–A 的 36 张牌、同花大于葫芦，并在每手结算后把后手自动规范到房间上下限。

## 持续的非目标

任何阶段都不加入真钱、支付、兑换、rake、ante、straddle、保险、商业联盟、大型锦标赛、Omaha、OFC、语音聊天、第三方商标或受版权保护素材。除上述明确授权的玩法外，不再推导或提前实现其他扑克变体。
