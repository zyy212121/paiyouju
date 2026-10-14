# Table Snapshots

## 权威与版本

`TableSnapshot` 是每个 Room 最后一次数据库已提交牌桌状态。当前 `TABLE_SNAPSHOT_SCHEMA_VERSION = 6`；解码器显式兼容健康 v1–v5，并在下一次成功提交写成 v6，未知版本仍拒绝。`stateVersion` 面向业务/客户端单调递增；`snapshotRevision` 只用于 PostgreSQL compare-and-set。

更新在事务中先锁 Snapshot，并执行 `WHERE roomId AND snapshotRevision=expected` 的 CAS。成功 revision +1；失败返回 `SNAPSHOT_CONFLICT`，候选 Runtime 不应用、不广播。服务器随后在同一牌桌串行队列中重新读取并验证数据库权威 Snapshot，替换旧 Runtime、清除旧 action cache、恢复 countdown/turn timer；若重载失败则隔离为 `RECOVERY_ERROR`。冲突命令不自动重放，Ack 携带最新用户投影供客户端重新判断。

## Payload

Payload 是严格 JSONB，包含：

- Room 配置、状态、`durationMinutes/expiresAt`、`requiresManualStart`、`tableStartedAt`、鱿鱼模式/额度/轮次/提示截止/待结算标志，以及暴击频率/盲注倍数/下一绝对截止；
- Seat 的 user/session/seat/stack/playStatus/version、一次性预操作、常驻托管、鱿鱼标记/本轮参与资格、私人待亮牌槽和保位截止；
- hand number、last button、start countdown；
- 当前 Hand 的完整标准/短牌牌分布、私牌、board、pots、players、actor、bets/stacks、action history、可选实际暴击盲注，以及开手时冻结的 paid-reveal enabled/cost；
- completed-action audit、Poker stateVersion、absolute turn deadline；
- 可选 settlement 与 `postHandReview`（完成手摘要、绝对 reviewEndsAt、按 userId 保存的逐张主动公开索引）。旧的整手主动公开 userId 集合解码为 `[0,1]`，未知牌槽拒绝。

不持久化 Socket ID、Presence、Timer handle、scheduler、logger、database URL、Session token、Cookie 或 Runtime cache。

## 序列化与反序列化

序列化先用 Zod 严格解析生成的 plain data。反序列化依次检查：

1. schemaVersion；
2. payload 字段/范围/日期/card code；
3. record header 与 payload 的 Room、state/runtime、hand/deadline 一致；
4. payload Room/Seat 与实时数据库关系完全一致；
5. seat/user/session/sequence 唯一；
6. Poker Core hand invariants 与牌唯一性；
7. active-hand Seat starting stack 与持久 Seat stack 对齐；
8. active hand 筹码守恒。

任一失败只记录安全 reason（如 `unsupported-schema-version`、`poker-invariant`），将 Snapshot/Runtime 标成 `RECOVERY_ERROR`；不输出 payload，不清空或猜牌。

## Transaction 边界

- 坐下/买入/sit-out/return/leave：业务写、RequestIdempotency 和 Snapshot 同事务。
- 房主 start/countdown/pause/resume/close：Room/Runtime 状态、幂等回执和 Snapshot 同事务。
- Start：锁 Room 后按历史最大值校正 nextHandNumber，完整初始 Hand 和 Snapshot 同事务。
- Action：TableActionReceipt、候选 Hand、可选 settlement、Snapshot 同事务。
- Timeout：验证旧 deadline、自动 action、可选 settlement、Snapshot 同事务。
- Completed Hand：所有历史、remaining deck、唯一 fullBoard、HAND_RESULT、Seat/deferred 与 Review Snapshot 同事务；Review 结束后自动释放 0 Stack Seat，再处理 CLOSING 会话关闭，不把 Stack 转入 Wallet。
- Autopilot/trusteeship/reserved/pending-show：Seat 待行动/常驻托管/待亮状态、RequestIdempotency 与 Snapshot 同事务；待亮选择在 Completed Hand 事务复制到 HandPlayer。
- Squid settlement：主池授标、逐人结算、必要自动补点、Seat/Room 轮次、Table Stack Ledger 与 Snapshot 同事务；稳定 operation key 防止重复收付。
- Action-time extension：Wallet debit/Ledger、新 turn deadline、RequestIdempotency 与 Snapshot 同事务；HandRecord 创建后补挂 Ledger 的 hand 外键。
- Room expiry：Room CLOSING/CLOSED 状态与 Snapshot 同事务；活动手保持不变，Review 后完成关闭。

v2 缺少的鱿鱼/常驻托管字段使用保守默认：普通模式、无标记、非本轮参与者、无常驻托管。v1 还使用 `requiresManualStart=true`、无一次性预操作/保位/Review，并保持旧冻结看牌字段的 `false/0` 语义。兼容只适用于结构和关系仍可严格验证的健康快照；不会猜测活动状态或未来牌。

只有事务 commit 后才更新内存和广播。故障注入/真实进程测试覆盖 commit 前回滚、commit 后 Runtime 更新前退出、Runtime 更新后广播前退出。

## Recovery 状态

`READY` 表示可验证；`ERROR` 必须有 `lastRecoveryError`，Runtime 为 `RECOVERY_ERROR`。`PENDING` 为数据模型保留的显式中间状态，当前正常提交直接产生 READY。管理员不能在线编辑或“修好”损坏 Snapshot；完成并校验备份后，只能显式安全关闭无法恢复的房间，按关系型数据库最后持久化的会话后手结清 GameSession，并用空座位 CLOSED 快照废止未完成手牌。

Step 7 管理后台只显示 schemaVersion、stateVersion、snapshotRevision、Recovery 状态和安全错误码，不返回或允许编辑 payload。管理员 Revalidate/Retry 仍调用同一严格 codec/关系校验；失败保持隔离，不猜牌、不清空 Stack。管理员 CLOSE 是独立的废止/结清流程，不会让损坏手牌恢复为可玩状态。备份/恢复保留 Snapshot 原样，恢复后 `audit:data` 再验证 Schema。
