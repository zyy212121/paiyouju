# “发发看”假设性补牌

## 可用条件与语义

已完成、Review 已结束、实际 board 少于 5 张且当前用户仍是该房间成员的 Hand 可调用 `POST /api/hands/:handId/hypothetical-runout`。参与者与围观者首次查看都支付固定 10 娱乐钻石；历史中的“精彩对局”占位已删除。

## 无重复抽取

新 Hand 在结算时保存权威 `remainingDeck`。首次生成优先按其原顺序取够 `5-board.length` 张，标记 `ORIGINAL_REMAINING_DECK`。旧 Hand 没有可信剩余牌堆时，服务端建立标准 52 张集合，排除实际 board 和所有真实 hole cards，再使用 `node:crypto` CSPRNG 无放回抽取，标记 `CSPRNG_LEGACY_FALLBACK`。生产路径不使用 `Math.random()`。

事务按稳定顺序锁 Wallet 与 Hand/Runout，以 `HandHypotheticalRunout.handId` 唯一约束保证全局只生成一次，并以 `HypotheticalRunoutPurchase(buyerUserId,handId)` 保证每位房间成员最多扣一次。相同 operation 精确 replay；不同购买者付费后获得完全相同的结果。未购买者的历史详情不返回补牌。响应只返回实际 board、模拟补牌和来源，不返回排除集合、任何隐藏牌或 remaining deck。

## 不变量

模拟补牌不写 Hand board/action/pot/result，不重算赢家、净结果或统计，不改 Table Stack，不进入权威 replay，也不改变原 settlement fingerprint。购买只写负向 Wallet 流水和个人授权，费用不进入任何玩家账户。软归档不会立即删除记录；Room 关闭满 30 天后由统一保留任务删除模拟结果、购买记录和关联历史。

Step 7 后台分别列出全桌唯一结果记录和每用户购买，但默认不联带隐藏 Hole Cards。数据审计验证每 Hand 最多一份结果、牌无重复且不含真实已发牌、每用户最多购买一次、费用固定 10 钻石且有匹配 Ledger；一个用户购买绝不授权其他用户。
