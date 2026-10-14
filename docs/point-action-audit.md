# 钻石行为审计

`/admin/point-actions` 统一查看每手开局、整手偷偷看、发发看和行动加时。每条记录包含用户掩码、Room、Hand、类型、实际 Cost、操作发生时 Big Blind（仅作牌局上下文）、Expected Cost、Ledger、operationId、时间与校验状态。

| 行为 | Expected Cost | 幂等与授权 |
| --- | --- | --- |
| 每手开局 | 10 钻石 | 与 Hand 创建和 Snapshot 同事务；每位参与者每 Hand 恰好一条，余额不足不创建 Hand |
| 偷偷看 | 50 钻石 | 每位用户每 Hand 在 30 天保留期内最多一个整手授权和一次扣费；不授权他人；旧 Hand 按冻结历史费用审计 |
| 发发看 | 10 钻石 | 每 Hand 一份唯一模拟结果；每用户独立购买且最多扣费一次 |
| 加时 | 10 钻石 | 每次成功费用对应 Deadline 延长；operationId 重放不重复扣费，结算后补正确 Hand 关联 |

发发看排除全部真实已发牌，不改变真实 Board、Winner、Hand Result、Replay 或其他用户视图。逐张待亮与四类费用在完整 Hand 审计中可关联；活动 Hand 的未公开牌、未来 Board 与 remaining deck 不进入管理响应。费用不匹配时后台标异常且 `audit:data` 非零，系统不自动改账。
