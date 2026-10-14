# 预操作、常驻托管与保位离桌

## 两种等待预操作

玩家等待他人行动时可以选择以下一种预操作，再次点击同一按钮可取消；改选另一种会原子覆盖旧选择：

- **让或弃**（`CHECK_OR_FOLD`）：下一次成为 actor 时，能 Check 就 Check，否则 Fold。其他玩家更新本街最高投入时不会取消该模式。
- **自动跟注**（`CALL`）：只在当前确有待跟金额时允许武装。服务器同时保存武装时的 `currentBet` 和待跟金额；玩家成为 actor 前只要本街最高投入发生变化，该模式立即取消且不代替玩家行动。若绑定值未变且 Call 仍合法，服务器只 Call 一次并原子清除。

两种预操作都不会自动 Bet、Raise 或 All-in，也不会退回此前已投入的筹码。`CALL` 最多投入武装时已经明确展示的待跟金额；下注变化后必须由玩家重新决定。自动行动持久化 `automatic=true`，并分别记录 `NEXT_DECISION_AUTOPILOT` 或 `NEXT_DECISION_AUTO_CALL`；普通超时记录 `TURN_TIMEOUT`。

预操作只在服务端单桌队列中执行。刷新、断线和进程重启会从 Snapshot/Seat 恢复同一标记，不能触发两次；手牌结束、玩家手动行动、离桌或模式触发后会清除。

## 常驻托管

左上菜单的“托管 · 让或弃”是独立的持久状态，不是下一次预操作。任意模式、任意时点都可通过 `seat:set-trusteeship` 开启或取消；开启后每次成为 actor 都只 Check，否则 Fold，直到本人取消。盲注是开手强制投入，不属于托管追加投入。常驻托管优先于一次性预操作；开启时清理一次性状态，前端隐藏手工行动按钮，避免两个意图竞争。

`TableSeat.trusteeshipEnabled`、Snapshot v3 和本人 Socket 投影共同保存该状态。刷新、断线、服务器恢复和换街不会取消；离开 Seat 才随 Seat 生命周期清除。自动动作写入 `automatic=true/automaticReason=TRUSTEESHIP`。

## 保位离桌

`seat:reserve-away` 把 Seat 置为 `RESERVED_AWAY`，保存绝对 `reservedAwayEndsAt=now+60s`，保留座位和 Table Stack。当前手余下每次决策都只使用 `Check else Fold` 的零追加策略，不使用自动跟注；下一手不发牌。用户可随时 `seat:return`，清除 deadline/长期托管并恢复 ACTIVE。

鱿鱼模式禁止 `seat:reserve-away` 和暂停参与，防止绕过轮次责任；常驻托管仍可正常使用。

60 秒到期时：若不在手中，保存完整后手到同一活动 GameSession 并释放 Seat；若仍在手中，转为 `LEAVE_AFTER_HAND`，结算后执行相同保存。重新入座恢复该后手，两种路径都不增加 Wallet 或总带入。Timer 只触发检查，实际变更仍经过单桌队列、Snapshot CAS 和幂等记账。重启恢复未来期限；已过期限排队一次到期处理。

UI 在原座位显示“暂离”和服务端期限倒计时，并提供“回到牌桌”。倒计时是显示值，不是客户端权威。
