# 最小故障响应

## 数据库不可用

确认 `/ready` 失败并停止写入入口；不要把 `/health` 当作数据安全。恢复 PostgreSQL 后等待自动重连和 Runtime 恢复，再运行 `audit:data`。若仍异常，保持服务停止并保留日志/备份。

## RECOVERY_ERROR

停止相关 Room；管理员先查看安全摘要并执行 Revalidate/Retry。若确认无法恢复，先创建并校验备份，再使用管理员安全关闭；该流程废止未完成手牌，以关系型数据库最后持久化的 Seat/离座后手关闭会话，并生成空座位 CLOSED 快照。不得编辑牌、Stack、Pot 或赢家，也不得绕过安全关闭直接删除活动 Room。未知 Schema/损坏数据仍优先通过明确 Migration 或离线修复流程处理。

## Wallet 或费用不一致

停止相关用户或四类钻石费用写入，保存 Ledger、RequestIdempotency 和 AuditLog，核对固定策略、冻结历史费用与 Expected Cost。禁止直接 UPDATE balance、删除原流水或补写一条“抵消”来隐藏原因；使用经过评审的修复脚本/Migration并再次审计。

## 疑似私牌泄漏

立即停止服务和牌局，保全日志与数据库副本，审查 recipient projection、DOM、API、Socket、PWA Cache 和 Admin API。不得继续运行以“观察是否重现”，不得把可疑 payload 复制到普通聊天。

## 备份恢复

始终恢复到新数据库，先校验 SHA、Migration 和 `audit:data`，再启动隔离 App 验证登录/Wallet/History/Replay/Admin 并完成新手牌。不要覆盖唯一生产副本；切换前保留旧库只读回退点。

## 延迟、内存或连接异常

先暂停开新房，不要用非法动作洪水继续压测。记录 Ack p50/p95/p99/max、event-loop delay、RSS/heap、Runtime/Socket/Timer/Action Cache 和数据库连接。若 p95 连续三次超过 2 秒、p99 超过 5 秒、Ack timeout 影响行动 Deadline，或空闲清理后 RSS 仍持续高于起始 30%，保持服务下线并保存隔离报告。不要通过放宽 timeout、自动重试或清空状态掩盖问题。

## 发布或 Migration 失败

Migration Job 非零时 App 按设计不得启动。保留 PostgreSQL Volume、失败日志和已校验备份；不得 `down -v`、`db push`、修改旧 Migration 或自动逆向 Migration。恢复到新数据库验证后再决定切换。单活动 App 拓扑不支持滚动双实例；公网部署、DNS、ACME 和镜像推送都需要独立授权。
