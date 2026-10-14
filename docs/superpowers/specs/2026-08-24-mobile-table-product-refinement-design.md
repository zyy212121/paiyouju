# Step 6.5 成熟移动牌桌与账号生命周期设计

日期：2026-08-24
状态：实施基线
范围：仅 Step 6.5；不得开始 Step 7/8

## 1. 基线与决策记录

任务文本声明的 Step 6 基线是 `d35ff32fea7d13072a87ef04eae17bdaed241966`。实际仓库在 `main` 上还包含两个已提交且属于用户现有工作的 LAN 改进：`4385f5d` 与 `25ec560`，实际开始 HEAD 为 `25ec5602ef046cb42b92e64c7dbb5b878ad131d5`。本阶段保留这两个提交，不重置、不覆盖；最终报告同时记录声明基线和实际基线。

现有架构继续保持：单 Fastify/Socket.IO 实例、每桌 `SerializedQueue`、PostgreSQL 事务、Snapshot CAS、commit-before-runtime-update、按接收者投影、Poker Core 权威规则。Step 6.5 不引入 Redis、消息队列、微服务、原生 App、支付、聊天后端或新的图标库。

本阶段显式取代两个旧行为：

- “满足两人自动开始”改为首次或人数中断后由房主手动开始；一旦开始，人数持续满足时才自动连续发牌。
- “逐目标付费看牌”升级为一次购买整手隐藏底牌；旧逐目标购买永久视为整手授权且不得再次收费。

## 2. 参考图与知识产权边界

`.\学习素材` 的 16 张 JPEG 仅作为本地非分发设计参考。完整逐图映射见 `docs/ui-reference-matrix.md`。目录加入 `.gitignore`，图片不得进入 Git、Build、PWA precache、Docker image 或发布资源。

只提取信息架构、状态、相对层级、触控模式和内容密度；不复制 WePoker 名称、Logo、网址、头像、广告、字体、牌背、桌面纹理、音效或任何专有美术。继续使用现有 `lucide-react`（ISC）和项目原创 HTML/CSS/SVG/Web Audio。若素材缺失，以代码绘制占位并在 `docs/asset-log.md` 留痕。

## 3. 权威状态模型

### 3.1 Room 与桌局运行

Room 新增：

- `tableStartedAt: DateTime?`：第一次房主成功开始时写入，之后暂停、人数不足和 Review 都不停止计时。
- `requiresManualStart: Boolean`：默认 `true`。房主 `table:start` 成功后置 `false`；有效玩家降到 2 人以下并结束 Review 后重新置 `true`。
- `archivedAt: DateTime?`、`archivedByUserId: String?`：只用于列表软归档，不删除任何关系数据。

投影中的 `tableRunState` 使用 `WAITING_FOR_OWNER | RUNNING | PAUSED | STOPPED_INSUFFICIENT_PLAYERS | CLOSING | CLOSED | ERROR`，与低层 Runtime status 分离。Runtime status 新增 `POST_HAND_REVIEW`；`START_COUNTDOWN` 仍作为实际开手倒计时。

`table:start` 进入桌队列并在单一事务内锁 Room/Snapshot、校验 owner/OPEN/not paused/至少两名有效玩家、持久化 RequestIdempotency、设置 `requiresManualStart=false` 和首次 `tableStartedAt`、提交倒计时 Snapshot。重复 operationId 精确回放；不同 payload 冲突；活动手或已在倒计时不能重复开手。

有效玩家只包括：已坐下、`ACTIVE`、stack > 0、会话/Presence 满足现有恢复规则的人。`RESERVED_AWAY`、`BUSTED_WAITING_REBUY`、SIT_OUT、LEAVE_AFTER_HAND 均不计入。人数不足只停发、保留 Room/Seat/Stack 并继续 `tableStartedAt` 计时。

### 3.2 Seat 生命周期

`TableSeatPlayStatus` 增加：

- `RESERVED_AWAY`：保留 Seat/Stack，不参加下一手。
- `BUSTED_WAITING_REBUY`：结算后 stack=0，保留 Seat，必须补码或站起。

Seat 同时持久化：

- `nextActionAutopilotArmed: Boolean`
- `reservedAwayEndsAt: DateTime?`

Snapshot 与关系表必须一致。一次性“让或弃”只在该玩家下一次成为 actor 时执行 `Check else Fold` 并原子清除；一次性“自动跟注”绑定武装时的最高投入，绑定未变时 Call 一次，最高投入变化则先取消。未触发的预操作在手牌结束时清除。保位离桌在当前手余下每次决策执行同一零追加策略，下一手排除。60 秒期限由服务器绝对时间调度；到期时不在当前手立即 exactly-once cash-out，仍在当前手则转 `LEAVE_AFTER_HAND`，结算后 exactly-once 带出。

所有自动行动写 `automatic=true` 和明确 `automaticReason`：`TURN_TIMEOUT | NEXT_DECISION_AUTOPILOT | NEXT_DECISION_AUTO_CALL | RESERVED_AWAY`。除显式武装且绑定未变化的单次 Call 外，自动策略永不 Call/Bet/Raise/All-in；已有投入不退回。

补码成功把 `BUSTED_WAITING_REBUY` 恢复为 `ACTIVE`。拒绝补码使用既有安全离桌事务关闭 GameSession、释放 Seat；0 筹码 cash-out 仍保持幂等且不产生重复余额变化。

### 3.3 POST_HAND_REVIEW

结算事务不直接回到 IDLE，而是：

1. 完整写入 Hand/Player/Action/Pot/HAND_RESULT、Seat 终态及 busted 状态；
2. 写入 `HandRecord.reviewEndsAt = finishedAt + 3000ms`；
3. Snapshot 保存 `postHandReview`（完成手、reviewEndsAt、主动公开 userId 集合）；
4. Runtime 进入 `POST_HAND_REVIEW`；
5. 3 秒结束后在桌队列和 Snapshot CAS 下 exactly-once 清理 Review，并决定连续倒计时或等待房主。

Review 不延长行动 deadline，不延长自身 deadline。重启时未来 deadline 恢复剩余时间，过期 deadline 只排队一次结束逻辑。CLOSING 也完整保留 Review，之后再执行既有安全 cash-out/close。

### 3.4 Snapshot 兼容

Snapshot schema 升级为 v2，新增 Room 手动开始/计时字段、Seat 托管/离桌字段和 `postHandReview`。解码器显式接受健康 v1：缺失字段使用 `requiresManualStart=true`、无托管、无 Review 的安全默认，并在下一次成功写时升级为 v2。未知版本仍进入 `RECOVERY_ERROR`。迁移和进程测试覆盖 v1 活动手、future/expired deadline、Reserved Away、Review 与 CLOSING。

## 4. 数据库演进

只追加新 migration，不编辑前 10 个 migration。新增/变更：

- `User.phoneNumber String? @unique`，数据库 CHECK `NULL OR ^1[0-9]{10}$`。
- Room 的 `tableStartedAt/requiresManualStart/archivedAt/archivedByUserId`。
- Seat 的新状态、托管布尔值和离桌 deadline。
- `HandActionRecord.automaticReason` nullable enum。
- `HandPlayerRecord.holeCardsPublicReason` 与 `voluntarilyRevealedAt`；旧 `holeCardsPublic=true` 回填为 `SHOWDOWN`。
- `HandRecord.reviewEndsAt` 与 `remainingDeck`；新完成手保存权威未使用牌序列，旧手为空数组。
- `PaidHandRevealPurchase`，唯一 `(buyerUserId, handId)`；新购买的 Wallet debit、Ledger 和 entitlement 同事务。
- `HandHypotheticalRunout`，唯一 `handId`，保存 cards、generationSource、createdAt。
- 必要的 IdempotencyScope、RuntimeStatus、SeatStatus 和 enum 值。

旧 `PaidCardReveal` 不删除、不改写。授权查询是 `PaidHandRevealPurchase OR any legacy PaidCardReveal for buyer+hand`；因此任何旧目标购买自动升级成整手查看且绝不再次扣费。

Migration 必须从空库和 Step 6 schema 都可应用，保留所有 User/Wallet/Session/Room/Hand/Ledger/Reveal 数据。readiness migration 计数同步更新。

## 5. 账号生命周期与隐私

新注册输入固定为 `phoneNumber/password/nickname`。手机号 schema 是 ASCII `^1\d{10}$`，不 trim、不接受 `+86`、空格、短横线、字母、浮点或指数形式。前端使用 `type=tel inputMode=numeric maxLength=11 autoComplete=tel`。

注册在一个事务中创建 User、Wallet、INITIAL_GRANT、Session。内部 username 由后端随机生成，不包含手机号；唯一冲突重试。数据库唯一键保证同手机号并发最多一个成功且没有孤儿 Wallet/Grant/Session。

登录输入使用 `identifier/password`。优先按手机号查找；仅 `ALLOW_LEGACY_USERNAME_LOGIN=true` 时允许 usernameNormalized。该环境变量 development/test 可设 true，production 默认/强制 false。旧账号可用 `phoneNumber/currentPassword/operationId` 一次性绑定：验证当前密码、格式、唯一性，在事务内锁 User、写 RequestIdempotency 和 phone；相同操作回放，已绑定不同号码拒绝，普通用户不可改绑。

Seed 只在 development/test 给 admin/alice/bob/charlie/david 使用 `19900000001..005`；production 不创建固定账户。UI 只称“手机号登录”，明确无短信验证码、号码归属验证或实名认证。

公共/本人 DTO 永不返回完整 phoneNumber。Profile 只增加 `hasPhoneNumber` 和 `phoneMasked`（如 `138****8000`）。手机号不得进入 Seat、Room members、Table State、Socket、Hand/Replay、URL、Storage、PWA Cache、普通日志/错误、Wallet metadata 或 Paid Reveal metadata。

## 6. 历史、公开、整手查看与模拟补牌

### 6.1 主动公开

`hand:reveal-own-cards` 只接受 `roomId/handId/operationId/expectedStateVersion`，不接受 cards 或 target。服务器核对当前 `POST_HAND_REVIEW`、同一 review hand、deadline 未过和参与者身份，从 HandRecord 读取真实牌，在事务内写 `holeCardsPublic=true`、`holeCardsPublicReason=VOLUNTARY`、时间和 idempotency，然后更新 Snapshot 并向该桌参与者广播。它不改变 Wallet、Stack、结果或 Review deadline。

历史可见性扩展为 `OWN | PUBLIC_SHOWDOWN | PUBLIC_VOLUNTARY | PURCHASED | HIDDEN`；Eye 图标仅标识 `PUBLIC_VOLUNTARY`。

### 6.2 整手付费查看

Review 未结束时按钮隐藏且 API 稳定返回 `HAND_REVIEW_IN_PROGRESS`。Review 后，买方必须是实际参与者且至少存在一名仍隐藏的其他参与者。一次 operationId/事务锁 Wallet 和 hand，按冻结价格仅扣一次并创建 hand-level entitlement。重复购买或旧目标授权返回 alreadyOwned，不扣费。详情/回放按接收者在服务器投影所有隐藏牌；其他用户 DTO 不变。

### 6.3 发发看

仅完成手、board<5、当前用户为参与者可请求。事务先锁 hand/runout：存在则返回原结果；否则优先取结算时保存的 `remainingDeck` 前 N 张并标 `ORIGINAL_REMAINING_DECK`。旧手无可信牌堆时，从标准 52 张排除所有玩家真实 hole cards 与实际 board，再用 `node:crypto` CSPRNG 无放回抽取，标 `CSPRNG_LEGACY_FALLBACK`。结果 unique(handId)，所有参与者一致。

响应只含实际 board、模拟补牌和来源，不含被排除集合、hole cards 或剩余 deck。模拟结果不写 Hand board、不改赢家/结果/Wallet/Stack/统计/Replay；UI 明示“模拟补牌 / 非本局真实历史 / 不改变原结算”。

### 6.4 历史抽屉

桌内右侧抽屉宽约 86vw、max 420px，不推动舞台。一手一页，支持 first/previous/page-total/next/last；每名玩家一行显示标记、权限过滤的牌、逐街动作与净结果。历史 HTTP 仍为 no-store。抽屉只获取用户参与的手，不允许通过页码访问未参与牌局。

## 7. 房间列表与软归档

`GET /api/rooms` 默认只返回未归档 `OPEN/CLOSING`。`GET /api/rooms/closed` 使用 owner/user 绑定的 opaque cursor，按 `closedAt,id` 倒序。关闭列表不提供进入牌桌，只链接已有对局/手牌历史。

`POST /api/rooms/:roomId/archive` 要求 owner、CLOSED、无 Seat、无 ACTIVE GameSession、无未完成带出/活动 hand/recovery 任务；事务写 archivedAt/archivedByUserId。没有 delete。归档后只从两个房间列表隐藏，所有历史、Ledger、Paid Reveal、Runout 继续可授权访问。

## 8. 共享协议

Zod/TypeScript 完整增加：

- Socket commands：`table:start`、`hand:arm-next-action-autopilot`、`hand:cancel-next-action-autopilot`、`seat:reserve-away`、既有 `seat:return` 扩展、`hand:reveal-own-cards`。
- Projection：`tableRunState/tableStartedAt/canOwnerStart/nextActionAutopilotArmed/reservedAwayEndsAt/postHandReviewEndsAt/canRevealOwnCards/ownHandSummary/lastHandSummary/bustedRebuyRequired`。
- HTTP DTO：phone auth/bind、closed-room cursor page/archive、hand-level purchase、hypothetical runout。

新增核心 payload 不使用裸 `any` 或裸 `unknown`。隐藏牌继续采用 discriminated union；HIDDEN 分支必须是 `holeCards:null`，且不得进入 DOM/aria/data 属性。

## 9. 移动端 Web 结构

`TablePage` 只连接路由/store/socket并组合组件：

- `MobileTableStage`：固定 `100dvh`、overflow hidden、安全区、深绿渐变/暗角，无椭圆/圆桌主体。
- `TableTopBar`、`TableMenuPopover`、`TableCenterInfo`、`ConnectionBanner`。
- `SeatLayer`/`PlayerSeat`：显式 2–9 模板；视觉旋转固定 hero 底部，不改 seatIndex/Dealer/Blind/Odd Chip。
- `HeroHand`/`HandStrengthLabel`：自己的牌与权威牌型。
- `ActionPanel`/`RaiseSliderOverlay`：44px 触控、合法动作、整数 clamp、1/3/1/2/2/3/Pot/1.2Pot/All-in。
- `BuyInModal`/`BustedRebuyModal`、`PostHandReviewOverlay`/`VoluntaryRevealControl`。
- `HistoryDrawer`/`HandHistoryPager`/`HandAuditPage`/`HypotheticalRunoutView`。
- `ChatDrawer`：禁用输入/发送，仅“聊天功能暂未开放”，不新增 API/Socket/表。
- `CardAnimationCoordinator`：事件去重/排队、重连直达、visibility、reduced motion、timer/RAF 清理。
- `SoundManager`：用户手势后 Web Audio 合成 deal/board/chip/turn/win/menu；仅 localStorage 保存静音布尔值。

左右抽屉互斥。顶部右侧统一使用 `copyRoomInvite()`：中央邀请和加号复制名称、房间码、盲注、最大人数和当前站点链接，绝不复制密码/session/隐私；Clipboard 失败使用受控 textarea fallback 并显示结果。

中心区只容纳 board/pots/current bet/房间摘要/等待与开始。购物车仅展示真实 Wallet、带入入口和禁用“购买积分功能暂未开放”。桌面皮肤、精彩对局、发两次、保险均明确“暂未开放”，且不发送后端字段、不制造成功行为。

## 10. 牌型、倒计时、动画与声音

当前牌型由 `@paiyouju/poker-core` 的共享 helper 计算并由服务器只投影给本人。Preflop 区分对子、X高和同花起手（不把同花起手称为同花）；flop/turn/river 使用本人两张牌 + board 的最佳现有组合。

Deadline 保持服务器绝对时间。Hero 行动时环绕弃牌控件，其他 actor 环绕头像；显示组件局部 tick，不每秒重渲染整桌。重连/后台恢复不重置。

底牌动画每 handId 只播放一次，两轮、对手仅牌背、Hero 落位后翻面；board 按 flop 3/turn 1/river 1 翻牌。重连、初次恢复或页面后台直接同步权威终态；动画不能推迟 deadline。reduced-motion 直接完成。

Web Audio 不引入音频文件。后台不播放、做节流、失败静默降级，不在 localStorage 保存状态/身份/牌局。

## 11. 创建房间与其他移动页面

创建房间保持所有真实字段和校验，改为手机卡片/分组/底部主操作；加入禁用的“All-in 后发两次”“低水保险”并显示“暂未开放”，不进入请求。Straddle/Ante 不出现为真实能力。

认证页使用手机号 tel 输入；旧用户名入口只在服务端环境允许时提供清晰的“旧账号登录”切换。Profile 对无手机号旧账户显示一次绑定表单；已绑定只显示掩码，不提供更换。

## 12. 测试与验收设计

TDD 按域推进。服务器覆盖 owner start、人数中断、autopilot 零追加、reserved deadline/restart/exactly-once、review future/expired/CLOSING、voluntary reveal window/idempotency、busted rebuy、整手付费并发/旧授权、runout 排牌/持久化、archive 不删除、phone 格式/并发/隐私/legacy bind。

Web 覆盖 2–9 布局、目标 viewport 几何与 body scroll、长昵称/20亿、drawer 互斥、slider clamp/keyboard/state change、animation 去重/cleanup/reduced motion、sound opt-out/background、placeholders no request、hidden cards absent DOM。

Playwright E1–E13 覆盖等待与房主开始、移动桌、托管、保位、加注、发牌、牌型、Review/公开、整手偷看、发发看、busted、归档、手机号。Step 5/6 Snapshot、recovery process、settlement exactly-once、PostgreSQL concurrency、history/replay/PWA 必须回归。

重复稳定性按规格的 14 类至少各 10 次；每次不得有 flaky retry 掩盖。最后执行完整指定命令、Docker build/compose config、敏感搜索、`git diff --check`，仅全部 PASS 才创建指定 commit。

## 13. 安全失败原则

以下任一发生立即阻断 commit：隐藏牌或手机号泄漏、付费重复扣费、模拟补牌使用任一真实已发牌或改变结算、自动跟注越过绑定最高投入或绑定变化后仍行动、Review 前开新手、窗口外公开、归档删除历史、busted 继续收牌、重启丢 Reserved Away/Review、动画改变 deadline。
