# 整手付费看牌

## 新语义

“偷偷看”是一次购买当前 Hand 中所有仍隐藏的其他参与者底牌，不再逐玩家收费。买方必须是该房间成员，参与者与围观者权限一致；Hand 已完成且 4 秒 Review 已结束、Wallet 足额，并且至少有一张他人底牌仍隐藏。新房间强制启用，费用在开手时冻结为固定 50 钻石；现场主动公开过一张或两张牌仍不构成历史公开，这些牌继续属于本次整手授权范围。既有完成手保留其冻结历史费用，不重写不可变账本。

`POST /api/hands/:handId/paid-hand-reveal` 携带 `operationId`。事务锁 Wallet/Hand，写一条负数 `PAID_CARD_REVEAL` Ledger 与 `PaidHandRevealPurchase`；唯一键 `(buyerUserId,handId)`、幂等回执和数据库金额约束确保最多扣一次。费用只销毁 Wallet 钻石，不进入任何玩家或 Table Stack，不改变结算。

## 旧授权兼容

Step 6 的任意逐目标 `PaidCardReveal` 记录在该手 30 天保留期内都视为买方已拥有整手授权。查询与购买同时检查新整手记录或任一旧记录；命中即 `alreadyOwned=true`，不会再次扣费。旧表保留以兼容窗口内历史和审计，不做破坏性回填。

## 投影边界

授权只在购买者本人的 Hand detail/replay/历史抽屉中展开全部隐藏牌；不广播给桌内其他用户。其他玩家继续收到 `HIDDEN` 且 `holeCards:null`。牌码不写入 Wallet metadata、幂等响应、日志、URL、storage 或 PWA Cache。Review 内稳定返回 `HAND_REVIEW_IN_PROGRESS`。

旧逐目标接口仅为兼容已有客户端/数据；新 UI 只提供整手按钮。

新 UI 点击整手“偷偷看”后立即提交带 `operationId` 的购买，不出现确认步骤。成功后直接更新 Wallet 并重新读取本手详情；本地余额已不足或服务器因余额变化返回 `INSUFFICIENT_WALLET_BALANCE` 时，才显示可关闭的“钻石余额不足”对话框。网络结果不确定时保留同一个 operation ID 供再次点击安全重试。
