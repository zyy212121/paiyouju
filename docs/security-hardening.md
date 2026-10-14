# 安全加固清单

## 浏览器与 HTTP

- 所有非安全方法必须同时满足精确 `Origin` 和 `X-Wepoker-Request: 1`；CORS 只允许 `CLIENT_ORIGIN` 且允许凭据。
- Session Cookie 为 HttpOnly、SameSite=Lax，production 为 Secure；登录轮换 Session，logout/撤销/过期立即使 HTTP 和 Socket 失效。
- 身份、管理员角色和资源关系来自数据库；前端 role、URL、payload userId 都不可信。
- 全局 Body 64 KiB，严格 Zod 拒绝未知字段；认证、房间加入、管理员写与敏感读取使用独立限流。
- Fastify 与 Caddy设置 CSP、nosniff、DENY frame、no-referrer、Permissions Policy；HTTPS 设置 HSTS。

## Socket.IO

握手要求精确 Origin 和有效 Session。每用户最多 5 条连接，并设连接/命令速率限制、64 KiB 应用 payload、未知事件拒绝和 typed error。每条命令与私有广播持续复核 Session；logout/revoke/expiry 主动断开。单实例限制仍然成立。

## 隐私与审计

API 通过白名单投影隐藏活动私牌、remaining deck、future board 和 Snapshot。完整手机号只进入认证/精确搜索输入和数据库，响应为掩码。API、日志、AuditLog、PWA Cache 和构建产物均不得含密码、token、Cookie、DATABASE_URL、完整手机号、未公开牌或 Snapshot payload。

高风险管理写操作需要 reason 和 operationId；Wallet/Ledger/AuditLog 同事务。完整已结束 Hand 审计会记录访问行为，但日志 metadata 不含牌值。

## 依赖与发布

`audit:dependencies` 阻断所有非白名单 high/critical。当前唯一允许项是 Prisma CLI 配置链的 `deepmerge-ts` advisory；它不位于 HTTP/Socket 运行时不可信递归合并路径，升级条件受精确路径约束。生产镜像用锁定依赖、非 root 用户、无秘密/源码挂载，并在发布前扫描构建上下文与镜像。
