# WP-PROBE-20260829-01：管理员房间连接与开手探针

## 变更边界

- 基线提交：`80f3e6c`（全部已投入点数通过底池派奖）。
- 本变更只增加只读诊断，不修改连接限流、Session 有效期、Presence 判定、开手条件、倒计时、机器人动作频率、牌局状态或数据库 Schema。
- 服务器探针只写管理员拥有的房间文件；普通用户房间、PostgreSQL、普通应用日志和 Socket 响应均不接收探针 payload。
- 探针写入采用既有按 roomId 串行的 NDJSON 队列；失败被吞并并报告安全错误，不进入牌桌事务，不改变 stateVersion。

## 开关与默认值

| 环境 | 未设置时 | 显式开关 |
| --- | --- | --- |
| development / test | 开启 | `ADMIN_ROOM_CONNECTION_PROBES_ENABLED=false` 关闭 |
| production | 关闭 | `ADMIN_ROOM_CONNECTION_PROBES_ENABLED=true` 开启 |

修改 `.env.docker.dev` 后需要重启用户自己控制的 Server 进程。关闭探针不影响既有 `SNAPSHOT` 和 `COMMAND` 行。

## 记录格式

- `kind = CONNECTION_PROBE`
- `probeSchemaVersion = 1`
- 公共字段：`changeId/probeSchemaVersion/probeRunId/probeSequence/createdAt/eventName/roomCode/roomId/handId/stateVersion/payload`；changeId 固定为 `WP-PROBE-20260829-01`，sequence 在同一房间/进程内严格递增，跨重启由 runId 分段。
- 固定事件：`SOCKET_SUBSCRIBED`、`STATE_REQUESTED`、`SOCKET_DISCONNECTED`、`SESSION_REJECTED`、`HAND_START_COUNTDOWN`、`HAND_START_GATE`
- 禁止字段：Cookie、Session ID/token、密码、手机号、牌、牌堆、HTTP header、Socket 命令正文和 ACK。
- 机器人报告的时间线最多 64 项；服务器管理员房间 NDJSON 沿用房间日志既有生命周期，由管理员永久删除房间时一并删除。

## 修改文件

- `.env.example`
- `.env.production.example`
- `apps/server/src/config/environment.ts`
- `apps/server/src/config/environment.test.ts`
- `apps/server/src/modules/tables/room-file-diagnostic-log.ts`
- `apps/server/src/modules/tables/room-file-diagnostic-log.test.ts`
- `apps/server/src/modules/tables/runtime/hand-controller.ts`
- `apps/server/src/modules/tables/runtime/hand-controller.test.ts`
- `apps/server/src/realtime.ts`
- `tools/system-test-runner/src/connection-probe.ts`
- `tools/system-test-runner/src/connection-probe.test.ts`
- `tools/system-test-runner/src/protocol-connection.ts`
- `tools/system-test-runner/src/random-bot-runner.ts`
- `docs/table-diagnostic-trace.md`
- `docs/random-test-bots.md`
- `docs/operations.md`
- `docs/PROGRESS.md`

## 验证记录

- 定向：Server 35 files / 235 tests、System Runner 29 files / 103 tests；两侧 TypeScript 检查通过。
- 全仓：Lint 零警告、`git diff --check`、workspace TypeScript、Production Build、138 files / 660 tests 全部通过。
- 探针顺序测试强制同一 `probeRunId`/room 的 `probeSequence` 为 `1, 2, ...`；权限测试强制普通用户房间不写探针；隐私测试反向扫描 Cookie/password/session/token 字段。
- 开手测试覆盖倒计时期间 eligible 掉线、认证准备阶段不足两人及最终 Socket 复核不足两人，并保留既有“取消后因 Presence 仍满足条件而重新排程”的行为，未用探针修正或掩盖该行为。
- 未启动 Docker、PostgreSQL、Server、Web 或机器人，未占用 3000/5173；数据库端到端测试留待用户已有测试环境运行时执行。

## 回退

立即停用、保留代码和既有日志：

```powershell
$env:ADMIN_ROOM_CONNECTION_PROBES_ENABLED = "false"
# 然后由用户在自己的可见测试窗口按 Ctrl+C，并重新运行原启动命令。
```

只撤销本探针提交、保留底池修复：

```powershell
Set-Location D:\wepoker
$probeCommit = git log --grep="feat: add reversible connection probes" -1 --format=%H
git revert $probeCommit
```

`git revert` 会生成可审计的反向提交；不得使用 `git reset --hard`。回退不删除已经生成的 `room-logs/*.ndjson` 或机器人报告，如需删除应在保留排障副本后使用管理员已有的永久删除房间流程。
