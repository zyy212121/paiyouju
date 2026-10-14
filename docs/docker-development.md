# Docker Development

## 已验证环境

2026-08-14 在原生 Windows PowerShell 验证：Docker Client/Engine 29.7.2、Docker Desktop 4.86.0、Compose 5.3.1、context `desktop-linux`、Server OS `linux/amd64`，`hello-world` 成功。仓库仍是 `.`；WSL 2 只运行 Docker Linux VM。

Docker Hub 拉取在当前网络环境曾出现认证失败；使用 Amazon Public ECR 的官方 PostgreSQL 镜像镜像源完成一次本机拉取后，按内容标记为 `postgres:17-alpine`。Compose 文件仍引用官方标签，运行中的镜像实际报告 PostgreSQL 17.10。

## 文件与秘密

- `compose.yaml`：两个标准 PostgreSQL 服务和 named volumes。
- `.env.docker.example`：可提交的变量说明。
- `.env.docker`：Compose 本机账号/密码；忽略。
- `.env.docker.dev` / `.env.docker.test`：应用连接配置；忽略。

不要在 Compose 写真实密码，不要创建 `postgres-data` 仓库目录，不要输出完整 `DATABASE_URL`。

## PowerShell

```powershell
Set-Location .
corepack pnpm db:docker:up       # compose up -d --wait 两个服务
corepack pnpm db:docker:status
corepack pnpm db:docker:logs

docker compose --env-file .env.docker config
docker compose --env-file .env.docker config --services
docker compose --env-file .env.docker ps
```

开发：55432 / wepoker_dev；测试：55433 / wepoker_test。两个容器都执行 `pg_isready` healthcheck，`max_connections=100`，应用池至少 10。

## 空库与数据卷

```powershell
corepack pnpm db:docker:reset:test
corepack pnpm db:migrate:test:docker
corepack pnpm db:seed:test:docker
corepack pnpm db:seed:test:docker
```

`db:docker:down` 删除容器/网络但默认保留 volumes。明确需要永久删除本机数据时，先确认名称，再运行：

```powershell
docker volume inspect wepoker-postgres-dev-data
docker volume inspect wepoker-postgres-test-data
docker volume rm wepoker-postgres-dev-data wepoker-postgres-test-data
```

## Production Compose 边界

`compose.prod.yaml` 和 Caddyfile 只表达未来单实例拓扑。本阶段只验证其配置可解析；没有部署公网域名、证书或云服务器。上线前必须统一 PostgreSQL image patch tag、配置 `DATABASE_POOL_MAX`、完成备份恢复、TLS/WSS、CSP、防火墙、监控和密钥审查。
