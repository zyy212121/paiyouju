# Windows 开发说明

仓库可检出到任意目录和磁盘。使用 Windows PowerShell、Node.js 24、Corepack/pnpm 11.16 和 Docker Desktop。也可在配置独立工具链的 WSL 中开发，同一依赖安装目录不要跨 Windows/WSL 混用。

## 首次准备

```powershell
Set-Location .
node --version
corepack pnpm --version
docker version
docker compose version

Copy-Item .env.docker.example .env.docker
Copy-Item .env.example .env.docker.dev
Copy-Item .env.example .env.docker.test
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
```

三个本机环境文件被 Git 忽略。完整配置与数据库命令见 [Docker Development](docker-development.md) 和 [Local Database](local-database.md)。

## 开发

```powershell
corepack pnpm db:docker:up
corepack pnpm db:migrate:docker
corepack pnpm db:seed:docker
corepack pnpm dev
```

默认 Web 地址为 `http://localhost:5173`，Server 为 `http://localhost:3000`，由 Vite 代理 `/api`、`/health`、`/ready` 和 Socket.IO。`pnpm dev` 默认读取 `.env.docker.dev`，可用 `WEPOKER_ENV_FILE` 指定其他文件；相对路径基于仓库根目录。启动器保留配置中的 `CLIENT_ORIGIN`，浏览器使用与它一致的来源。局域网测试使用 `pnpm dev:lan` 打印的地址。

若登录或注册返回 `ORIGIN_NOT_ALLOWED` / “访问地址与服务器配置不一致”，说明浏览器地址的协议、主机名或端口与 `CLIENT_ORIGIN` 不完全相同。这是修改请求的 CSRF 防线，不是账号或密码错误；关闭错误页面后，从启动终端打印的网址重新打开即可。

## 测试账号与数据库保留

- 关闭或重开 PowerShell 只结束前台进程，不会删除 PostgreSQL 数据。
- 手工注册到 `wepoker_dev` 的开发账号保存在 Docker named volume 中；普通 Docker stop/start 和 `pnpm dev` 重启后仍存在。
- Unit tests 使用 mock/进程内数据，不会成为可登录账号。
- Integration tests 在每个用例前清空隔离的 `wepoker_test` 业务表；这些账号不保证在下一用例后存在。
- Docker E2E 在每次启动时先重置 `wepoker_test.public`、重新应用 migration 和 Seed；本次产生的账号可能暂留到测试结束，但下一次 E2E 会全部重建。
- 只有显式执行 `db:docker:reset:dev`、删除开发 volume 或手工删除数据，才会清除开发账号。测试命令不得连接 `wepoker_dev`。

## 检查

```powershell
corepack pnpm db:validate
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e:docker
```

同一次安装不要在 Windows/WSL 两侧混用 Node 原生依赖。服务器启动按 [服务器部署](deployment.md) 执行，开发面板用于源码调试。
