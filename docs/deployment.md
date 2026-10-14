# 服务器部署

项目可放在任意目录，以下命令从检出目录执行。推荐 Linux VPS + Docker Engine + Compose v2；拓扑为 Caddy → 一个 Fastify/Socket.IO 实例 → PostgreSQL 17。

## Docker Compose

复制 `.env.production.example` 为 `.env.production`，设置真实域名、HTTPS Origin、版本和强随机数据库密码。不要配置开发种子密码。Compose 内连接串 host 为 `postgres`。

```bash
docker compose --env-file .env.production -f compose.prod.yaml config --quiet
docker compose --env-file .env.production -f compose.prod.yaml up -d --build
docker compose --env-file .env.production -f compose.prod.yaml ps -a
docker compose --env-file .env.production -f compose.prod.yaml logs --tail=100 migration app caddy
```

启动按数据库 healthy → migration 成功 → app ready → Caddy 的顺序进行。迁移任务退出 0 是正常状态。运行镜像只含生产依赖、编译后的服务与前端产物，使用非 root 用户。只对外开放 80/443。

初始化管理员使用带运维工具的 migration 镜像：

```bash
docker compose --env-file .env.production -f compose.prod.yaml run --rm -it migration node --import tsx scripts/admin-create.ts
```

输入管理员手机号、昵称和两次隐藏密码，随后用手机号登录。生产不执行 seed。检查真实域名的 `/health`、`/ready`、登录、SPA 刷新和 Socket.IO。公网 DNS、证书签发和外部连通性须在目标主机验收。

## 独立 Node.js 进程

服务器已有 PostgreSQL、反向代理和 Node.js 24 时，也可直接运行构建后的应用。把生产配置保存为仓库根目录 `.env`，设置 `HOST=127.0.0.1`、真实数据库连接串与外部 HTTPS `CLIENT_ORIGIN`。示例中的容器主机名 `postgres` 需改为实际数据库地址。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm db:migrate
(cd apps/server && node --import tsx scripts/admin-create.ts)
node apps/server/dist/index.js
```

systemd 或已有进程管理器的工作目录设为实际检出目录，保持上述 start 命令运行。只运行一个应用实例，收到 SIGTERM 后留至少 20 秒关闭。反向代理转发 WebSocket、Host 和原协议，页面与 API 指向同一应用。宿主机 Caddy 最小示例：

```caddyfile
poker.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

生产还应补齐仓库 `Caddyfile` 中的安全头、请求体积和超时限制；其中 `app:3000` 是容器网络地址，宿主机进程部署时改为 `127.0.0.1:3000`。

## 数据、备份与更新

已有安装保持原 Compose 项目名和 named volumes。更改项目名会使 Compose 寻找另一组卷；本次品牌更名保留原存储标识。停止用 `docker compose ... down`，不加 `-v`。

主机安装了 Node/pnpm 工具链时，可用 `backup:create`、`backup:verify`、`backup:list` 和 `backup:restore`。命令读取 `.env.production`；相对备份路径基于仓库根目录，默认 `../paiyouju-backups`，拒绝写入源码目录。

仅有 Docker 时也可从数据库容器导出：

```bash
mkdir -p ../paiyouju-backups
docker compose --env-file .env.production -f compose.prod.yaml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > ../paiyouju-backups/database.dump
```

确认退出码 0，检查归档并定期恢复到独立新库。使用不同文件名保留多代备份，同时保存主机外副本；普通 pg_dump 不包含现有备份工具的校验清单。详见 [备份恢复](backup-restore.md)。

更新前备份校验，再拉取代码和重建。迁移只前向追加，失败会阻止应用启动；回退应用前核对 Schema 兼容性，不自动回滚迁移。

## 验收与开发配置

`compose.prod.local.yaml` 与 `Caddyfile.local` 仅供开发验证内部 HTTPS，公网部署使用 `compose.prod.yaml` 和 `Caddyfile`。历史发布记录在 `docs/release-evidence/`，不能替代当前版本或目标服务器的验收。
