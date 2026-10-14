# Main Pot 与 Side Pot

`buildPots` 按所有正 `committedThisHand` 的不同升序层级切片：

```text
slice = (level - previousLevel) * contributorsAtOrAboveLevel
```

`contributors` 包含达到该层的所有玩家，包括 Fold 玩家；`eligiblePlayers` 只含达到该层且未 Fold 的玩家。原始切片不是最终 Pot 边界：相邻切片若拥有完全相同的 `eligiblePlayers`，必须先合并金额和贡献者，再进行评牌与奇数筹码分配。第一个规范化池是 Main Pot，只有获胜资格集合发生变化时才产生后续 Side Pot。这样 Fold 玩家不同深度的死钱不会制造假边池，也不会让同一批并列赢家因重复取整而错分奇数筹码。

所有已提交点数都进入可派奖的 Pot，新完成手的 `uncalledReturnsByPlayer` 恒为空。若最高层只有一个未 Fold 贡献者，仍保留为只由该玩家获胜的锁定末层池；这是对既成投入的结算记录，不是需要再次竞争的行动池。若更高层只包含 Fold 玩家的死钱，该金额合并进最近一个仍有合法获胜资格的池。

进行中的牌桌投影与最终结算分开计算：实时主池始终包含所有已经投入的点数；只有实际 All-in 的累计投入形成获胜资格上限时才显示边池。因而 10/20 盲注开局显示主池 30，普通下注深度不同不会显示边池，All-in 后才按其封顶层展示主池/边池。若小盲投入 10 后正常弃牌，大盲投入 20，则两个相同获胜资格层合并为一个 30 主池，大盲获得 30，没有退回。

并列时每人先得到 `floor(amount / winnerCount)`。余下 Odd Chips 从 Button 左侧开始按实际座位顺时针发给该池的并列赢家，每个池单独计算。结算同时验证：

```text
all pots = total committed
all awards = all pots
sum final stacks = sum starting stacks
```
