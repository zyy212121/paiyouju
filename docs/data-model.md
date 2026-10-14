# Step 6.5 数据模型与不变量

## Migration 顺序

1. `20260813075720_step3_foundation`
2. `20260813090000_ledger_wallet_owner`
3. `20260813095436_step4_authoritative_tables`
4. `20260813214900_step4_legacy_room_points_normalization`
5. `20260813215000_step4_table_points_guard`
6. `20260813223000_step4_relational_guards`
7. `20260813224500_step4_relational_guard_fixes`
8. `20260813225500_step4_hand_result_participant_guard`
9. `20260814013000_step5_durable_table_recovery`
10. `20260820090000_step6_history_paid_reveal`
11. `20260824120000_step6_5_mobile_lifecycle`
12. `20260824170000_ui_issue_fixes`
13. `20260824200000_per_card_voluntary_reveal`
14. `20260824203000_next_action_auto_call`
15. `20260825030000_room_clock_show_fees`
16. `20260825033000_existing_room_clock_compat`
17. `20260825100000_step7_admin_audit`
18. `20260826010000_step8_action_time_constraint_fix`
19. `20260827010000_diamond_fixed_fees`
20. `20260827190000_decouple_table_points_retention`
21. `20260827230000_table_diagnostic_trace`
22. `20260828010000_room_stack_continuity`
23. `20260828190000_spectator_history_and_table_resumption`
24. `20260828191000_room_member_history_entitlements`
25. `20260829010000_admin_cleanup_fixed_bots_local_logs`
26. `20260830100000_squid_mode_and_trusteeship`
27. `20260830101000_squid_settlement_ledger_guard`
28. `20260830130000_run_it_twice`
29. `20260830170000_short_deck_mode_enum`
30. `20260830171000_short_deck_room_constraints`
31. `20260830172000_short_deck_stack_ledger`
32. `20260830233000_user_avatar_library`
33. `20260831030000_bomb_pot_mode_enum`
34. `20260831031000_bomb_pot_mode_rules`

旧 migration 不编辑、不合并；第 15 个 migration 新增房间绝对截止时间、待亮牌槽、发发看个人购买和两类费用流水；第 16 个只为升级前仍 OPEN 的旧房间从部署时补足一个默认/既有配置周期；第 17/18 个分别增加管理审计与行动时间约束修复；第 19 个增加 `HAND_ENTRY_FEE` 并把活动 Room 的偷偷看费率统一为 50 钻石；第 20 个允许新 Table BUY_IN/CASH_OUT 作为不关联 Wallet 的纯房间点数记录，并增加 30 天保留任务使用的时间索引；第 21 个曾增加数据库完整追踪；第 22 个增加房间 Initial Buy-in、离座后手和每用户/房间唯一活动会话约束；第 23 个增加 `LEAVE_AFTER_HAND` 自动行动原因；第 24 个移除三条过时的“购买者必须参与该手”外键；第 25 个把完整诊断迁出 PostgreSQL并增加固定机器人租约约束；第 26/27 个增加鱿鱼模式、常驻托管和结算账本保护；第 28 个增加普通模式发两次配置、投票幂等 scope、两副牌面及逐副底池记录；第 29–31 个依次增加短牌模式枚举、短牌房间上下限约束，以及允许短牌每手结算关联的 BUY_IN/CASH_OUT 账本；第 32 个增加受固定头像库约束的 `User.avatarId`，并按 User ID 确定性回填旧账户；第 33/34 个分别追加暴击模式枚举，以及房间频率/盲注/绝对截止和完成手实际暴击盲注字段与约束。所有钻石与牌桌点数使用 PostgreSQL `INTEGER`，应用与数据库共同限制 `0..2_000_000_000`。

## Wallet、Seat 与历史关系

`Wallet` 是钻石余额；`GameSession` 是用户在一个房间完整生命周期内唯一的点数账户。入座时后手位于 `TableSeat.stack`，站起后位于 `GameSession.detachedStack`，两者不能重复计数。新 `TableStackLedgerEntry` 的 BUY_IN/CASH_OUT 不关联 `WalletLedgerEntry`；迁移前已有的成对记录仍由复合外键保护。`HAND_RESULT` 必须复合关联真实 `HandPlayerRecord`，不能挂到另一房间或未参与者。短牌房间在每手 `HAND_RESULT` 后、进入下一手生命周期前，把参与者后手低于下限的差额记为关联该手的 BUY_IN，把高于上限的差额记为关联该手的 CASH_OUT；同步累加 `GameSession.totalBuyIn/totalCashOut`，因此活动战绩和最终战绩使用同一套净输赢口径。

关键唯一/关系约束：

- Session：PostgreSQL partial unique 保证每个 `(roomId,userId)` 最多一个 ACTIVE GameSession。
- Seat：`(roomId,seatIndex)`、`(roomId,userId)`、`gameSessionId` 唯一；Seat 与 GameSession 的 room/user 一致，seatIndex 可在重新入座时更新。
- Hand：`(roomId,handNumber)` 唯一。
- Hand Player：每 hand 的 user/seat 唯一，且与 Hand/Room/GameSession/User 一致。
- Hand Action：`(handId,sequence)`、`(handId,userId,clientActionId)` 唯一，actor 必须是该手对应 Seat 玩家。
- Ledger：每会话 sequence 唯一，全局 idempotency key 唯一，before/after 等式由 CHECK 保护。

守恒式：

```text
Wallet_after = Wallet_before - 本次明确钻石费用 + 管理员调整
Table Stack_after = Table Stack_before + 本次房间点数变化

sum(hand startingStack) = sum(hand endingStack)
sum(HAND_RESULT signedAmount) = 0
```

首次坐下/补点事务锁 Room/Seat；整桌上限同时统计在座 stack 与离座 `detachedStack`，单次 GameSession 累计领取也不超过 20 亿，不读取 Wallet 余额作为额度。重新入座只移动保存后手，不写第二笔 BUY_IN。开手事务才锁参与者 Wallet 并收取每人 10 钻石开局费。

## TableSnapshot

一桌至多一行：

| 字段 | 语义 |
| --- | --- |
| `roomId` | 唯一 Room 外键 |
| `schemaVersion` | 当前写入 6；健康 v1–v5 可兼容读取 |
| `stateVersion` | 客户端可见业务版本 |
| `snapshotRevision` | 数据库 CAS revision |
| `runtimeStatus` | IDLE/COUNTDOWN/PLAYING/POST_HAND_REVIEW/PAUSED/CLOSING/错误/CLOSED |
| `activeHandId/Number` | 成对为空或成对存在 |
| `turnDeadlineAt/startDeadlineAt` | 绝对 deadline |
| `payload` | 完整内部权威 JSONB |
| `recoveryStatus` | PENDING/READY/ERROR |
| `lastRecoveryError` | 仅 ERROR 时存在的安全摘要 |

Payload 包含 Room 配置/手动开始/牌型变体/鱿鱼轮次/暴击频率、倍数与下一截止/发两次开关、Seat/session 引用、stack/playStatus/version、一次性预操作/常驻托管/鱿鱼标记/本轮资格/保位期限、hand number/button、当前手及可选实际暴击盲注、完整 deck、玩家私牌、board、pots、actions、settlement、发两次投票与两副牌面、actor、Review 和 deadlines。它必须通过严格 Zod、数据库关系匹配、Poker Core invariant、标准模式 52 张或短牌模式 36 张牌的唯一性与筹码守恒；不是网络协议。

`snapshotRevision >= 0`，更新使用 `WHERE roomId=? AND snapshotRevision=?` 后原子 `+1`。未命中是 `SNAPSHOT_CONFLICT`，调用方不得广播候选状态。

## TableActionReceipt

字段包括 room/hand/user/clientActionId、64 字符请求 fingerprint、action type、resulting stateVersion、result code 和严格 typed result JSON。唯一键 `(roomId,userId,clientActionId)`：

- 相同 ID + 相同 fingerprint：返回首次持久结果，`alreadyProcessed=true`；
- 相同 ID + 不同 fingerprint：`ACTION_IDEMPOTENCY_CONFLICT`；
- 首次 action 的 Receipt、Snapshot 和可能发生的 completed-hand settlement 在同一事务中。

Receipt 不外键到 `HandRecord`，因为合法回执会在手仍进行、完成历史尚不存在时创建；它仍受 Room/User 外键和 handId 索引保护。

## Hand Number 与完成手

`Room.nextHandNumber` 默认 1、必须为正。Step 5 Migration 对已有 Room 按 `MAX(HandRecord.handNumber)+1` 回填。开手事务先锁 Room，将计数器与该 Room 的历史最大值校正后分配，再一次写入下一值；正常路径依靠单调计数器，升级、重启和并发下都不重复。

完成手事务创建 Hand/Player/Action/Pot，写所有 HAND_RESULT 与 Seat 最终 stack，处理显式 deferred sit-out/leave 与 CLOSING 会话关闭，再写无 active hand 的 Snapshot。断线本身不改变 Seat 状态。重复 `handId` 只有 settlement fingerprint 与全部既有结果完全相同时才作为成功返回，否则进入冲突/持久化错误。

发两次完成手仍只有一个权威 `HandRecord`，`runoutCount=2` 且 `runoutVotes` 保存协商选择；`HandRunoutRecord(handId,runoutIndex)` 保存两副各自五张 Board，`HandRunoutPotRecord(handId,runoutIndex,potIndex)` 保存逐副整数底池、资格、赢家和奇数筹码。原 `HandPotRecord` 保存两副合并后的整手结算供账务与兼容链路使用。每个原始底池第一副为 `ceil(amount/2)`、第二副为余数，两副逐池之和、逐玩家总派奖和最终后手必须与原 Hand 完全守恒。

新房间强制启用整手看牌并固定 `paidCardRevealCost=50` 钻石；开手 Snapshot 冻结该值，结算时原样写入 `HandRecord`。旧牌局仍按自身冻结配置处理，不追溯收费。

## Step 6.5 生命周期字段

- `User.phoneNumber` 可空、唯一且由数据库 CHECK 限定为 11 位；旧 User 保持 NULL。
- `User.avatarId` 必须属于项目内置的 16 个 `avatar-01..avatar-16`；新注册由服务端随机分配，旧账户由 migration 稳定回填，个人资料只能选择该白名单且没有上传字段。
- `Room.requiresManualStart/tableStartedAt/archivedAt/archivedByUserId` 分离运行计时与列表归档。
- `Room.durationMinutes/expiresAt` 保存 30–180 分钟的分档配置与从创建时计算的绝对截止时间；数据库约束行动时间为 10–45 秒且每 5 秒一档、房间时长每 30 分钟一档。
- `TableSeat.nextActionAutopilotArmed/nextActionAutoCallCurrentBet` 保存互斥的让或弃/自动跟注状态；自动跟注绑定武装时的本街最高投入，数据库 CHECK 禁止在未武装时残留绑定值。`reservedAwayEndsAt` 与 `RESERVED_AWAY` 状态有成对约束；`BUSTED_WAITING_REBUY` 仅为旧 Snapshot/协议兼容值，新结算不再产生该状态。
- `TableSeat.pendingShowCardIndices` 保存 active hand 中仅本人可见、可反悔的待亮牌槽；结算复制到 HandPlayerRecord 后立即清空。
- `Room.specialMode` 保存 `NORMAL/SQUID/SHORT_DECK/BOMB_POT`；`squidStake/squidRoundNumber/squidRoundGraceEndsAt/squidSettlementPending` 只保存鱿鱼轮次状态；`bombPotIntervalMinutes/bombPotBlindMultiplier/bombPotNextAt` 只保存暴击配置和绝对截止。数据库约束所有特殊模式与发两次互斥，暴击频率只能为 1 分钟或 5–30 分钟的 5 分钟档、盲注只能为 1–10 BB；短牌以 `minBuyIn/maxBuyIn` 表达每手结算后的后手下限/上限，兼容字段 `initialBuyIn` 固定等于短牌下限。
- `TableSeat.squidMarked/squidRoundParticipant/trusteeshipEnabled` 保存鱿鱼标记、本轮结算资格和常驻让或弃；数据库约束标记者必须属于本轮参与者。
- `TableStackLedgerEntry.type=SQUID_SETTLEMENT` 记录逐人正负点数，稳定 operation key 防重；账本不关联 Wallet，数据审计按 operation 检查零和。
- `HandRecord.reviewEndsAt/remainingDeck/fullBoard` 保存观察截止、结算后可信未使用牌序列和该手唯一五张完整公共牌。`fullBoard` 在新记录中固定 5 张，实际 `board` 必须是其前缀。
- `HandRecord.bombPotBlindAmount` 只在暴击手保存该手实际每人目标强制投入；历史回放据此生成全员强制投入并从 Flop 开始的事件序列。
- `HandActionRecord.automaticReason` 区分超时、让或弃、绑定自动跟注、暂离和本手后站起；automatic 与 reason 受 CHECK 约束。
- `HandPlayerRecord.holeCardsPublicReason/voluntarilyRevealedAt/voluntarilyRevealedCardIndices` 区分 Showdown 与不可撤销的逐张主动公开。单张公开时 `holeCardsPublic=false` 且索引数组只含该槽；两张都公开后才置为完整公开。迁移把旧的整手主动公开记录回填为 `[0,1]`。

## 历史索引与看牌/模拟补牌

- `GameSession(userId,startedAt,id)` 支持本人对局倒序 keyset 分页。
- `HandPlayerRecord(userId,createdAt,handId)` 支持本人手牌倒序 keyset 分页；查询不需要先扫描全桌 Hand。
- `HandRecord(roomId,finishedAt,id)` 和 `HandPlayerRecord(userId,handId)` 支持房间时间过滤、授权详情与参与关系。

`PaidCardReveal` 同时关联 Hand/Room、买方/目标 User、双方对应 `HandPlayerRecord` 和唯一 `WalletLedgerEntry`。数据库约束保证：买方不等于目标、两者都实际参加该手、`cost > 0`、Wallet 类型为 `PAID_CARD_REVEAL`、扣款金额恰为 `-cost`，且 transfer 的 user/room/hand 完全一致。

业务唯一键是 `(buyerUserId,handId,targetUserId)`；`RequestIdempotency(PAID_CARD_REVEAL,actorId,key)` 保存请求 fingerprint 与精确响应。服务在同一 PostgreSQL 事务中锁 Wallet，复核已结算牌局的冻结配置与参与关系，写 Wallet/Ledger/授权/回执；相同目标的不同 operation 并发最多扣一次，重复 operation 返回首次结果。费用只销毁 Wallet 钻石，不进入 Table Stack 或其他账户。

新 UI 使用 `PaidHandRevealPurchase`，唯一 `(buyerUserId,handId)`；Ledger/金额/Room/Hand 与买方 User 由外键闭合，服务事务额外验证当前 `RoomMember`。任一旧 `PaidCardReveal` 也视为该买方拥有整手授权，因此迁移不改旧记录且不重复扣费。

`HandHypotheticalRunout` 对 `handId` 唯一。新 Hand 的结果直接使用 `fullBoard` 中尚未公开的后缀；旧记录缺少 `fullBoard` 时才使用 `remainingDeck` 或排除全部真实牌后的 CSPRNG fallback。`HypotheticalRunoutPurchase` 对 `(buyerUserId,handId)` 唯一，并通过外键闭合 Wallet 流水、room/hand、类型和 `-cost`，服务事务验证当前 `RoomMember`；全局结果唯一，但历史详情只向已购买者返回。

行动加时在活动手尚未创建 `HandRecord` 时发生，因此 `ACTION_TIME_EXTENSION` Wallet 流水先以 metadata 保存 handId，并关联 Room/GameSession；结算事务创建 Hand 后再补写 `relatedHandId`。扣费、deadline Snapshot 和幂等回执仍在一个事务提交。

## 保留和排除

TableSeat 在离桌后删除；Room 软归档只影响列表显示。账户和 Wallet 当前余额持续保留；CLOSED Room 及其 GameSession、Ledger、Hand/Player/Action/Pot、Action Receipt、两代看牌授权、模拟补牌和诊断轨迹在关闭 30 天后物理删除。过期 Session、AuditLog、RequestIdempotency、Wallet Ledger 和独立诊断轨迹历史也按 30 天上限清理；清理不会删除活动 Room、User 或 Wallet 当前状态。

## 压力测试诊断轨迹

第 25 条 Migration 删除旧 `ServerFeatureFlag`、`TableDiagnosticTrace` 及 PostgreSQL Trigger。完整诊断改为应用进程写入仓库内 `room-logs/` 的 NDJSON，只记录 `owner.role=ADMIN` 的房间；普通用户创建的房间不生成诊断文件。PostgreSQL 继续保存业务权威 Snapshot、Hand、Action、Pot 和 Ledger，但不保存完整诊断副本。`User.isTestBot/testBotOrdinal/testBotLeaseId/testBotLeaseExpiresAt` 固定描述 9 个开发机器人账号及服务器租约。

## Step 7 AuditLog 与管理员幂等

第 17 条 append-only Migration 新增 `AuditLog` 和管理员 operation 类型索引。AuditLog 记录 actor/role/action/target/room/hand/request/operation/reason、安全 IP/UA 摘要、白名单 metadata 与 createdAt；不提供修改/删除 API。管理员 Adjustment 复用 Wallet、WalletLedgerEntry 与 RequestIdempotency：目标 Wallet 行锁、余额边界、Ledger、AuditLog 和精确响应在同一事务中提交，不引入可直接改 balance 的旁路。
