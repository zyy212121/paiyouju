# 本地数据库

Step 5 的开发与验收数据库是 Docker Desktop 中的标准 PostgreSQL，不再使用 Prisma Postgres Local 作为验收边界。旧 Prisma Local 数据未删除、也无需迁移；Docker 库从全部版本化 migration 和 seed 新建。

## 实测配置（2026-08-14）

| 项目 | 开发 | 测试 |
| --- | --- | --- |
| Compose service | `postgres-dev` | `postgres-test` |
| Image | `postgres:17-alpine` | `postgres:17-alpine` |
| 实际 PostgreSQL | 17.10 | 17.10 |
| Host port | `127.0.0.1:55432` | `127.0.0.1:55433` |
| Database | `wepoker_dev` | `wepoker_test` |
| User | `wepoker` | `wepoker_test` |
| max_connections | 100 | 100 |
| 应用 pool max | 10 | 10 |
| Volume | `wepoker-postgres-dev-data` | `wepoker-postgres-test-data` |

两个服务有独立 healthcheck、`unless-stopped` restart policy、UTF-8 init 和 named volume。数据库目录不 bind mount 到 `.`。

## 本地配置

```powershell
Set-Location .
Copy-Item .env.docker.example .env.docker
Copy-Item .env.example .env.docker.dev
Copy-Item .env.example .env.docker.test
```

编辑本机文件时：Compose 变量的 dev/test 密码必须与各自应用 `DATABASE_URL` 匹配；dev 指向 55432/wepoker_dev 且 `NODE_ENV=development`，test 指向 55433/wepoker_test 且 `NODE_ENV=test`；两边 `DATABASE_POOL_MAX=10`。不要提交这些文件或输出完整连接串。手动启动 Server 时用绝对路径 `.\.env.docker.dev` 设置 `WEPOKER_ENV_FILE`，避免 pnpm package 工作目录改变相对路径含义。

## 生命周期

```powershell
corepack pnpm db:docker:up
corepack pnpm db:docker:status
corepack pnpm db:docker:logs

corepack pnpm db:docker:reset:dev
corepack pnpm db:migrate:docker
corepack pnpm db:seed:docker

corepack pnpm db:docker:reset:test
corepack pnpm db:migrate:test:docker
corepack pnpm db:seed:test:docker

corepack pnpm db:docker:down
```

Reset 脚本只允许 `wepoker_dev` 或 `wepoker_test`，先查询 `current_database()`，然后只重建目标库的 `public` schema。Migration 必须用 `prisma migrate deploy`，禁止 `db push` 绕过历史。

## Migration 与 Seed

当前共有 22 个 migration，最后一个是 `20260828010000_room_stack_continuity`。空测试库必须按顺序应用全部 22 个。Seed 可重复运行；第二次不能创建重复用户、Wallet、流水或房间。

普通 `corepack pnpm --filter @paiyouju/server test:integration` 会先对忽略的 `.env.docker.test` 指向的标准测试库执行 `migrate deploy`，再以 `DATABASE_POOL_MAX=10` 运行完整集成套件；不会回落到旧 `.env.test` 单连接环境。升级回归会在随机隔离 schema 中建立旧版本数据，再顺序应用后续 migration，验证既有 User、Hand、Snapshot 与 Seat 数据保留且新字段获得安全默认值。

Readiness 会查询 `_prisma_migrations` 已完成且未回滚的记录；不足 22 个即返回数据库 unavailable/503。Schema 合同测试同时核对表、enum、CHECK、unique、索引和复合外键。

## 多连接证据

两个独立 Prisma clients 对测试库并发执行含短暂 `pg_sleep` 的 `SELECT pg_backend_pid()`，要求至少两个不同 PID；专项测试还验证 `SELECT FOR UPDATE` 会阻塞另一个客户端而不阻塞其独立连接。详情见 [PostgreSQL Concurrency](postgres-concurrency.md)。

## Windows / WSL 2

命令从原生 Windows PowerShell 在 `.` 执行。Docker Desktop 使用 WSL 2 Linux backend；不应复制仓库到 WSL，也不应在 Ubuntu 再安装一套 Docker Engine。详见 [Docker Development](docker-development.md)。
