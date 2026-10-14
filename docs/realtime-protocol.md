# 实时协议

## 连接和认证

Socket.IO path 为 `/socket.io`，只接受精确 `CLIENT_ORIGIN` 和有效 HttpOnly Session Cookie。握手、每个入站事件、广播和开手参与者准备都会重验 Session；logout/撤销/绝对过期会主动断连并清 Presence。订阅还要求 `RoomMember`。

## 严格类型

`packages/shared/src/realtime.ts` 当前 `PROTOCOL_VERSION=9`，定义 Zod-backed：`ClientToServerEvents`、`ServerToClientEvents`、`InterServerEvents`、`RealtimeSocketData`、`TableStateProjection`、`TableEvent`、`RealtimeError`、`CommandAcknowledgement<T>`、`LegalActionProjection`、`HandProjection`、`SeatProjection` 和 `PresenceProjection`。核心实时 payload 不使用裸 `unknown` 或 `as any`。

所有写命令统一返回：

```json
{"ok":true,"requestId":"uuid","stateVersion":8,"data":{}}
```

```json
{
  "ok":false,
  "requestId":"uuid",
  "error":{"code":"STALE_STATE","message":"牌桌状态已更新"},
  "stateVersion":9,
  "latestState":{}
}
```

订阅/请求状态没有客户端 request ID 时由服务器生成安全 UUID。

`table:state` 的每个座位包含固定头像库中的 `avatarId`。头像与昵称都来自服务器 User 资料；个人资料保存后，活动房间通过原单桌串行队列发布新的展示版本。客户端只使用内置精灵图渲染该 ID，不接受图片 URL、Base64 或上传内容。

## Client → Server

- `table:subscribe {roomId}` / `table:request-state {roomId}`
- `seat:take {roomId,seatIndex,buyInAmount,operationId,expectedStateVersion}`
- `stack:buy-in {roomId,amount,operationId,expectedStateVersion}`
- `seat:sit-out|seat:return {roomId,operationId,expectedStateVersion}`
- `seat:leave {roomId,operationId,expectedStateVersion,confirmSquidPenalty?}`；需要承担/放弃鱿鱼结算时必须显式确认
- `seat:set-trusteeship {roomId,enabled,operationId,expectedStateVersion}`；开启/取消持久“让或弃”
- `action:submit {roomId,handId,clientActionId,expectedStateVersion,action}`
- `table:start {roomId,operationId,expectedStateVersion}`
- `hand:arm-next-action-autopilot {roomId,mode:CHECK_OR_FOLD|CALL,operationId,expectedStateVersion}` / `hand:cancel-next-action-autopilot {roomId,operationId,expectedStateVersion}`
- `seat:reserve-away {roomId,operationId,expectedStateVersion}`；`seat:return` 同时用于 60 秒内返回
- `hand:reveal-own-cards {roomId,handId,cardIndex:0|1,operationId,expectedStateVersion}`
- `hand:buy-time-extension {roomId,handId,operationId,expectedStateVersion}`；只允许当前行动者在 deadline 最后 3 秒调用
- `hand:choose-runout-count {roomId,handId,choice:ONCE|TWICE,operationId,expectedStateVersion}`；只允许本次双人 All-in 的两名协商者在 5 秒截止前调用
- `room:chat-send {roomId,clientMessageId,content}`；只允许已订阅且仍是 RoomMember 的用户，单条最多 120 个 Unicode grapheme，原生 Emoji 组合按一个字符计

`seat:take.buyInAmount` 是保留但不作为权威的历史字段：首次入座由服务器强制使用 Room Initial Buy-in，重新入座恢复同一 GameSession 的 `detachedStack`，两者都不采用客户端金额。`stack:buy-in.amount` 是两手之间的正整数补点，单次不超过 Room Initial Buy-in；坐下时增加 Seat stack，站起时增加活动 GameSession 的 `detachedStack`，均受个人累计与整桌安全上限约束。`seat:leave` 保存后手并释放 Seat，不关闭 GameSession；房间最终关闭才统一结算会话。

Action 是 `fold|check|call|bet|raiseTo|allIn` 的 discriminated union；金额是整数，`raiseTo` 表示本街最终累计投入。客户端不能发送 userId、cards、stack、pot、winner、deadline 或 automatic。

## Server → Client

- `table:state`：按接收者投影的完整权威状态；
- `table:event`：严格 typed 的公开领域事件/Runtime/恢复状态事件；
- `table:error`：安全错误码、message、requestId、可选版本/latestState。
- `room:chat-message`：全桌同一条已规范化聊天消息，包含服务器 UUID/时间、公开昵称和发送当刻的可选 seatIndex；
- `room:chat-history`：每次正式订阅后返回本进程内该房间最近 50 条聊天，重连不会把旧消息重新播放成头像气泡。

`stateVersion` 只随持久业务状态单调增长；`presenceVersion` 单独跟踪连接集合。Web 拒绝较低 stateVersion，同业务版本只接受更高 presenceVersion。

房间聊天不改变 Poker Runtime、stateVersion、Wallet 或 Table Stack，不进入 PostgreSQL、Snapshot、管理员完整牌局 NDJSON、浏览器 Storage 或 PWA Cache。服务端进程重启会清空聊天；这是当前单活动实例下的临时房间交流，不是长期消息档案。`clientMessageId` 在“房间 + 发送者”范围幂等，相同重试返回原消息且不再次广播。每账号跨 Socket 每 10 秒最多发送 5 条新聊天，通用实时命令限流仍同时生效。未入座的房间成员可以聊天并在抽屉历史中显示，但没有座位头像气泡。

`TableStateProjection.nextActionAutopilot` 对本人投影当前一次性预操作；`CALL` 额外包含武装时的 `currentBet/callAmount`。其他玩家下注使最高投入变化时，服务端在同一持久 transition 中取消所有旧绑定 `CALL`，但保留 `CHECK_OR_FOLD`。本人 Seat 还投影 `trusteeshipEnabled`；常驻托管优先于一次性预操作并持续执行 Check else Fold，直到本人取消。Room/Seat 投影同时包含鱿鱼模式、固定额度、轮次、10 秒提示截止、标记和本轮参与资格，以及暴击频率、盲注倍数和下一绝对截止；暴击 Hand 另投影本手实际强制盲注。`SeatProjection.publicHandLabel` 只在两张底牌均已公开且已具备五张牌可严格求值时返回，未公开信息不参与 UI 牌型标签。

普通模式启用“发两次”后，`HandProjection.runoutVote` 只公开截止时间、两名可投票用户、已响应用户和接收者自己的选择，不公开对手选择。协商完成后的 `runoutBoards` 固定为两副五张公共牌，`runoutResults` 分别投影每副底池、获奖用户以及参与者自己的整数净结果；围观者的个人净结果为 `null`。协商 deadline、选择和最终两副牌均进入 Snapshot，重启不会重置 5 秒时间或重复结算。

## 鱿鱼模式

`specialMode=SQUID` 时，唯一主池赢家在手末获得 `squidMarked`。仅剩一个本轮无标记者时，服务器在同一手末事务完成 `SQUID_SETTLEMENT`、必要的自动补点、轮次重置和 10 秒 `squidRoundGraceEndsAt`；边池与主池平分不授标。普通中途加入者以无标记状态进入当前轮；仅在未标记者确认离开、付款/收款集合已冻结后加入的人投影为 `squidRoundParticipant=false`，不追溯参与该次结算。提示期内站起免费，其他时点的受影响离开必须带 `confirmSquidPenalty=true`；服务端仍重新计算责任，不能由客户端指定付款人、收款人或金额。完整规则见 `docs/squid-mode.md`。

## 暴击模式

牌桌首次正式开始时写入 `bombPotNextAt`。绝对截止到达后，下一手实际提交时把每名参赛者的 `min(stack, bigBlind × multiplier)` 作为强制投入，跳过普通大小盲和翻前行动并直接投影三张 Flop；同一提交把下一截止重置为“该手开始时间 + 间隔”。人数不足或房主暂停不会推进一手，也不会延长已经运行的绝对截止。

托管与一次性预操作只在强制投入完成后处理 legal action。因而普通 Small/Big Blind 和暴击盲注都不能被托管绕过；后手不足目标时按全下强制投入处理。

## Commit-before-broadcast 与幂等

任何成功状态变化先提交 Snapshot/Receipt/Settlement，再更新 Runtime，再广播。`SNAPSHOT_CONFLICT`、数据库错误或故障注入点发生在 commit 前时不会发送候选结果；commit 后广播前崩溃时，重启由 Snapshot 恢复，客户端重新订阅取得 canonical state。

持久座位命令以 `(scope,actorId,operationId)` 精确 replay。Web 在 timeout/disconnect 后保留同一 operationId 和原 expectedStateVersion：用户再次点击相同意图会重用；收到明确成功/拒绝或 canonical state 已证明操作完成后清除。不同意图不会复用该 ID。

Action 使用 `(roomId,userId,clientActionId)` 的 PostgreSQL Receipt。相同 ID/相同 payload 跨进程精确 replay；不同 payload 返回 `ACTION_IDEMPOTENCY_CONFLICT`。Web 不会自动重放或生成新的扑克 action ID。

## Deadline、断线与恢复

首次牌局只由房主手动开始，再进入固定开手倒计时。首次开始后若人数不足，服务器每 30 秒复核，人数恢复时自动进入 5 秒开手倒计时；房主暂停会覆盖这条自动恢复。行动、房间到期、60 秒保位离桌、4 秒 Review、鱿鱼新轮 10 秒提示和暴击频率 deadline 都是 Server 绝对 ISO 时间并写入 Snapshot。刷新或进程重启不会延长 deadline。超过绝对 deadline 的 action 会在队列内拒绝；过期恢复只执行一次相应的权威处理。连续发牌条件满足时，Review 到期直接提交下一手状态；鱿鱼轮次刚结算时则先等待提示 deadline。房间到期时当前手继续，结算/Review 后进入 CLOSED；空闲桌禁止再开手。

`hand:buy-time-extension` 在同桌串行队列中锁 Wallet，固定扣除 10 钻石并把当前 deadline 延后基础行动时间的一半。相同 operation 精确 replay，不重复扣费；每次购买都会返回新的绝对 deadline 和 Wallet 余额。

断线不离桌、不停发，也不把 Seat 改成 SIT_OUT。服务端立即按临时 `TRUSTEESHIP` 执行 Check else Fold，并继续把该 `ACTIVE/stack>0` Seat 纳入后续开手和强制盲注；这项临时托管不写入玩家主动 `trusteeshipEnabled`。重连先禁用旧 legalActions，自动 resubscribe；canonical state 到达后取消临时断线托管并恢复当前权威 deadline，玩家主动开启的常驻托管保持不变。断线前结果不确定的命令只请求最新状态，不猜测成功与否。

## 隐私投影

每个 Socket 单独投影：本人看到自己的两张牌；非行动者没有 legalActions；fold-to-win 不公开对手牌；showdown 只公开 Poker Core 标记公开的牌。Deck/remaining deck/future board、其他玩家未公开牌、Snapshot、Session、GameSession、内部 timer/cache 永不发送。

`PERSISTENCE_ERROR` 隐藏未提交 finished hand 与未提交 stack；`RECOVERY_ERROR` 隐藏当前手并冻结写操作，不以空牌局或新手替代损坏状态。

进行中手牌的 `hand:reveal-own-cards` 请求不携带牌码，只携带本人 `cardIndex`，用于切换仅本人可见的 `pendingShowCardIndices`；切换会广播按接收者过滤后的新投影。进入 `POST_HAND_REVIEW` 时所选槽锁定并成为公开牌，Review 内拒绝更改。`SeatProjection.voluntarilyRevealedCardIndices` 标识已公开槽，`HandProjection.publicHoleCardSlots` 对未公开槽固定投影 `null`；旧的 `publicHoleCards` 只在两张都公开或 Showdown 时出现。整手看牌/模拟补牌使用 no-store HTTP，不新增返回私牌或 remaining deck 的 Socket 事件；购买成功不广播。手机号永不进入 Socket 投影。昵称更新只触发公开昵称重新投影，不改变筹码或历史记录。

## 稳定错误码

- 认证/权限：`SOCKET_AUTH_REQUIRED`、`ROOM_ACCESS_DENIED`
- 房间/座位：`ROOM_NOT_OPEN`、`TABLE_NOT_AVAILABLE`、`TABLE_CLOSING`、`TABLE_CLOSED`、`SEAT_*`、`PLAYER_*`
- 记账：`BUY_IN_OUT_OF_RANGE`、`INSUFFICIENT_WALLET_BALANCE`、`BUY_IN_DURING_HAND`、`IDEMPOTENCY_*`
- 行动：`NOT_PLAYER_TURN`、`HAND_ID_MISMATCH`、`STALE_STATE`、`ACTION_IDEMPOTENCY_CONFLICT`、`ILLEGAL_ACTION`
- 系统：`PERSISTENCE_ERROR`、`SNAPSHOT_CONFLICT`、`RECOVERY_ERROR`、`INVALID_REQUEST`
- 生命周期：`ROOM_OWNER_REQUIRED`、`TABLE_START_NOT_ALLOWED`、`AUTOPILOT_NOT_AVAILABLE`、`RESERVED_AWAY_NOT_AVAILABLE`、`SQUID_RESERVED_AWAY_DISABLED`、`SQUID_LEAVE_CONFIRMATION_REQUIRED`、`HAND_REVIEW_IN_PROGRESS`、`HAND_REVIEW_CLOSED`、`CARDS_ALREADY_PUBLIC`、`TIME_EXTENSION_NOT_AVAILABLE`、`RUNOUT_CHOICE_NOT_AVAILABLE`

Web 将本地断线/超时/服务器拒绝稳定映射为 `REALTIME_DISCONNECTED`、`REALTIME_TIMEOUT`、`REALTIME_COMMAND_REJECTED`；所有 pending timer/promise 在 ack、断线或超时后只 settle 一次。

## Step 7 传输安全（Protocol v5）

协议版本不递增；只追加向后兼容事件与安全错误码。握手要求精确 Origin 与有效 Session：同一 IP 每分钟最多 30 次握手、同一账号每分钟最多 12 次握手且同时最多 5 个 Socket。单 Socket 每 10 秒最多 120 条命令；同账号跨 Socket 每 10 秒最多 80 条命令，未知事件和无效 payload 同样计数。坐下、站起、暂停、返回和保位合计每 30 秒最多 6 个新意图，不能通过新建 Socket 重置；同一事件和 `operationId` 的幂等重试不重复占用座位额度，但仍计入通用命令额度。聊天另受每账号每 10 秒 5 条新消息限制，相同 `clientMessageId` 重试不重复占用聊天额度。应用 payload 上限 64 KiB，超大 payload 返回 typed `PAYLOAD_TOO_LARGE` 或由 transport 关闭，未知事件返回稳定拒绝。每条命令和私有广播持续复核 Session，logout/revoke/expiry 主动断开。
