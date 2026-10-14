# 管理员房间本地诊断日志

服务器根据房间 Owner 的数据库角色判断日志范围，普通玩家创建的房间始终不写诊断文件。`ADMIN_ROOM_FILE_LOG_ENABLED` 是1号总开关：关闭后管理员房间也不写 Snapshot、Command 或 Connection Probe。`ADMIN_ROOM_CONNECTION_PROBES_ENABLED` 是2号动态开关：只控制连接与开手门槛 Probe，并受1号总开关约束。两者在 development/test 默认开启、production 默认关闭，修改后必须重启 Server；测试启动面板会按勾选结果显式设置。

## 保存位置和格式

日志固定写入项目目录：

```text
.\room-logs\admin-room-<roomCode>-<roomId>.ndjson
```

`room-logs/` 已加入 `.gitignore`。每行是一个独立 JSON 对象：

- `SNAPSHOT`：完整服务器权威状态，包含房间、座位、后手、当前手、完整牌堆、私牌、deadline、stateVersion 和 snapshotRevision；
- `COMMAND`：会改变牌桌的 Socket 命令、actorUserId、eventName、roomId/handId 以及成功或失败 ACK；
- `CONNECTION_PROBE`（schema 1）：只包含连接/订阅/开手门槛元数据，不包含 Cookie、Session ID/token、密码、牌、牌堆或命令正文。

每个探针行固定带 `changeId=WP-PROBE-20260829-01`、`probeSchemaVersion=1`、进程级 `probeRunId` 和该房间/进程内递增的 `probeSequence`。同一进程内可按 sequence 严格还原调用顺序，跨重启按 runId 分段后再使用 `createdAt` 对齐。`CONNECTION_PROBE.eventName` 的固定集合和用途：

| 事件 | 记录内容 |
| --- | --- |
| `SOCKET_SUBSCRIBED` | connectionId、userId、Presence 版本、服务器声明的房间订阅 |
| `STATE_REQUESTED` | 只读重同步时 Socket room、声明订阅和 Runtime Presence 是否一致 |
| `SOCKET_DISCONNECTED` | Socket.IO 原因、Presence 移除前后状态、是否正在停服 |
| `SESSION_REJECTED` | 发生于订阅、状态投影、广播或开手参与者复核的固定 reason |
| `HAND_START_COUNTDOWN` | 5 秒开手倒计时排程时的座位、连接、eligible 和 candidate 集合 |
| `HAND_START_GATE` | 倒计时取消或成功开手；固定 reason 精确区分 eligible、已认证 Socket 参与者、账务校验、房间状态、暂停、过期和提交失败 |

文件写入按 roomId 串行，多个玩家同时行动不会让两行内容相互穿插。每行带独立 `createdAt`，探针写入失败只写普通错误日志，绝不阻塞或改变权威牌桌状态。正常停服会等待已经排队的诊断写入完成。日志用于事故排查，不参与恢复；牌桌恢复仍只信任 PostgreSQL 的业务 Snapshot、Hand、Action、Pot 和 Ledger。

## 生命周期

- 管理员房间首次广播权威状态时自动创建文件；
- 机器人只进入管理员房间，因此 AFK 压测会自动留下完整本地现场；
- 没有管理员房间时机器人保持静默，不产生房间日志；
- 管理员在后台永久删除 CLOSED 房间数据时，同步删除对应 NDJSON；
- 文件不会上传云端，也不进入 Docker Volume。

完整日志含全部私牌和剩余牌堆，属于最高敏感度测试数据。不得提交 Git、发给普通玩家或原样粘贴到公开问题；排查时先保留原文件，再从副本提取最小、去标识化片段。

机器人 JSON 报告同时增加有界（最多 64 项）的连接时间线、最后收到状态的时间/version/runtimeStatus、本人座位连接投影、重同步次数和意外断线次数。它不包含 Cookie、Session、密码、手机号或牌值；这份报告与服务器管理员房间 NDJSON 可按时间、roomId/userId/stateVersion 交叉核对。

连接探针的变更编号、文件清单和两种回退路径见 `change-log/2026-08-29-admin-room-connection-probes.md`；图形面板和1号总开关见 `change-log/2026-08-30-visual-test-launchers.md`。

## 旧数据库追踪

Migration `20260829010000_admin_cleanup_fixed_bots_local_logs` 删除旧 `TableDiagnosticTrace`、`ServerFeatureFlag`、Snapshot Trigger 和 `trace:status/enable/disable` 命令。PostgreSQL 不再保存完整诊断副本。
