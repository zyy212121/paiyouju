# 短牌模式规则

## 模式边界

- 短牌、鱿鱼和普通模式的“发两次”互斥；创建短牌房间时服务端强制关闭发两次。
- 牌桌 UI、Small Blind / Big Blind、行动顺序、No-Limit 下注、底池、边池、平分与奇数筹码规则均沿用普通模式。
- 短牌的变体标识冻结在每手权威状态和 Snapshot 中；旧牌局没有该字段时继续按标准 52 张规则读取。

## 牌组与牌力

- 只使用 6、7、8、9、10、J、Q、K、A，每种花色各 9 张，共 36 张。
- A-6-7-8-9 是最小顺子，按 9 高顺子比较。
- 同花大于葫芦。
- 顺子仍大于三条；其余牌型顺序及同牌型踢脚比较沿用标准德州扑克。

以上规则选择与 PokerStars 的 6+ Hold'em 规则和短牌牌型表一致：

- [Rules and Hand Rankings in 6+ Hold'em](https://www.pokerstars.com/poker/learn/strategies/rules-and-hand-rankings-in-6-holdem/)
- [Poker Hand Rankings — Short Deck](https://www.pokerstars.com/poker/games/rules/hand-rankings/)

## 房间后手上下限

- 创建短牌房间不显示普通模式的 Initial Buy-in，而显示后手下限和上限，默认分别为 500 与 2000 点。
- 为兼容统一座位与 GameSession 数据模型，数据库中的 `initialBuyIn` 固定等于后手下限；它不是额外的创建选项。
- 首次坐下领取后手下限；自由补点后的后手不得超过上限。
- 每手先完成真实 Poker 输赢、Hand Result 和零和校验，再在同一事务中规范仍在桌的参与者后手：低于下限自动补至下限，高于上限自动退至上限。
- 自动补点写与该 Hand 关联的 Table Stack `BUY_IN` 并增加 `GameSession.totalBuyIn`；自动退点写 Hand 关联的 `CASH_OUT` 并增加 `totalCashOut`。两者都不读取或修改 Wallet 钻石。
- 活动战绩使用 `当前后手 + 已退点 - 总带入`；房间关闭时把剩余后手继续追加到 `totalCashOut`，保证最终战绩与逐手输赢一致。
