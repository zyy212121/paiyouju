# 牌友局

私人 H5/PWA 德州扑克项目。所有命令从仓库根目录执行，

## 环境依赖

| 运行方式 | 需要安装 |
| --- | --- |
| 服务器部署 | Linux、Docker Engine、Docker Compose v2 或以上、Git；域名解析到服务器，开放 TCP 80/443 |
| Windows 局域网开发 | Node.js 24、Corepack、pnpm 11.16.0、Docker Desktop、PowerShell；电脑与手机在同一局域网 |

服务器使用容器内的 Node.js 和 PostgreSQL，不需要在宿主机另装它们。当前只运行一个应用实例。

## 如何运行

获取源码并进入目录：

```bash
git clone https://github.com/zyy212121/paiyouju.git
cd paiyouju
```

### 服务器

首次复制配置文件：

```bash
cp .env.production.example .env.production
```

编辑 `.env.production`：

- `APP_DOMAIN`：自己的域名，例如 `poker.example.com`。
- `CLIENT_ORIGIN`：对应的 HTTPS 地址，例如 `https://poker.example.com`。
- `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`：数据库名称、用户和强随机密码。
- `DATABASE_URL`：使用相同数据库账号，主机名填 `postgres`；密码含 URL 特殊字符时需要编码。
- `APP_VERSION`：本次部署的版本标识。

已有配置直接使用。

```bash
docker compose --env-file .env.production -f compose.prod.yaml config --quiet
docker compose --env-file .env.production -f compose.prod.yaml up -d --build
docker compose --env-file .env.production -f compose.prod.yaml ps -a
```

数据库迁移任务 `migration` 正常退出码为 0；应用与 Caddy 应保持运行。Caddy 在域名解析和网络条件满足时自动申请证书。浏览器打开自己的域名，并检查：

```bash
curl --fail https://poker.example.com/ready
```

查看日志、停止服务：

```bash
docker compose --env-file .env.production -f compose.prod.yaml logs -f app
docker compose --env-file .env.production -f compose.prod.yaml down
```

停止命令不加 `-v`，以保留数据库和证书数据卷。更新代码后重新执行 `up -d --build`；更新前先备份。已有部署保持原 Compose 项目名和数据卷。更多说明见 [服务器运行](docs/deployment.md)。

### Windows 局域网

先打开 Docker Desktop。首次把 `.env.docker.example` 复制为 `.env.docker`，把 `.env.example` 分别复制为 `.env.docker.dev` 和 `.env.docker.test`，再填写自己的数据库密码与开发账号密码。已有文件保留。

开发数据库连接到 `127.0.0.1:55432/wepoker_dev`；测试库连接到 `127.0.0.1:55433/wepoker_test`。账号密码与 `.env.docker` 对应，分别设置 `NODE_ENV=development`、`NODE_ENV=test`。

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm dev:lan
```

也可双击根目录 `start-test-ui.cmd`，点击“按当前选择启动测试”。启动器会准备数据库并打印访问地址；电脑和手机均使用该局域网地址，以保持浏览器来源与配置一致。按运行窗口的 Ctrl+C 停止；若询问终止批处理，输入 Y。

详细配置见 [开发环境](docs/development.md)。机器人已拆到独立的 [私有机器人仓库](https://github.com/zyy212121/paiyouju-bots)，按该仓库 README 配置和启动。

## 如何管理账户

### 服务器管理员

服务器首次运行没有默认管理员。完成启动后执行：

```bash
docker compose --env-file .env.production -f compose.prod.yaml run --rm -it migration node --import tsx scripts/admin-create.ts
```

输入手机号、昵称和两次隐藏密码，然后使用该手机号登录。

### 局域网开发管理员

开发启动脚本会同步种子管理员：手机号 `19900000001`，账号 `admin`，密码是 `.env.docker.dev` 中的 `DEV_SEED_PASSWORD`。每次启动会按该配置同步管理员密码。

### 后台管理

普通玩家在登录页注册。管理员登录后进入 `/admin/users` 查看用户，进入详情调整虚拟钻石余额，操作需填写原因并保留审计。房间管理在 `/admin/rooms`。账户数据在应用连接的 PostgreSQL 中持久保存。

删除玩家资料前需要先处理关联房间和对局；完整流程见 [管理员指南](docs/admin-guide.md)。
