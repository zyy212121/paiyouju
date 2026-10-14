# 对局历史与确定性回放

## 权限边界

历史接口只接受 Session 中的用户身份。`GameSession`、`HandRecord` 和 replay ID 不是授权凭据：对局详情要求当前用户拥有该 GameSession；带 `roomId` 的房间手牌列表、手牌详情和回放要求存在当前用户的 `RoomMember`。对无权 ID 统一返回 not-found 语义，不透露记录是否存在。

`GET /api/games` 与 `GET /api/hands` 使用有界、opaque、稳定游标。对局按 `(startedAt,id)`，手牌参与记录按 `(createdAt,handId)` 倒序；数据库有同序复合索引。游标类型错误、损坏或跨资源使用返回 `INVALID_CURSOR`。

## Hand Detail 投影

每名玩家的底牌由服务端投影为互斥分支：

| 分支 | 可见条件 | `holeCards` |
| --- | --- | --- |
| `OWN` | 当前用户自己的牌 | 两张牌 |
| `PUBLIC_SHOWDOWN` | 结算规则已公开 | 两张牌 |
| `PURCHASED` | 当前用户持有该目标的购买授权 | 两张牌 |
| `HIDDEN` | 其余情况 | 必须为 `null` |

浏览器只收到投影结果。`HIDDEN` 组件没有牌码参数，DOM、aria、URL、storage 和 Cache Storage 中都不会先收到牌再隐藏。购买者的授权不会出现在其他用户的详情或 realtime broadcast 中。

牌桌现场的逐张主动亮牌不形成历史公开权限。即使一张或两张牌曾在 Review 期间公开，后续历史对未购买的其他查看者仍投影为 `HIDDEN`；只有规则产生的 Showdown/All-in 公开或当前查看者自己的偷偷看授权才能展开。共享协议暂时保留 `PUBLIC_VOLUNTARY` 仅用于读取旧客户端形状，新历史服务不会再产生该分支。

每个完整可见的两张底牌同时返回确定性 `handLabel`。标准牌与短牌分别使用当局对应评牌规则，发两次的两个分支分别用各自 Board 计算；翻牌前结束的牌局显示“一对”或“高牌”。隐藏或部分可见牌必须返回 `handLabel:null`，防止从牌型反推私牌。行动记录继续保存 `automatic` 供审计，但玩家界面只显示动作与金额，不追加“（自动）”。

## Replay Timeline

回放仅从已经原子提交的 `HandRecord + HandPlayerRecord + HandActionRecord + HandPotRecord` 重建，不使用 Snapshot、牌堆、随机数或客户端推断。Builder 先验证：

- 玩家、座位和行动 sequence 唯一且连续；
- 行动 actor/seat、amount 与 Raise To 形状一致；
- Board 长度和街道推进完整；
- 每个 pot 的规范化 contribution layer、eligible players、winner 与 odd chip 引用一致；相邻相同 eligible players 不得在新结算中重复分池；
- 新结算的全部投入、全部 Pot Award、最终 stack 与所有点数守恒；只读兼容路径另行核对旧记录中的 uncalled return。

验证后生成 Hand Start、盲注、行动、Flop/Turn/River、Showdown、公开/已授权牌、主/边池分配、Odd Chip 和 Hand Finish 事件。暴击历史根据冻结的实际暴击盲注为每名参赛者生成强制投入，并直接从 Flop 开始，不伪造普通 Small/Big Blind。共享纯函数 `applyReplayEvent` 不修改输入、无网络或随机性；可从第 0 步确定性 Previous/Next/Reset/Jump/Play 到最终状态。最终所有 pot 必须归零且每位 stack 必须等于持久记录。仅修复前已持久化的旧式记录可在只读兼容分支生成 Uncalled Return 事件；新牌局不会生成该事件。

修复规范化分池或全投入入池规则前已持久化的历史仍按原记录回放，避免现有历史突然不可用；新牌局只接受规范化、Pot 总额等于总投入的结构。旧记录不会被静默重算或改写最终后手，但数据审计会把旧式退款记录列为需要迁移的异常。

旧 Hand 的收费配置默认为关闭。若旧记录缺少足以严格重建的数据，详情仍可显示安全的已存行动，但 replay 返回 `REPLAY_NOT_AVAILABLE`；系统绝不猜测或伪造时间线。

## 一手一页与扩展能力

移动桌右侧历史抽屉按完成时间 keyset 加载，始终只展示一手。底部 first/previous/page/next/last 控件不会把多手详情堆叠到桌面。页面包含角色、座位、起止 stack、净结果、逐街动作、公共牌、可见底牌和结算摘要。

Review 结束后，房间成员都可使用“偷偷看”一次授权自己查看该手全部隐藏牌；旧任一逐目标授权也视为整手授权。“发发看”同样向房间成员开放，只在 board<5 时显示持久化模拟补牌，并明确不属于 replay/真实 history。围观者的摘要、详情和回放不包含 OWN 底牌、个人起止 stack 或净结果。CLOSED Room 软归档不会删除或改变这些详情。

普通模式“发两次”仍持久化为同一个权威 Hand，但列表和详情投影为 `<handNumber>-1` 与 `<handNumber>-2`。两个分支分别读取对应 `HandRunoutRecord/HandRunoutPotRecord`，显示本副公共牌、赢家、底池和净结果；每个行动金额、`raiseTo` 与每位玩家投入按第一副向上取整、第二副取余数，两个分支逐字段相加必须还原原记录。每个底池也独立采用第一副向上取整的规则。偷偷看购买绑定 Hand，因此一次授权同时覆盖两个分支；两副真实公共牌已经完整保存，发两次牌局不提供“发发看”。当前逐行动 Replay 只适用于单副牌局，发两次分支使用逐街行动审计与各自完整结算详情，不伪造一条合并回放。

## 隐私与缓存

Replay 使用与详情相同的当前用户投影。Builder 可在服务器内读取完整持久记录做一致性验证，但只把 `OWN`、`PUBLIC_SHOWDOWN` 或当前购买者的 `PURCHASED` 牌写入事件/状态。主动亮牌不会进入历史 Replay 可见性；模拟补牌也永不进入 replay timeline。所有 `/api/*` 响应为 `Cache-Control: no-store, max-age=0`；Service Worker 明确排除 API、Socket.IO、health/readiness。

Step 7 完成 Hand 审计可在 ADMIN 授权下读取完整已结束 Hand，并追加不含牌值的 `ADMIN_VIEW_FULL_HAND` AuditLog；活动 Hand 和未来 Board 仍不可读取。管理员查询不会改变参与者 History/Replay 投影，也不会把敏感响应写入 Service Worker Cache。
