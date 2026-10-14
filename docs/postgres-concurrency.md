# PostgreSQL Concurrency

## 环境与证据

测试目标是 Docker `postgres-test`（PostgreSQL 17.10，127.0.0.1:55433，`max_connections=100`）。`DATABASE_POOL_MAX=10`，专项测试创建两个独立 Prisma clients，并发 `SELECT pg_backend_pid()` 至少观察到两个不同 backend PID；不是连接池为 1 的应用层 Promise 并发。

测试用 `SELECT ... FOR UPDATE`、唯一约束、确定锁顺序和事务原子性线性化资源。不存在靠 sleep 断言业务先后的测试；短 `pg_sleep` 只用于让两个独立连接同时被观测。

## 已覆盖竞争

| 场景 | 不变量 |
| --- | --- |
| Wallet debit | 100 余额同时 -80，只有一个提交；余额 20，流水两条（含初始） |
| Wallet update | 8 个 +10 全部提交；balance 180、version 9、sequence 1..9，无丢更新 |
| Same idempotency key | 两客户端得到同一记录 ID，只扣一次 |
| Explicit row lock | Client B 等 Client A commit；B 的另一连接可独立查询 |
| Seat competition | 两用户抢同一座，只有一个 Seat/GameSession/BUY_IN |
| Double seat | 同一用户抢两个座，只占一个、只扣一次 |
| Close vs room-points allocation | 只有完整领取后完整关闭会话，或 close 先行后拒绝领取；无 Wallet debit 或孤儿 Seat/Stack |
| Duplicate action | 两客户端同 action ID：一个 apply、一个 Receipt replay；一条 Receipt |
| Duplicate settlement | 一个 Hand、每玩家一条 HAND_RESULT、一个终态 Snapshot |

完成手持久化专项还以两个独立 clients 直接并发同一 settlement，验证完全相同重放与冲突检测。

## 锁策略

- Room 配置/close/buy-in/start/整桌上限先锁 Room。
- Wallet 变化锁 Wallet；多用户按稳定 userId 顺序。
- Seat 变化锁目标 Seat；持久操作在资源锁后再次查 idempotency。
- Hand transition 锁 TableSnapshot；start 额外锁 Room。
- completed hand 锁/校验相关 Seat 并依赖 handId、ledger keys 和唯一约束。

Step 5 仍只有一个活动应用实例；这些测试验证数据库资源竞争和故障防线，不构成多实例牌桌 ownership 支持。

Step 7 增加管理员 Adjustment 双 client 并发：相同 operationId/相同 fingerprint 只产生一次余额变化、一次 Ledger 和一次 AuditLog；不同 payload 冲突。备份使用 PostgreSQL 一致性 dump，但仍要求恢复后数据审计。本阶段固定单 App，不能把数据库行锁误解为跨实例 Runtime ownership。
