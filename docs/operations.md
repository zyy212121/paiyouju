# Operations

## 临时公网测试（无域名）

该入口用于少量受邀测试者从外网访问家中电脑，不替代正式生产部署。它使用独立的 Docker 数据库和随机 Cloudflare Quick Tunnel HTTPS 地址，不开放路由器端口，也不读写开发数据库。每次启动的公网地址都会变化；只把当次地址发给可信测试者。

启动前先手动打开 Docker Desktop，等 Docker Engine 可用。随后可双击仓库根目录的 `START_PUBLIC_TEST.cmd`，或在 PowerShell 运行：

```powershell
Set-Location .
corepack pnpm public:test:start
```

首次启动会下载并校验固定版本的 `cloudflared`、构建镜像并应用数据库迁移，耗时会长于后续启动。看到 `PUBLIC TEST IS READY` 后，将 `Phone URL` 发给测试者；该窗口必须保持打开。当前地址也会复制到剪贴板。

停止时可在启动窗口按 `Ctrl+C`，也可双击 `STOP_PUBLIC_TEST.cmd`，或在另一个 PowerShell 运行：

```powershell
Set-Location .
corepack pnpm public:test:stop
```

查看当前状态和公网地址：

```powershell
Set-Location .
corepack pnpm public:test:status
```

停止会关闭 Quick Tunnel 和本套容器，但保留 `wepoker-public-test_public-test-postgres-data` 数据卷，因此测试账号和数据在下次启动后仍存在。它不会停止或占用开发环境的 3000/5173 端口。电脑关机、休眠、断网、Docker Desktop 退出或启动窗口关闭后，外部用户都无法继续连接。Quick Tunnel 没有固定地址或可用性保证，仅用于本阶段小范围测试。

## 启动检查

```powershell
Set-Location .
docker version
docker compose version
docker info --format '{{.OSType}}'
corepack pnpm db:docker:up
corepack pnpm db:docker:status
corepack pnpm db:migrate:docker
corepack pnpm db:seed:docker
```

Server 日志应依次出现 postgres database connected/Postgres version、application data retention、runtime recovery started/completed、readiness ready。保留任务失败会记录错误但不阻止牌桌恢复和启动。先查 `GET /health` 确认进程，再查 `GET /ready`；只有 ready=200 才接流量。

## `/health` 与 `/ready`

- `/health` 200：Node/Fastify 可响应，不代表数据库和牌桌恢复安全。
- `/ready` 200：数据库、22 migrations、startup recovery 和 accepting 状态均满足。
- `/ready` 503 starting：恢复尚未完成或 shutdown 已开始。
- `/ready` 503 unavailable：数据库不可访问或 migration 不完整。
- `degradedRooms>0`：存在隔离的 RECOVERY_ERROR 房间；其他房间可服务，但需人工调查。

## 日志

关注：snapshot/replay validation conflict、action receipt/idempotency conflict、paid reveal debit failure、PERSISTENCE_ERROR、RECOVERY_ERROR、room closing failed、application data retention failed、graceful shutdown timeout。`dev:lan` 每次运行的 Server/Vite 控制台输出同时保存在 `test-results/lan-runtime/`，用于进程意外退出后追溯；可按 roomId/handId/userId/requestId/stateVersion/snapshotRevision 关联，不要提高日志到会打印 ORM payload/SQL 参数的模式。

禁止复制到工单/聊天：`.env*`、DATABASE_URL、Cookie、Session token、Snapshot payload、deck 或私牌。恢复错误只使用安全 reason。

## 停机

Windows 服务/进程发送 SIGTERM（开发控制台可 Ctrl+C/SIGINT）。应用 10 秒预算内：mark unready → reject new commands → cancel timers → wait queues → close Socket/HTTP/DB。超时会以非零状态报告。不要用 kill 作为普通部署方式；强制 kill 只用于故障测试，后续必须等新进程 `/ready`。

牌桌的行动、Review、保位和房间到期都是必须执行的权威 deadline；系统 Scheduler 在任务被控制器显式取消前保持 timer referenced。不得为了让进程“自行退出”而对这些 timer 调用 `unref`：正常停机会先 dispose controller/cancel timer，再等待单桌队列清空。

## RECOVERY_ERROR

1. 不要重置 Snapshot、不要开新手、不要手工改 Wallet/Seat。
2. 记录 roomId、安全 reason、PostgreSQL/应用版本和最近部署时间。
3. 先做数据库备份/快照。
4. 在隔离副本复现严格 validator 与关系查询。
5. 本阶段没有在线管理员修复；保持房间冻结并升级代码/离线修复方案。

## PERSISTENCE_ERROR

该 Runtime 已停止写与 timer。检查 PostgreSQL 可用性、约束错误和 Snapshot conflict；客户端投影不会显示未提交结果。不要通过重启循环掩盖未知错误；先保存日志和备份。若数据库持久状态有效，正常重启会从最后已提交 Snapshot 恢复。

## CLOSING

CLOSING 可跨重启恢复。观察 remaining seats、Table CASH_OUT 记录和 Room status；重复 close 是幂等的。关闭 Seat/GameSession 不增加 Wallet。若某会话关闭失败，Room 保持 CLOSING，而不是错误标成 CLOSED。

## 数据、备份和审计

生产备份使用 `backup:create/list/verify/restore/prune`，默认目录位于项目外。每份 custom-format dump 配套 SHA-256 Manifest；恢复只允许新数据库，先 `backup:verify`、再 `audit:data`、再切换。每日保留 7 份、每周 4 份，每次 Migration 前额外备份，并至少保存一份异机副本。`backup:prune` 不删除未知、损坏或带恢复锁的文件。不要执行 `docker compose down --volumes`。

`audit:data` 是只读聚合审计：非零异常会以安全摘要和非零退出码报告，不修账，也不输出手机号、私牌、牌堆或 Snapshot payload。Docker 开发库必须用 `WEPOKER_ENV_FILE=../../.env.docker.dev` 运行；脚本会安全输出连接/数据库错误码，避免把“连错端口”误判为业务审计失败。旧快照缺少后来新增的房间时钟字段时，审计和恢复统一采用 Room 行的权威 `durationMinutes/expiresAt`。管理员高风险操作必须携带 operationId 和 8–200 字符 reason，并写入 AuditLog。

应用数据保留上限为 30 天。启动时执行一次清理，之后每 6 小时执行：删除关闭满 30 天的 Room 及其牌局/玩家/行动/点数流水/付费授权和关联审计，并清理过期 Session、AuditLog、RequestIdempotency 与 Wallet Ledger 历史。User 与 Wallet 当前余额不删除，活动 Room 不进入清理集合。该任务与项目外数据库备份保留是两套独立策略。

1号总开关 `ADMIN_ROOM_FILE_LOG_ENABLED` 控制管理员房间文件 Log：关闭时不写 Snapshot、Command 或 Connection Probe。2号动态开关 `ADMIN_ROOM_CONNECTION_PROBES_ENABLED` 只控制连接/开手探针，并受1号总开关约束。两者在 development/test 默认开启、production 默认关闭；测试面板会在启动 Server 前按勾选结果显式设置。普通用户创建的房间始终不写该文件。完整 payload 含私牌和牌堆，不得提交 Git、复制到普通日志或公开问题。管理员永久删除房间数据时同步删除对应 NDJSON，详细边界见 `table-diagnostic-trace.md`。

生产部署、备份恢复和事故处理分别见 `deployment.md`、`backup-restore.md`、`incident-response.md`。

## 历史、回放与 PWA 排查

- `REPLAY_NOT_AVAILABLE` 表示持久历史不足或结构校验失败；不要伪造事件，应保留 handId 并检查 Hand/Player/Action/Pot 完整性。
- 钻石看牌失败先按 requestId/operationId 检查 RequestIdempotency、PaidCardReveal 与唯一 Wallet debit；不要手工补第二条扣款。
- 发布新 Web 版本后，进行中手牌与 pending 写会延迟 reload，这是预期保护。若离线壳异常，先用生产构建检查 `sw.js`/manifest，再在 DevTools Cache Storage 确认只存在静态构建资源，不应出现 `/api`、`/socket.io`、`/health` 或 `/ready`。

## 生产和单实例限制

任何时间只能运行一个活动应用实例管理该数据库的牌桌。`compose.prod.yaml` 使用固定的 PostgreSQL 17 镜像、一次性 Migration Job、非 root App 和 Caddy；本阶段只做本地 Production-like 验证，未实际公网部署。滚动部署、多副本、跨区域、自动故障转移需要未来的 ownership lease/协调设计。
