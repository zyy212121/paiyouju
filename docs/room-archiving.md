# CLOSED 房间与软归档

OPEN/CLOSING 房间只出现在活动列表；CLOSED 房间进入单独的有界游标列表。关闭仍遵循当前手→Review→记录最终房间点数并 exactly-once 关闭 GameSession→CLOSED 的安全流程，不为整理列表提前终止牌局，也不修改 Wallet。

软归档只隐藏列表记录。CLOSED 满 30 天后，统一数据保留任务物理删除 Room 及其牌局、玩家、牌桌点数流水、付费授权与关联审计；User 与 Wallet 当前余额继续保留。

房主可对本人 CLOSED 房间调用 `POST /api/rooms/:roomId/archive`，携带 `operationId`。服务端只设置 `archivedAt` 与 `archivedByUserId`，不 `DELETE Room`，不级联删除 Member、GameSession、Hand、Action、Pot、Ledger、付费授权或模拟补牌。相同 operation 精确重放；非房主、非 CLOSED 或未授权房间拒绝。

归档后的 Room 从该用户 CLOSED 列表隐藏，直接访问历史详情仍按原参与权限有效。数据库使用 Restrict 外键和 archive 成对 CHECK；前端必须先确认，再显示“从列表移除”，避免让用户误以为删除记录。
