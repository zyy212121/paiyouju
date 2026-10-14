# 积分看牌（旧逐目标兼容与新整手语义）

Step 6.5 的产品入口已经升级为一次查看整手所有隐藏底牌，详见 [Hand-level Paid Reveal](hand-level-paid-reveal.md)。本文件保留 Step 6 逐目标模型的审计/兼容说明；旧记录不删除，任一旧授权会让买方获得整手授权且不得再次收费。

## 业务规则

积分看牌只针对已经完成并提交的 Hand。购买者必须是该房间成员，参与者与围观者都可购买；目标必须是该手真实参与者。不能查看自己的牌、已公开底牌或无完整底牌的目标，管理员身份不能绕过房间成员资格。

是否允许及费用在开手时从 Room 锁定配置中冻结，随完成手在同一结算事务写入。以后修改 Room 不改变旧手。迁移前的旧 Hand 默认 `enabled=false,cost=0`，不得追溯开启。

费用是娱乐钻石 burn：只从购买者 Wallet 扣除，不进入房主、目标或任何 Table Stack，不改变 Hand result。授权业务唯一键为 `(buyerUserId,handId,targetUserId)`，在该手 30 天保留期内只对购买者可见。

## 原子事务与锁顺序

购买流程在标准 PostgreSQL 事务中执行：

1. 锁购买者 Wallet；
2. 在锁内检查 `(scope,actorId,operationId)` durable replay；
3. 锁 Hand 并重新验证参与者、目标、公开状态和 Hand 时点费用；
4. 检查现有授权与余额；
5. 原子更新 Wallet balance/version；
6. 创建 `PAID_CARD_REVEAL` Wallet ledger（负数、before/after 等式）；
7. 创建 `PaidCardReveal`，由参与者与 Wallet transfer 复合外键闭合；
8. 写入不含牌码的 `RequestIdempotency` 精确响应并提交。

任何失败都会回滚 Wallet、ledger、授权和幂等记录。数据库 CHECK 保证 cost 为正、`walletSignedAmount=-cost`、类型正确；唯一键和复合外键拒绝跨用户、跨 Hand/Room、错误金额或错误目标记录。

## 幂等、超时与并发

客户端为一次确认生成一个 UUID `operationId`。结果不确定的 timeout 只能手动用同一 ID、同一 payload 重试，不能自动生成新 ID。相同 ID/相同 payload 返回首次精确结果；相同 ID/不同 payload 返回 `IDEMPOTENCY_CONFLICT`。

相同或不同 operationId 的并发请求在 Wallet/Hand 锁与授权唯一键处串行化：一次创建和一次扣费，其余返回 durable replay 或 `alreadyOwned=true`。专项测试使用两个独立 Prisma clients/标准 Docker PostgreSQL 连接，而不是内存模拟或单连接 Promise。

## 隐私

牌码只出现在购买者该次响应及其以后自己的详情/replay 投影中。不写 Wallet metadata、RequestIdempotency response、结构化日志、错误、URL、local/session storage，也不经 Socket 广播。Ledger metadata 只含 reveal ID 与 target user ID。

新 `PaidHandRevealPurchase` 使用唯一 `(buyerUserId,handId)`，同样与唯一 Wallet debit 在一个事务中。新 UI 不再逐目标发起请求；服务端读取授权时采用“新整手记录 OR 任一旧逐目标记录”。Review 未结束时两种购买都不能绕过观察期。

Step 7 `/admin/point-actions` 将整手偷偷看与发生时 BB、Expected Cost、实际 Ledger、operationId 和验证状态关联；管理响应默认不展示隐藏牌。`audit:data` 验证每用户每 Hand 最多一次授权、一次正确扣费且不向其他用户授权，异常非零退出但不自动修复。
