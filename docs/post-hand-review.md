# POST_HAND_REVIEW 与待亮牌

## 四秒结算展示期

Hand settlement 与历史、Seat 终态、`reviewEndsAt=finishedAt+4000ms` 和 Review Snapshot 在同一提交边界完成。Runtime 进入 `POST_HAND_REVIEW`，保留完整公共牌、结果、赢家增量和开手前选定的逐张公开状态。Review 结束前不得开始下一手、执行整手付费看牌或模拟补牌。

Review deadline 是服务端绝对时间，不因动画、音效、刷新、Socket 重连或主动公开延长。未来 deadline 在重启后恢复剩余时间；已过 deadline 排队一次结束处理。人数和房间状态仍允许连续发牌时，Review 到期直接开始下一手，不再广播第二段“等待下一手”或再走一次开手倒计时；人数不足、暂停、要求房主重启或 CLOSING 时才进入相应等待/关闭流程。CLOSING 房间也必须完成 Review，之后才记录最终房间点数并关闭 Seat/GameSession，不改变 Wallet。

## 待亮与公开

实际收到过底牌的参与者可在一手仍处于 active 时发送 `hand:reveal-own-cards`，请求只携带本人牌槽 `cardIndex: 0|1`，不携带牌码或其他玩家目标。每次请求切换该槽的私人 `pendingShowCardIndices`：第一次选择为待亮，再次点击取消。其他接收者永远看不到进行中手牌的待亮选择。

结算事务把当时的待亮槽写入 `HandPlayerRecord.voluntarilyRevealedCardIndices`，并在 Review 投影中公开；进入 Review 后不再接受选择或取消。本人待亮牌在 active 阶段使用 Eye/暖色“待亮”标识，Review 时移动到头像区域；其他玩家只收到最终公开槽，另一张仍为牌背/`null`。Showdown 自动公开不冒充主动公开。下一手开始后 Seat 待亮状态清空。此功能不改变 Wallet、Table Stack、赢家、原结果或 Review deadline。
