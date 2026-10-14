# 数据完整性审计

`corepack pnpm audit:data` 对当前 `DATABASE_URL` 执行只读聚合检查；任何异常返回非零，不自动修复。输出只有检查码和数量，不包含用户 ID 清单、完整手机号、牌值、牌堆或 Snapshot payload。

当前 28 类检查覆盖：每 User 一个 Wallet、手机号唯一、余额边界、30 天保留窗口内的 Ledger 尾部/sequence 链；Table Stack、活动 Seat/GameSession、关闭 Session、Table Ledger、独立牌桌点数与 GameSession 对账；HAND_RESULT/HandPlayer 零和、Hand Number、Pot Award；逐张待亮状态；房间时长/行动时间、CLOSED Seat、Archive 历史；偷偷看、唯一发发看结果/个人授权/牌唯一性、加时费用/receipt/Hand 关联；预操作、Action Receipt 唯一和 Snapshot Schema。

Wallet Ledger 允许由保留任务删除超过 30 天的前缀，因此首条可见流水不要求 sequence=1/balanceBefore=0，完全过期时也可为空；可见记录之间仍必须连续，若可见尾记录等于 Wallet.version，则其 balanceAfter 必须等于 Wallet.balance。

`HAND_POT_AWARD_MISMATCH` 按每个赢家的平均份额和奇数筹码接收者重建 Award，要求总 Award 精确等于 Pot Amount，并验证 contributors、eligible players、winners 和 odd-chip recipients 的集合关系。每手玩家总投入必须精确等于 Pot 总额，每名玩家的 `netResult + committed` 必须精确等于其全部 Pot Award；单人贡献、单人获胜的锁定末层池合法，投入与 Pot 之间的任何退款差额都视为损坏。

四类费用按固定钻石策略审计：每手开局 10、发发看 10、加时 10；偷偷看对新手为 50，既有完成手按其冻结历史值。异常只报警，不删流水、不改余额。升级后、恢复后、PostgreSQL 故障后和正式发布前都必须运行。
