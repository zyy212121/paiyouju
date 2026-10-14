# 牌友局

私人 H5/PWA 德州扑克项目。以下先说明 Windows 电脑克隆后如何启动局域网测试；电脑和手机连同一个 Wi-Fi 后即可一起打开。

## 环境依赖

| 用途 | 需要安装 |
| --- | --- |
| Windows 局域网运行 | Git、Node.js 24、Docker Desktop；Windows PowerShell |
| Linux 服务器运行 | Linux、Git、Docker Engine、Docker Compose v2；域名指向服务器并开放 TCP 80/443 |

项目可以放在任意文件夹或磁盘。启动前先打开 Docker Desktop，并等它显示运行中。

## 如何运行

### Windows 局域网运行：程序在自己的电脑启动

以下步骤用于本机开发和局域网测试。网站、服务端和数据库都运行在你的 Windows 电脑上；手机只有连接同一 Wi-Fi 才能访问。这不会把游戏发布到公网。

**1. 克隆项目。** 打开 PowerShell，逐行执行：

```powershell
git clone https://github.com/zyy212121/paiyouju.git
cd paiyouju
```

**2. 创建本机配置文件。** 继续执行：

```powershell
if (-not (Test-Path .env.docker)) { Copy-Item .env.docker.example .env.docker }
if (-not (Test-Path .env.docker.dev)) { Copy-Item .env.example .env.docker.dev }
notepad .env.docker
notepad .env.docker.dev
```

如果这两个本机配置文件已经存在，命令会保留它们，不会用示例覆盖。记事本中只在本机配置文件修改：

- 在 `.env.docker` 中，把 `POSTGRES_DEV_PASSWORD` 和 `POSTGRES_TEST_PASSWORD` 改成你自己的本机数据库密码，例如 `LocalDev123456` 和 `LocalTest123456`。
- 在 `.env.docker.dev` 中，将 `DATABASE_URL` 改为 `postgresql://wepoker:LocalDev123456@127.0.0.1:55432/wepoker_dev?schema=public`。把其中的 `LocalDev123456` 换成你刚才设置的 `POSTGRES_DEV_PASSWORD`，两处必须完全一致。再把 `DEV_SEED_PASSWORD` 改成你要用来登录本地管理员的密码，并给 `BOT_ACCOUNT_PASSWORD` 设置一个本机密码。

密码建议只用英文字母和数字，这样不需要处理连接地址里的特殊字符。保存并关闭记事本。`.env.docker.test` 仅在要运行自动化测试时才需要创建。

**3. 安装项目依赖。**

```powershell
corepack pnpm install --frozen-lockfile
```

**4. 启动局域网测试。**

```powershell
corepack pnpm dev:lan
```

首次启动会准备 PostgreSQL、更新数据库、创建本地管理员，并启动网页和服务端。完成后 PowerShell 会显示一个网址，例如 `http://192.168.1.20:5173`。在本机浏览器和同一 Wi-Fi 下的手机浏览器都打开这个**显示出来的网址**，即可进入登录页。手机打不开时，按窗口提示运行防火墙命令。

启动期间不要关闭 PowerShell。停止网页和服务端时，在该窗口按 **Ctrl+C**；数据库会留在 Docker 中，之后再次运行 `corepack pnpm dev:lan` 即可。也可双击项目根目录的 `start-test-ui.cmd`，在面板中点击“按当前选择启动测试”。

本地管理员账号为手机号 `19900000001`（也可使用用户名 `admin`），密码是你填入 `.env.docker.dev` 的 `DEV_SEED_PASSWORD`。每次启动会按这个配置同步管理员密码。登录后可在大厅创建房间；其他玩家可在登录页注册，再加入房间。

### Linux 公网服务器部署：供互联网访问

服务器部署会运行网站、服务端、PostgreSQL 和 HTTPS 反向代理；服务器需要域名解析到本机，并能从公网访问 80 和 443 端口。

```bash
git clone https://github.com/zyy212121/paiyouju.git
cd paiyouju
cp .env.production.example .env.production
```

编辑 `.env.production`，填写自己的 `APP_DOMAIN`、`CLIENT_ORIGIN`、`APP_VERSION`、PostgreSQL 用户和强密码，并保证 `DATABASE_URL` 使用同一组数据库账号，数据库主机名为 `postgres`。检查并启动：

```bash
docker compose --env-file .env.production -f compose.prod.yaml config --quiet
docker compose --env-file .env.production -f compose.prod.yaml up -d --build
docker compose --env-file .env.production -f compose.prod.yaml ps -a
```

首次部署需要创建管理员：

```bash
docker compose --env-file .env.production -f compose.prod.yaml run --rm -it migration node --import tsx scripts/admin-create.ts
```

按提示输入管理员手机号、昵称和密码。随后访问 `https://你的域名` 登录；健康检查地址为 `https://你的域名/ready`。查看日志用 `docker compose --env-file .env.production -f compose.prod.yaml logs -f app`；停止服务用 `docker compose --env-file .env.production -f compose.prod.yaml down`，不要加 `-v`，以保留数据库和证书数据。更新和备份说明见 [服务器部署细节](docs/deployment.md)。

## 如何管理账户

- 普通玩家在登录页注册；管理员使用上方创建或配置的手机号和密码登录。
- 管理页面：`/admin/users` 管理用户与虚拟钻石，`/admin/rooms` 管理房间。
- 服务器管理员由首次部署时的 `admin-create.ts` 命令创建。服务器没有预置默认管理员。
- 局域网开发管理员由 `.env.docker.dev` 的 `DEV_SEED_PASSWORD` 配置；不要把本机 `.env` 文件提交或上传。
- 玩家数据保存在 PostgreSQL。开发时停止网页不会删除账户或房间数据。删除玩家和备份操作见 [管理员指南](docs/admin-guide.md)。

机器人脚本在独立的[私有机器人仓库](https://github.com/zyy212121/paiyouju-bots)，不需要启动普通游戏时可忽略。
