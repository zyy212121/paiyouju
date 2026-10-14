# 管理员指南

管理后台位于 Web App `/admin`，账号、角色、钻石和审计保存在当前部署所连接的 PostgreSQL 数据库。通过应用后台管理账户，Docker Desktop 不提供本项目的账户管理界面。服务器始终以当前有效 Session 对应的数据库角色判定权限；隐藏菜单、URL、客户端 role 或 payload userId 都不能授予权限；非管理员稳定返回 `ADMIN_REQUIRED`。

## 开发环境管理员

开发 Seed 创建 `admin` 用户，登录账号为 `admin`、手机号为 `19900000001`、昵称为“管理员”，密码读取本机未跟踪的 `.env.docker.dev` 中 `DEV_SEED_PASSWORD`。每次 Seed 都会把该账号的角色、手机号和密码修复到当前本机配置；普通用户的既有密码不重置。登录后访问 `/admin`；“用户”页面查看现有账户，进入用户详情后可提交正数补充钻石或负数扣减钻石。每次调整要求填写原因并写入 Wallet Ledger 与 AuditLog；玩家占座期间也可调整钻石，因为 Wallet 与 Table Stack 完全独立。

## 创建首位管理员

先完成 Migration，再在可信终端执行：

```bash
docker compose --env-file .env.production -f compose.prod.yaml run --rm -it migration node --import tsx scripts/admin-create.ts
```

命令只接受交互输入；密码隐藏并要求二次确认，不接受命令行参数，不创建 Session。新账号使用正式手机号/昵称/密码校验、Argon2id、一个 Wallet 和 INITIAL_GRANT Ledger。相同资料可幂等重放；已存在但资料、密码或角色不匹配时拒绝，不会偷偷提权。

## 页面与查询

后台包括概览、用户/详情、房间/详情、活动牌桌、对局/详情、完成手牌/完整审计、Wallet Ledger、钻石行为、偷偷看、发发看、AuditLog、Recovery 与 System。手机端可读，宽表在组件内部横向滚动，不扩大页面。

用户详情提供“永久删除玩家资料”。必须填写至少 8 个字符的原因并再次输入“永久删除”；管理员账户和当前管理员本人不可删除。玩家仍关联任何房间、座位或 GameSession 时拒绝删除，需先在房间详情安全关闭并永久删除相关房间数据。房间删除会级联清除 Hand、Action、Pot、Snapshot、GameSession、Seat、房间流水、付费授权和对应本地诊断文件，并留下不再外键关联目标的管理员删除审计记录。

Dashboard 聚合用户、在线/Socket、房间状态、活动牌桌、Hand/Review、保位/爆仓、24 小时 Hand 与四类钻石费用、Wallet/Table Stack、数据库、Migration、Recovery、版本与运行时间。服务端聚合，不把全库下载给前端。

完整手机号只允许作为管理员精确搜索输入；响应和日志始终返回掩码。后台不返回 Session/hash、密码/hash、活动私牌、牌堆、未来 Board、Snapshot payload 或数据库秘密。

## 钻石调整

管理员调整请求包含 `targetUserId`、非零整数 `signedAmount`、UUID `operationId` 和去首尾空格后的 8–200 字符 `reason`。UI 显示目标、当前余额、调整额、调整后余额，并要求浏览器二次确认。

服务端在单个 PostgreSQL 事务中重新验证管理员、锁定 Wallet、调用 Wallet Service、追加 `ADMIN_ADJUSTMENT` Ledger 和 AuditLog。余额必须保持在 `0..MAX_POINTS`。相同 operationId/相同请求返回原结果且不重复记账；同 ID/不同请求返回 `IDEMPOTENCY_CONFLICT`。不得直接更新 Wallet.balance，也不得改变 Table Stack、Pot 或 Hand。

## 房间与 Recovery

允许操作只有“暂停下一手”“恢复下一手”“请求安全关闭”和 Recovery 的 Revalidate/Retry。关闭复用 PAUSE/CLOSING/POST_HAND_REVIEW/会话关闭/CLOSED；到期不打断当前 Hand，Review 完成后关闭，历史可软归档并在关闭 30 天后自动清理。管理员不能直接删活动 Room、编辑 Snapshot、改 Stack/Board/牌/Pot 或指定赢家。

若严格恢复已经把房间隔离为 `RECOVERY_ERROR`，管理员可在完成并校验备份后请求安全关闭。服务端只按关系型数据库中最后持久化的 Seat/离座后手关闭 GameSession，废止无法验证的未完成手牌并重写为空座位 CLOSED 快照；不会尝试猜测损坏手牌的牌面、底池或赢家。关闭成功后才允许使用既有永久删除入口，操作仍要求 reason、operationId 并写 AuditLog。

完整已结束 Hand 审计会写 `ADMIN_VIEW_FULL_HAND`，但 AuditLog 不记录牌值。活动 Hand 永不通过此入口暴露未来信息。高风险写操作必须有 reason 和 operationId；后台没有修改/删除 AuditLog 的 API，超过 30 天的历史由统一保留任务清理。
