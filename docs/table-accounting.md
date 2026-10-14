# Table Accounting

## 账户边界与独立记账

`Wallet` 是虚拟钻石余额；`GameSession` 记录用户在一个房间完整生命周期内的牌桌点数。占座时后手位于 `TableSeat.stack`，站起时移到 `GameSession.detachedStack`。两者完全独立，不互换、不兑回。

```text
首次坐下/补点：Wallet 不变 ⇔ Table Stack +amount
站起/退出：Wallet 不变     ⇔ 后手在 Seat 与 GameSession 间移动
房间关闭：Wallet 不变      ⇔ 记录最终 Stack 后结束房间点数生命周期
单手输赢：Wallet 不变  ⇔ Σ HAND_RESULT = 0
短牌结算后规范：Wallet 不变 ⇔ 低于下限自动 BUY_IN / 高于上限自动 CASH_OUT
每手开局：Wallet -10/参与者 ⇔ 系统消耗（与 Hand/Snapshot 同事务）
整手看牌：Wallet -50    ⇔ 系统消耗（不进入 Table Stack 或他人 Wallet）
```

所有金额为整数 `0..2_000_000_000`。普通/鱿鱼 Room Initial Buy-in、短牌 Room 后手上下限、当前整桌在座与离座点数之和、单个 GameSession 累计领取/退回量和个人 Wallet 分别受应用检查与数据库约束保护。

## 坐下与追加买入

事务按确定顺序锁 Room，并按状态锁 Seat 或离座 GameSession，验证 RoomMember、OPEN、seat range/空闲、用户未双座、点数范围和当前整桌上限，再创建/更新 GameSession、Seat 与独立 `TableStackLedgerEntry`；涉及座位状态时在同一事务推进 Snapshot。PostgreSQL partial unique 保证一个用户在一个房间最多有一个 ACTIVE GameSession。Wallet 只用于返回当前钻石显示值，不参与点数金额校验或更新；0 钻石也可正常坐下和补点。

`RequestIdempotency` 以 `(scope,actorId,operationId)` 保存 hash 与完整 response。服务在资源线性化锁后再次查询回执，因此两个独立连接同 key 等待后都得到同一个结果，不会因首次操作已修改资源而返回错误业务冲突。

首次坐下强制使用房间 `initialBuyIn`；短牌房间把该兼容字段固定为后手下限。客户端携带的首次金额被忽略，只写一笔 BUY_IN。追加只允许两手之间或 SIT_OUT；坐下时增加 Seat stack，站起时增加同一活动 GameSession 的 `detachedStack`。普通/鱿鱼追加为正整数且单次不超过 Initial Buy-in；短牌追加后的后手不得超过上限。当前手已 fold 但未结束仍拒绝。追加后 GameSession totalBuyIn、整桌在座与离座点数总额均不得越界。

Web 点击空座时不弹首次买入表单。没有活动会话时，普通/鱿鱼桌领取 Initial Buy-in，短牌桌领取后手下限；已有离座会话时把 `detachedStack` 原样恢复到所选 Seat，并允许换座。恢复不写 BUY_IN、不增加 `totalBuyIn`、不创建新 GameSession。

旧版本曾把每次重坐建成新 GameSession。为保留牌局审计且不破坏性改账，排行榜和个人累计按每个旧 Session 的首条 Table BUY_IN 识别重复座位赠予：同一用户/房间只保留第一次，后续 Session 中额外的主动补点仍计入总带入。新版本每房间只有一个 ACTIVE GameSession，不需要这层兼容扣除。

## 开手钻石收费

开手在 Room 行锁下复核参与 Seat 和每位参与者的 10 钻石开局费。随后按稳定 userId 顺序锁 Wallet，在创建 Hand/Snapshot 的同一事务中写 `HAND_ENTRY_FEE`；任一余额不足或写入失败都会让整手和全部扣款一起回滚，牌桌回到 IDLE。管理员可在玩家持有 Seat 时调整钻石，因为调整不会改变 Table Stack。

参与者集合冻结为当时全部 `ACTIVE/stack>0` Seat，再执行最终数据库 guard；连接中的 Socket 仍逐个复核 Session 以保护私密广播，但断线不会缩小参与者集合。断线 Seat 继续使用既有 GameSession/后手并由服务端让或弃托管。

## Sit-out、Return 与离桌

- 空闲 SIT_OUT 立即持久化；当前手参与者写 `SIT_OUT_AFTER_HAND`。
- RETURN 只允许 OPEN、两手之间、stack>0，并改回 ACTIVE。
- 空闲 leave 原子保存 `detachedStack` 并释放 Seat；当前手参与者写 `LEAVE_AFTER_HAND`，结算后执行相同保存。
- 0 stack 离桌同样保留 ACTIVE GameSession 与 `detachedStack=0`，不写无意义 Ledger；重坐后进入 `BUSTED_WAITING_REBUY` 供玩家补点。
- `RESERVED_AWAY` 保留 Seat/Stack；60 秒到期在空闲时保存后手并释放 Seat，在当前手中转待结算保存。
- 结算后 0 stack 在 Review 清理阶段自动释放 Seat并保留会话，不显示强制买入提示。

每次操作和对应 Snapshot 同事务提交。Web 在结果未知时保留原 operationId 供用户手动精确重试。

## 完成手与 Exactly-once

每名参与者的 HAND_RESULT：

```text
signedAmount = endingStack - startingStack
stackAfter = stackBefore + signedAmount
idempotencyKey = hand-result:<handId>:<userId>
walletLedgerEntryId = null
```

完成事务创建 Hand/Player/Action/Pot，锁定开局 Seat stack，写最终 Seat/版本、HAND_RESULT、`remainingDeck`、唯一五张 `fullBoard` 和 4 秒 Review 状态。短牌随后在同一事务内把未离桌参与者后手规范到房间上下限：补点写 Hand 关联 BUY_IN 并增加 `totalBuyIn`，退点写 Hand 关联 CASH_OUT 并增加 `totalCashOut`；HAND_RESULT 本身仍严格零和。最后处理 deferred 状态并提交 Review Snapshot。Review 结束后自动把普通模式的 0 Stack 或待离桌 Seat 转为离座后手；满足连续发牌条件时直接创建下一手，否则处理等待房主或 CLOSING 最终结算。任何一步失败全部回滚。

重复同一 `handId` 会加载既有 Hand、players、actions、pots、HAND_RESULT，比较 canonical settlement fingerprint 和所有结果；完全相同才返回成功，任何差异都拒绝。独立数据库客户端并发完成同一行动已验证只有一个 Receipt、一个 Hand 和一组 HAND_RESULT。

## 结算后钻石看牌

整手看牌不是牌桌筹码转换。它只在 Hand 已完整结算且 Review 结束后，以该手开局时冻结的 cost 为准；新手牌固定 50 钻石，旧完成手保留历史冻结值。买方必须有该手 `HandPlayerRecord`、至少一名他人仍隐藏且 Wallet 足额。事务锁 Wallet 后一次写入负数 `PAID_CARD_REVEAL` Wallet Ledger、`PaidHandRevealPurchase` 和 RequestIdempotency 精确响应；复合外键校验 user/room/hand/金额/type 完全一致。

业务唯一键 `(buyerUserId,handId)` 防止不同 operation 重复购买；任一旧 `(buyerUserId,handId,targetUserId)` 授权也视为已拥有整手。相同 operation/same payload 精确 replay，不同 payload 冲突。费用从系统总 Wallet 钻石中消耗，不写 TableStackLedgerEntry、不修改 Seat/GameSession/HandPlayer、也不广播。

发发看与行动加时同样只消耗 Wallet：前者由每位房间成员固定支付 10 钻石建立个人购买授权并共享该手唯一补牌，后者由当前行动者在最后 3 秒固定支付 10 钻石延长基础行动时间的一半。两者都写唯一负向 Ledger、余额前后值、业务关联和幂等回执，不进入 Table Stack 或其他玩家账户。

## Room CLOSING

无活动手时按稳定 session 顺序结算所有 ACTIVE GameSession，包括仍在 Seat 的 stack 和已经站起的 `detachedStack`；活动手在 Review 结束后进入同一流程。非零最终后手各写一笔幂等 Table CASH_OUT，并追加到可能已包含短牌每手上限退点的 `totalCashOut`，随后关闭会话并清理 Seat/Snapshot；0 后手直接关闭而不写零金额流水。Room 只有在全部活动会话都关闭后才 CLOSED。close 与点数领取锁同一 Room，结果只能是“点数领取先提交后会话被完整关闭”或“close 先提交而领取被拒绝”，不会留下孤儿 Seat/Stack；两条路径都不修改 Wallet。

## 30 天记录保留

账户和 Wallet 当前余额持续保留。已关闭 Room 及其 GameSession、Hand、玩家/行动/底池、Table Stack Ledger、钻石购买授权和关联审计最多保留 30 天；过期 Session、通用 AuditLog、RequestIdempotency 和 Wallet Ledger 历史同样清理。服务启动时执行一次，并每 6 小时重复。Wallet Ledger 允许删除过期前缀，`Wallet.balance/version` 继续作为当前余额权威状态。

## PostgreSQL 真实竞争

Docker 测试池 `DATABASE_POOL_MAX=10`，使用两个独立 Prisma clients。专项测试覆盖：两个 -80 debit 争抢 100 余额、八个并发正向更新的版本/序列、相同幂等 key、`SELECT FOR UPDATE` 阻塞、同 Seat 抢占、同用户双座、close vs buy-in、重复 Action/Settlement。证据详见 [PostgreSQL Concurrency](postgres-concurrency.md)。

## Step 7 管理钻石与费用审计

`ADMIN_ADJUSTMENT` 只能通过 Wallet Service，在目标 Wallet 行锁内追加 Ledger、更新 version/sequence 并写 AuditLog；余额保持 `0..2_000_000_000`，不触碰 Table Stack。`audit:data` 校验每手开局 10、发发看 10、加时 10，以及新手牌偷偷看 50/旧手冻结历史值；发现不一致只报警，不自动改账。
