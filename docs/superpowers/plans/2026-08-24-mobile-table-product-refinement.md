# Step 6.5 实施计划：成熟移动牌桌与账号生命周期

日期：2026-08-24
工作目录：`.`
最终提交：`feat: mature mobile table interactions and account lifecycle`

## 原则

- 严格 TDD：每个规则先写失败测试，再写最小实现，再重构并跑相关回归。
- 只追加 migration；不编辑旧 migration。
- 同桌写全部进入 `SerializedQueue`，数据库提交后才更新 Runtime/广播。
- 不把参考图、品牌素材、隐藏牌或手机号带入客户端/日志/缓存。
- Step 6.5 完成后停止，不进入 Step 7/8。

## 任务 1：基线、参考矩阵与设计冻结

1. 记录实际 HEAD、status、声明基线差异和 Docker 环境结果。
2. 逐张读取 16 张参考图，完成 `docs/ui-reference-matrix.md`。
3. 将 `学习素材/` 加入 `.gitignore`，验证没有图片被跟踪。
4. 创建本设计文档和实施计划。
5. 跑 frozen install、db validate、lint、typecheck、test、build、E2E、10k simulation 并记录初始 PASS/FAIL。

## 任务 2：append-only Migration 与 schema contract

1. 先写 schema/migration upgrade 失败测试：空库、Step 6 升级、旧 user、旧 hand public、旧 paid reveal、旧 snapshot。
2. 添加 phone、Room 运行/归档、Seat 状态/托管、Action reason、Review/public reason、remaining deck、hand entitlement、runout。
3. 加数据库 CHECK/unique/index/relation；禁止物理 cascade delete。
4. 更新 Prisma schema、migration count、seed phone（仅 dev/test）。
5. 运行 db validate、schema contract、migration upgrade、seed 两次幂等。

## 任务 3：共享 Zod 协议

1. 先写 protocol schema 失败/成功测试。
2. 增加 table:start、arm/cancel autopilot、reserve away、return、reveal own cards command 与 ack。
3. 扩展 runtime/seat/table projection 和 history visibility。
4. 增加 phone、closed-room/archive、hand-level reveal、runout DTO。
5. 搜索新增核心协议中的 `any/unknown` 和 HIDDEN card 分支。

## 任务 4：Snapshot v2 与 Runtime 生命周期

1. 写 v1 compatibility、v2 roundtrip、corruption、future/expired Review/Reserved Away 测试。
2. 扩展 RuntimeRoom/Seat/Authority 与 snapshot codec/schema。
3. 新增 POST_HAND_REVIEW 和持久 review payload。
4. 实现 timer 恢复、CLOSING Review、exactly-once deadline transition。
5. 保持未知版本隔离、CAS、故障注入语义。

## 任务 5：房主手动开始与连续发牌

1. 写 owner/non-owner/one-player/paused/stale/idempotent/concurrent tests。
2. 实现 requiresManualStart/tableStartedAt/table:start 事务。
3. 首次或人数中断后只允许房主启动；连续手在 Review 后自动。
4. 有效人数不足只停发、不停 Room/计时、不释放 Seat/Stack。
5. 更新投影 canOwnerStart/tableRunState 和 Socket 客户端。

## 任务 6：一次性托管、Reserved Away 与 busted

1. 写 Check/Fold/never-extra-chip、cancel/end-hand clear/action reason 测试。
2. 实现 arm/cancel 和自动决策 drain。
3. 写 Reserved Away 60 秒、return、current hand、next hand exclusion、restart、concurrent expiry/cash-out tests。
4. 实现 deadline scheduler、snapshot/seat persistence 和 stable expiry operation。
5. 写 busted settlement/rebuy/refuse/under-two tests；实现 BUSTED_WAITING_REBUY。

## 任务 7：Review 与主动公开

1. 写 3 秒 window、no-next-hand-before-review、future/expired restart、CLOSING tests。
2. 结算保存 remaining deck/reviewEndsAt，并进入 POST_HAND_REVIEW。
3. 写 participant/window/payload/idempotency/concurrency tests。
4. 实现 hand:reveal-own-cards，广播 PUBLIC_VOLUNTARY，Eye 只用于该来源。
5. 验证 Wallet/Stack/result/review deadline 完全不变。

## 任务 8：整手付费看牌、发发看、历史抽屉数据

1. 写旧 target purchase 升级、不重扣、新 purchase 并发、Review 禁止、所有已公开 no charge tests。
2. 实现 PaidHandRevealPurchase 和详情/回放整手服务端投影。
3. 写 runout original-deck、legacy CSPRNG、所有真实牌排除、unique/replay、不改结果 tests。
4. 实现 runout API 和 DTO。
5. 为桌内历史一手一页提供受权限约束的分页数据，复用现有历史服务。

## 任务 9：房间软归档与手机号账号

1. 写 active/closed cursor/archived list 和 archive safety/no-delete tests。
2. 实现 closed list 与 owner archive。
3. 写 phone schema 边界、注册事务、并发唯一、login、prod legacy disabled、bind idempotency tests。
4. 改 Auth service/routes/UI，后端生成无手机号内部 username。
5. Profile 只返回 hasPhoneNumber/phoneMasked；跑 DTO/socket/log/metadata 隐私测试与搜索。

## 任务 10：移动桌组件与基础交互

1. 先写 viewport/overflow/seat geometry/long-name/20亿测试。
2. 拆分 MobileTableStage、topbar/menu/center/seat/hero/action/connection。
3. 固定 100dvh + safe area + hidden overflow；移除椭圆/圆桌主体。
4. 实现 2–9 hero-bottom 模板，保留 authoritative seatIndex。
5. 实现统一邀请复制、菜单站起/退出/保位/return/owner actions/placeholder。

## 任务 11：行动器、弹窗、抽屉与占位

1. 写比例整数 clamp、min/max/short/all-in、keyboard/touch/stale tests。
2. 实现 ActionPanel 和 RaiseSliderOverlay。
3. 实现购物车浮层、BuyInModal、BustedRebuyModal。
4. 实现 HistoryDrawer/pager/audit/runout 和 ChatDrawer；左右互斥。
5. 创建房间手机布局，发两次/保险/购买积分/精彩对局/皮肤均禁用且不发请求。

## 任务 12：牌型、动画与 Web Audio

1. 在 Poker Core/Server 写当前本人牌型 helper 和投影测试。
2. HeroHand 显示 preflop 语义与 board 后最佳牌型。
3. 写 animation coordinator 去重、reconnect/background/reduced-motion/cleanup tests。
4. 实现两轮底牌和 flop/turn/river 表现动画，不改 deadline。
5. 写 sound unlock/mute/background/throttle/failure tests；实现原创 Web Audio synthesis。

## 任务 13：Playwright、几何与恢复

1. 实现并运行 E1–E13。
2. 覆盖 375×812、390×844、393×852、430×932、横屏、768×1024、1366×768、1920×1080。
3. 断言 body 无滚动、行动控件可见、drawer/overlay 不推布局、隐藏牌不在 DOM/aria。
4. 扩展 process recovery：autopilot、Reserved Away、Review、voluntary reveal、CLOSING。
5. 回归 Step 5/6 action receipt、settlement exactly-once、PostgreSQL concurrency、history/replay/PWA。

## 任务 14：文档、安全审计和最终门禁

1. 更新 README、architecture、data model、protocol、runtime、snapshot、recovery、history/reveal/PWA/UI/security/operations/asset log/PROGRESS。
2. 运行规格指定敏感搜索：参考图、品牌、phone、hidden cards、remaining deck、chat/payment/archive delete。
3. 运行完整命令矩阵和所有专项脚本。
4. 对 14 类稳定性各重复 10 次，记录结果，不用 retry 隐藏 flaky。
5. 运行 Docker build、prod compose config、diff check、status。
6. 只有零阻断时 `git add .`、指定 commit、记录 hash；不 push/tag。
