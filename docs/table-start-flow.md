# 房主手动开始与连续发牌

## 权威规则

新房间 `requiresManualStart=true`。至少两名有效玩家时，只有房主可以发送 `table:start`；一人时显示邀请，非房主显示等待房主。有效玩家必须已坐下、`ACTIVE` 且 stack>0；断线座位仍有效并按让或弃托管，`RESERVED_AWAY`、`BUSTED_WAITING_REBUY`、暂停或待离桌玩家不计入。

命令携带 `roomId`、`operationId`、`expectedStateVersion`。服务端在单桌队列和 PostgreSQL 事务内锁 Room/Snapshot，复核房主、OPEN、未暂停、无活动手/Review、尚需手动开始和人数条件，然后设置 `requiresManualStart=false`；`tableStartedAt` 只在首次成功开始时写入。相同 operation 精确重放，不同 payload 冲突；重复开始和暂停中开始均拒绝。

首次成功开始后进入 5 秒开手倒计时。每手结算必须经过 4 秒 `POST_HAND_REVIEW`；Review 结束且仍有至少两名有效玩家、房间未暂停/关闭时，直接创建并广播下一手，不再经过第二段等待或倒计时。有效人数降到两人以下时只停发、不停表、不清 Seat/Stack；服务器每 30 秒复核，条件恢复后自动进入 5 秒开手倒计时。房主主动暂停会停止复核后的自动发牌，必须由房主恢复。

房主暂停只影响后续发牌，不中断当前手。关闭请求在当前手及 Review 完成后记录最终牌桌点数、关闭 Seat/GameSession 并进入 CLOSED，不修改 Wallet。

## 恢复

`requiresManualStart`、`tableStartedAt`、倒计时和 Review deadline 都在关系表/Snapshot 中持久化。进程重启不凭内存猜测是否开局；过期 timer 在桌队列内复核 identity 和 revision 后最多执行一次。
