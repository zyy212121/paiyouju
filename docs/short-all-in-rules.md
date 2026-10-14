# Short All-in 与 Raise 权

公开金额只使用 `raiseTo`：它是玩家本街行动后的累计投入，不是新增筹码。

- `currentBet` 是本街最高累计投入。
- `lastFullRaiseSize` 是最近一次完整 Bet/Raise 的增量；Preflop 初始为配置 Big Blind，每条新街重置为 Big Blind。
- 每名玩家保存 `lastActedBetLevel` 和当次面对的 `lastActedFullRaiseSize`。
- 全下目标高于 `currentBet` 但增量不足 `lastFullRaiseSize` 时，允许行动并提高 `currentBet`，不更新完整加注单位。
- 已行动玩家仅在 `currentBet - lastActedBetLevel >= lastActedFullRaiseSize` 时重新获得 Raise 权。
- 尚未在当前下注序列行动的玩家保留 Raise 权；Raise 权关闭不影响 Fold 或 Call。
- 有足够筹码却提交低于最小值的 `raiseTo` 会得到稳定的 `RAISE_BELOW_MINIMUM`；只有恰好投入全部剩余筹码的短额动作可走 `allIn`。

一轮结束必须同时满足：所有未 Fold/All-in 的玩家已响应当前 Bet Level，且本街投入等于 `currentBet`。完整 Raise 会使其他可行动玩家重新处于待响应状态；不能只看一个全局 `hasActed`。
