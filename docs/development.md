# 开发环境

服务器运行见 [部署](deployment.md)。仓库可在任意目录，以下命令均从仓库根目录执行，无磁盘限制。

## 准备

安装 Node.js 24、Corepack 和 Docker（也可自行提供 PostgreSQL），pnpm 版本由 packageManager 固定为 11.16.0。

```bash
corepack pnpm install --frozen-lockfile
```

复制 `.env.docker.example` 为 `.env.docker`，复制两份 `.env.example` 为 `.env.docker.dev` 和 `.env.docker.test`，填写自己的密码。三个文件都不提交。

开发连接串指向 `127.0.0.1:55432/wepoker_dev`，测试指向 `127.0.0.1:55433/wepoker_test`，账号密码与 `.env.docker` 一致。开发 NODE_ENV=development，测试 NODE_ENV=test，连接池至少 10。

## Windows 一键启动

先启动 Docker Desktop，双击根目录 `start-test-ui.cmd` 并点击“按当前选择启动测试”。也可执行：

```powershell
corepack pnpm dev:lan
```

启动器从自身位置定位仓库，依次启动数据库、构建共享包、应用迁移、生成 Prisma Client、同步开发种子账号、启动 Server/Vite 并显示地址。它不 reset 数据库。Seed 会同步开发管理员和九个专用测试账号的配置密码、清除测试账号租约并补齐测试钻石；生产禁止运行。

LAN 启动后电脑和手机均使用终端显示的局域网地址，以匹配本次配置的浏览器来源。房主创建房间后手动开始首次牌局。探针、防火墙和多网卡配置见 [局域网测试](local-lan-test.md)。

## Linux/macOS 或手动启动

准备好上述配置后：

```bash
corepack pnpm db:docker:up
corepack pnpm db:migrate:docker
corepack pnpm db:generate
corepack pnpm db:seed:docker
corepack pnpm dev
```

开发启动器通过模块位置寻找 `.env.docker.dev`，也接受 WEPOKER_ENV_FILE；相对配置路径基于根目录。CLIENT_ORIGIN 来自配置，启动器不会覆盖它。Vite 默认 5173，Server 默认 3000；前端使用相对 API 地址经 Vite 代理。

## 验证与停止

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm db:migrate:test:docker
corepack pnpm --filter @paiyouju/server test:integration
corepack pnpm test:e2e
```

测试只连接独立测试库。`db:docker:reset:test` 会清空测试库，仅在确认可丢弃时使用；常规启动无需 reset。

停止运行窗口按 Ctrl+C；Windows 若询问终止批处理，输入 Y。停止数据库用 `corepack pnpm db:docker:down`，保留数据卷。

## 独立机器人库

自动行动机器人和 HTTP/Socket.IO 压力客户端已移到私有 `paiyouju-bots` 仓库。它自行安装依赖、读取自己的 `.env.bots`、按目标 URL 连接授权测试服务。游戏库不再提供 bot:random、test:load 等入口，这些命令在机器人库中运行。
