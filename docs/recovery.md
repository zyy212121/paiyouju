# Recovery

## 启动顺序

Server 连接 PostgreSQL、记录安全版本信息，然后扫描：CLOSING Room、存在 TableSeat 的 Room、存在 TableSnapshot 的 Room。每桌独立恢复，失败只降级该桌。恢复结束前 readiness 为 starting；结束后 `/ready` 才可返回 200。

存在 Snapshot 时严格校验并重建 Runtime；旧占座房间没有 Snapshot 时只创建 IDLE Snapshot。`START_COUNTDOWN` 不恢复旧 Presence，回落 IDLE；真实用户重连后仍依据 `requiresManualStart`，不会仅凭人数自动发牌。

## 活动手与 Deadline

活动手恢复同一个 handId/handNumber、deck、私牌、board、pot、actions、actor、stacks、button、versions 和绝对 turnDeadlineAt。Future deadline 只调度剩余时间；Expired deadline 将原 identity 的 timeout 入单桌队列，Snapshot 锁与版本复核保证最多执行一次。

当前 Snapshot 同时恢复 Room `durationMinutes/expiresAt`、当前手冻结的 paid-reveal enabled/cost、一次性预操作、常驻托管、鱿鱼模式/额度/轮次/提示截止/待结算标志、每个 Seat 的鱿鱼标记/本轮资格/私人待亮牌槽、`RESERVED_AWAY` 绝对期限和 `POST_HAND_REVIEW` 绝对期限；Review payload 还恢复每名玩家最终公开的牌槽索引，旧整手公开集合安全转换为 `[0,1]`。Room 到期任务按原绝对时间恢复，不从重启时重新计时。

未来 reserved/review deadline 只调度剩余时间；已经过期则将同一 identity 的结束操作排入单桌队列。返回与到期、Review 结束与重启同时发生时由 Snapshot revision/状态复核线性化，最多完成一次。Review 恢复不延长期限，也不会在期限前开始下一手；到期且连续发牌条件成立时直接恢复为下一手 `PLAYING`，不插入客户端可见的第二段等待。

这些权威 timer 在 controller 明确 cancel/dispose 前保持 Node 事件循环引用，避免生产空闲期遗漏 Review/行动/房间到期。正常 SIGTERM 会先取消 timer，因此 referenced deadline 不会阻止优雅停机；启动时若发现已过期 Review，仍按原 handId/endsAt identity 入队并只提交一次。

Hand number 由 Room 行锁内的 `nextHandNumber` 分配。Migration 先从已有完成历史回填，开手事务也会在锁内校正陈旧计数器；重启不会仅依赖内存猜测下一号。

## Commit 边界故障

- Action commit 前退出：Receipt/Snapshot 都回滚，重启后原 action 可重新提交。
- Action commit 后 Runtime 更新/广播前退出：重启恢复已提交 Snapshot，相同 clientActionId 返回原 Receipt，不重复下注。
- Settlement commit 前退出：Hand/ledger/Snapshot 全回滚，恢复原活动手并可完成一次。
- Settlement commit 后 Runtime 更新/广播前退出：恢复终态 Snapshot；Hand/HAND_RESULT/会话关闭记录只有一份。

故障注入只允许 `NODE_ENV=test`，进程测试使用 exit code 86；真实 abrupt kill 使用强制终止，不运行应用 finally hook。

## Deferred 与 CLOSING

Snapshot 保存 `SIT_OUT_AFTER_HAND`、`LEAVE_AFTER_HAND`、`RESERVED_AWAY`、一次性预操作、常驻托管、鱿鱼状态和待亮牌槽；旧 Snapshot 中的 `BUSTED_WAITING_REBUY` 仅作兼容读取。恢复后完成同一手，分别转换为 SIT_OUT、自动释放 0 Stack Seat 或 exactly-once 关闭会话。CLOSING Room 在启动扫描中恢复：活动手继续到原结算及 Review；空闲 Seat 使用稳定 close operation key 记录最终点数并关闭；Seat 清空后 CLOSED。普通模式任何路径都不增加 Wallet；鱿鱼模式不足后手的自动补点只改变本桌点数与战绩。OPEN Room 若 `expiresAt` 已过，会先持久提交 CLOSING，绝不补发下一手。

## 损坏与隔离

测试覆盖未知 schema、重复牌、筹码不守恒、非法 actor/action、JSON schema 错误和关系不匹配。损坏桌进入持久 `RECOVERY_ERROR`，隐藏 hand，拒绝所有牌桌/房主写；Wallet、Seat、Ledger 不被自动修复。其他房间照常恢复。

管理员在先完成并校验数据库备份后，可以显式安全关闭无法恢复的遗留房间。该事务同时锁定 Room 与 Snapshot，以关系型数据库当前 `TableSeat.stack`/`GameSession.detachedStack` 作为最后可验证的会话后手，关闭活动 GameSession、删除 Seat，并用空座位 `CLOSED/READY` 快照替换损坏活动快照。未完成手牌被废止，不产生 HandRecord、不猜测结算、不指定赢家，也不修改 Wallet。只有 Snapshot/Runtime 仍同时处于恢复错误且命令为管理员 CLOSE 时可进入；Pause、Resume、房主写和普通运行时清理继续拒绝。

## R1–R12 映射

- R1/R2：Preflop / Flop 强制终止并恢复同一手。
- R3/R4：Future / Expired deadline。
- R5：Action commit 到 broadcast 的两个窗口及 receipt replay。
- R6：Settlement commit 到 broadcast 的两个窗口，exactly once。
- R7：Settlement commit 前退出并回滚。
- R8/R9：LEAVE_AFTER_HAND / SIT_OUT_AFTER_HAND。
- R10：活动 CLOSING 恢复。
- R11：损坏 Snapshot 安全停牌。
- R12：Legacy occupied room 建立 IDLE Snapshot。
- R13：Reserved Away future/expired deadline 与 exactly-once GameSession 关闭。
- R14：POST_HAND_REVIEW future/expired deadline，Review 前绝不发下一手。
- R15：Snapshot v1 安全读取并在后续提交升级为 v3。
- R16：Snapshot v2 按普通模式、无鱿鱼标记、无常驻托管安全读取，并在后续提交升级为 v3。

## 客户端

重连时清旧 legalActions、显示 reconnecting，自动 subscribe，并以 stateVersion/presenceVersion 接受 canonical state。扑克 action 绝不自动重放；超时/断线显示结果不确定并 request-state。安全持久命令只允许用户手动用同一 operationId 重试。

## Step 7 运维入口

`/admin/recovery` 展示数据库权威的 status、schema/revision、最近恢复时间和安全错误摘要。Revalidate 只读验证，Retry 只尝试正式 hydration；两者要求 ADMIN、operationId、reason 并写 AuditLog。PostgreSQL 不可用时 `/ready` 失败，恢复后自动重连并重新验证；任何错误都不自动重置 Snapshot、牌或 Stack。
