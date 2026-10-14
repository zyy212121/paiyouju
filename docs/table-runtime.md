# Table Runtime

## 生命周期

```text
IDLE → START_COUNTDOWN → PLAYING → POST_HAND_REVIEW → PLAYING / IDLE
  ├──────────────→ PAUSED
  ├──────────────→ CLOSING ───────────────→ CLOSED
  ├──────────────→ PERSISTENCE_ERROR
  └──────────────→ RECOVERY_ERROR
```

一个应用进程内，一个 Room 最多一个 `TableRuntime`。Runtime 持有已提交 Snapshot 的内存镜像、Presence、Timer 句柄和每桌 `SerializedQueue`；数据库 Snapshot 才是重启边界上的权威。

## Hydration 与订阅

首次加载在队列内读取 Room、TableSeat 和 TableSnapshot。Snapshot 不存在的旧占座房间只创建一个 IDLE 初始 Snapshot，不猜测遗失的活动手。订阅在异步 membership/hydration 后再次校验 Socket connected 与 Session active，再原子 join room、登记 subscribedRooms 和 Presence，避免断线中途留下 ghost presence。

Presence 是 `userId → Set<socketId>`；多标签任一在线即 connected。Presence 变更与开手串行；Session logout/revoke/expiry 会断开所有对应 Socket。广播前还会重验 Session，防止静默失效连接继续收到私牌。

## 开局与计时

资格是 Room OPEN、未暂停、无当前手/Review、至少两名 `ACTIVE/stack>0` 玩家；断线不降低资格。只有首次开局要求房主通过 `table:start` 原子清除 `requiresManualStart`。首次开始后真实座位状态导致人数不足时会安排单一 30 秒复核任务；人数恢复时自动持久化 `START_COUNTDOWN` 与绝对开始期限。房主暂停取消自动复核，恢复仍由房主命令控制。倒计时到期：

1. 清理仍连接但 Session 已失效的 Socket，不删除其牌桌 Seat；
2. 锁 Room 并最终确认 OPEN/unpaused 与资金最坏上限；
3. 保留冻结的全部 `ACTIVE/stack>0` 候选，断线者进入临时让或弃托管；
4. Room 行锁内分配 nextHandNumber、启动 Poker Core、提交 Snapshot；
5. 更新 Runtime 并按接收者广播。

每个行动 deadline 是绝对时间。Timer identity 包含 handId、Poker version、actor 和 deadline；回调排入队列后再复核。`now > deadline` 的用户行动即使 timer callback 延迟也拒绝；到达边界时按队列先后线性化。最后 3 秒当前行动者可购买加时；事务扣除固定 10 Wallet 钻石并把同一 deadline 延后基础行动时间的一半，随后控制器取消旧 timer 并按新 deadline 重排。

开手还把 Room 当时的 `paidCardRevealEnabled/paidCardRevealCost` 写入当前手 Runtime/Snapshot。之后 Room 配置变化不影响进行中手；结算事务把同一冻结值写入 HandRecord，使历史购买规则不依赖当前 Room。

## 状态转换

玩家 action 先由 Poker Core 应用并校验，构造不可变候选状态；Receipt、Snapshot、以及可能完成的 Hand settlement 在一个 PostgreSQL 事务提交。只有 commit 返回后才 `applyRuntimeAuthority` 和 broadcast。

Timeout 使用相同 transition service，但没有 clientActionId；同一旧 deadline 在新版 Snapshot 下变成 no-op。Countdown、pause/resume、选座、买入、sit-out/return/leave 同样把 Snapshot 与对应业务写放进一个事务。

等待预操作、保位离桌和本手后站起也只在 transition service 内执行。`CHECK_OR_FOLD`、保位离桌与 `LEAVE_AFTER_HAND` 均为合法 Check，否则 Fold；`CALL` 只在武装时的本街最高投入仍完全一致时跟注一次，最高投入变化会先清除绑定而不自动行动。四者写入各自 `automaticReason`。active hand 中本人可切换每张底牌的私人待亮状态；settlement 在同一事务冻结该选择并进入 4 秒 `POST_HAND_REVIEW`，Review 内仍允许逐张添加或撤回非强制展示。deadline 到期后才清理 Review、自动释放 0 Stack Seat、处理 closing 并判断连续发牌或人数不足复核；连续发牌直接进入新的 `PLAYING`，不再产生额外 `START_COUNTDOWN` 投影。

## 错误状态

- `PERSISTENCE_ERROR`：当前进程无法可靠提交候选转换；取消 timer，冻结新写，不广播未提交 board/winners/stacks。完全相同的既有 durable operation 可以读取数据库回执。
- `RECOVERY_ERROR`：Snapshot 版本、结构、牌、不变量、关系或守恒失败；持久标记 ERROR，隐藏 hand，拒绝 Socket 和 HTTP 状态写。不会自动重置或发新手。

本阶段无管理员修复/跳过接口；需要离线分析数据库备份与安全摘要。

## Room CLOSING

空闲 close 在同桌队列以稳定 operation ID 依次关闭 Seat/GameSession，每次和 Snapshot 同事务；Seat 清空后提交 CLOSED Snapshot。活动手继续接收合法 action，完成事务先写 Hand/HAND_RESULT 并完整经历 Review，再关闭全部 Seat、GameSession 和 Room。全流程不把 Table Stack 转入 Wallet。重启会扫描 CLOSING 并恢复此流程；重复通知/稳定 key 不会重复关闭。之后的 archive 只影响列表，关闭 30 天后的物理清理由独立保留任务执行。

Room 创建时同时持久化 `durationMinutes/expiresAt`。控制器按绝对 `expiresAt` 调度到期命令；OPEN 空闲桌到期后拒绝开手并进入关闭分支，活动手只把 Room 标记为 CLOSING，继续当前手且绝不安排下一手。该 deadline 随 Snapshot/Room 恢复，不因进程重启重置。

## Recovery

启动严格恢复当前 hand、deck、私牌、board、pot、actions、actor、button、stacks、版本、预操作/常驻托管、鱿鱼轮次/标记、保位与原 deadline。Future action/reserved/review/squid-grace deadline 重新调度剩余时间；Expired deadline 入队执行一次相应处理。`START_COUNTDOWN` 因 Presence 不持久化而安全回落 IDLE，真实订阅后仍遵循 `requiresManualStart`，不会擅自开局。

## Cleanup 与 shutdown

Runtime 可驱逐条件：

- CLOSED、无 Seat/Presence/currentHand/transient timer；或
- OPEN、无 Seat/Presence/currentHand/countdown/timer，且不是错误状态。

驱逐会 dispose controller、取消 timer、清 action cache/presence、移除 manager 引用。活动手和 transient deadline 即使暂时无人连接也不能被驱逐。

Shutdown 先拒绝新命令并 dispose 全部控制器，再等待所有现有 queue idle；dispose 后的 in-flight action 不会重建 timer，停机开始后也不能创建新 controller。随后关闭 Socket、Runtime、HTTP 和数据库。

## Step 7 管理投影

活动牌桌管理只读取 Room/Hand/Seat/Runtime 的安全摘要（street、actor、deadline、expiresAt、状态与 revision），绝不复用包含 deck/私牌的内部 Runtime 或 Snapshot 对象。管理员 PAUSE/RESUME/CLOSE 进入原房间串行队列和生命周期事务；没有修改牌局状态的通用管理命令。
