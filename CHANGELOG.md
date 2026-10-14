# Changelog

## 0.1.0-rc.1 — 2026-08-26

首个发布候选版本，面向私人、娱乐积分制的 H5/PWA 德州扑克牌局；积分不可充值、提现或兑换现金。

### 核心能力

- 确定性的 Texas Hold'em Poker Core：牌型判定、边池、全下、短全下、分池与奇数筹码。
- 服务器权威的实时牌桌：2–9 人、合法行动投影、行动倒计时、加时、预操作、断线重连与幂等命令。
- PostgreSQL 持久化 Snapshot 与进程重启恢复，包含恢复错误隔离和管理员只读诊断。
- Wallet、Wallet Ledger、Table Stack Ledger 与 exactly-once 结算；所有积分仅供娱乐。
- 对局 History、Replay、参与者授权的“偷偷看”和唯一持久化“发发看”。
- 每张牌独立待亮/亮牌、结算展示与下一手生命周期。
- 手机号账号登录，以及旧账号在受控开关下绑定手机号；本版本不发送短信验证码，也不验证号码归属。

### Web / PWA

- 移动端牌桌、玩家头像/筹码/行动区、侧滑抽屉、排行榜和固定信息区域。
- 可安装 PWA、离线壳与更新提示；私有 API、Socket、健康检查不进入运行时缓存。
- 本地音效合成与浏览器首次交互解锁，不依赖外部音效下载。

### 管理与运维

- 管理员用户、房间、完整已结束手牌、积分流水、点数动作、恢复状态和审计日志页面。
- 管理员积分调整、房间操作和恢复操作均具备授权、原因、幂等和 AuditLog。
- Production 多阶段 Dockerfile、PostgreSQL migration job、Caddy HTTPS/Socket 反向代理和非 root App 容器。
- PostgreSQL 备份、SHA-256 校验、恢复、保留策略与数据一致性审计命令。

### Security

- Argon2 密码哈希、哈希 Session token、14 天 HttpOnly/SameSite Cookie、生产 Secure Cookie。
- 严格 CORS/Origin/写请求头校验、输入长度与类型限制、速率限制和安全响应头。
- 用户/房间/手牌/回放的服务端授权与 IDOR 防护；普通实时投影不包含未来公共牌或他人隐藏手牌。
- 日志、管理员审计元数据和错误响应对密码、Cookie、手机号、私牌、Snapshot 与内部错误做脱敏。

### Release-candidate validation

- 增加独立、协议级多客户端 scenario runner；仅使用普通 HTTP、Cookie 与 Socket.IO v5，不导入服务端、Prisma、Snapshot 或 Poker Core 内部实现。
- 增加精确五张牌分布、百万手模拟、多种子、真实服务器场景、100 用户负载、30 分钟浸泡和负载故障测试入口。
- Migration 数量提升至 18；兼容旧 Room 行动时间约束并保持从既有阶段数据库顺序升级。

