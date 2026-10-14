# 生产配置

唯一模板是 `.env.production.example`；真实 `.env.production`、证书、dump 和秘密不得提交或进入镜像。

| 变量 | 规则 |
| --- | --- |
| `NODE_ENV` | 固定 `production` |
| `APP_VERSION` | 非空发布标识，显示于 System/备份 Manifest |
| `APP_DOMAIN` | Caddy 站点域名；本地演练可为 localhost |
| `CLIENT_ORIGIN` | 精确 HTTPS Origin，无尾随路径 |
| `POSTGRES_*` | 专用数据库/用户与强随机密码 |
| `DATABASE_URL` | 指向 Compose `postgres:5432`；生产拒绝弱密码/占位值 |
| `DATABASE_POOL_MAX` | 单实例连接池；默认 10 |
| `SESSION_COOKIE_NAME` | Cookie 名；token 仅 HttpOnly/Secure/SameSite=Lax |
| `SESSION_TTL_DAYS` | 绝对 Session 有效期 |
| `INITIAL_USER_POINTS` | 娱乐钻石初始余额（保留旧环境变量名以兼容部署）；不可充值、提现或兑换 |
| `MAX_SOCKETS_PER_USER` | 1–20，默认 5 |
| `RUNTIME_IDLE_EVICTION_SECONDS` | 空闲 Runtime 清理窗口 |
| `BACKUP_RETENTION_DAYS` | 每日备份保留数量，默认 7 |
| `LOG_LEVEL` | 生产默认 info；不得开启会输出 SQL 参数/敏感 payload 的调试日志 |

房间自身配置不是环境变量：时长 30–180 分钟、30 分钟一档、默认 60；行动时间 10–45 秒、5 秒一档、默认 30。到期完成当前 Hand 和 Review 后安全关闭。钻石基准固定 `x=10`：每手开局 `x`、偷偷看 `5x`、发发看 `x`、加时 `x`，均与 BB 解耦。

`TEST_FIXED_DECK`、故障注入和开发 Seed 只能用于 test/development，production 启动必须拒绝。当前不需要 Session Secret：Cookie token 由加密安全随机源生成，数据库只保存 hash。
