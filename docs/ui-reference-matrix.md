# Step 6.5 UI 参考图需求矩阵

参考目录：`.\学习素材`
读取结果：16/16，均为 1280×2778 JPEG。
分发规则：Non-distributed local design references；原图不提交、不复制品牌素材、不进入 Build/PWA/Docker。

状态说明：16 项均已实现并纳入单元/集成/Playwright 验收；文件名是需求说明的最高优先级，图片只用于补充布局与状态。

## 1. 玩家大于1后房主可点击中间按钮开始有效.jpg

- 页面状态：等待玩家、房主且有效玩家 ≥2。
- 文件名需求：中间按钮只对房主有效；一名玩家时不可开始。
- 提取布局规则：全屏绿色舞台；座位围绕中央信息；主操作位于中心；顶部轻量工具栏。
- 提取交互规则：房主点击权威开始；非房主显示等待；按钮不能只是前端视觉开关。
- 实现文件：`TableCenterInfo`、`MobileTableStage`、shared `table:start`、Server realtime/runtime。
- 测试：table-start server tests、E1、mobile geometry。
- 状态：已实现并测试。

## 2. 开始后界面ui，注意牌面位置，实施牌型，弃牌加注等动作，当前下注额度，快捷加注按钮，以及倒计时动画在弃牌上.jpg

- 页面状态：Hero 当前行动。
- 文件名需求：牌面位置、实时牌型、动作、当前下注、快捷加注和弃牌倒计时完整可见。
- 提取布局规则：Hero 固定底部；board/pot 居中；操作区贴底；弃牌视觉醒目。
- 提取交互规则：仅 legalActions；比例按钮显示整数值；deadline 环绕弃牌；不乐观改筹码。
- 实现文件：`HeroHand`、`HandStrengthLabel`、`ActionPanel`、`ActionDeadlineRing`。
- 测试：mobile-table、hand-strength、action-panel、deadline、E2/E7。
- 状态：已实现并测试。

## 3. 等待对方行动页面，注意可以托管，此次托管仅仅保护下一次动作，托管原则是在不继续投入筹码的情况下尽可能留在牌局。保位离卓后进入长期托管.jpg

- 页面状态：等待其他玩家行动。
- 文件名需求：一次性托管只保护下一次决策；零额外投入；保位离桌转长期托管。
- 提取布局规则：等待时隐藏普通行动按钮，保留两个低干扰托管控件和 Hero 信息。
- 提取交互规则：Check else Fold；可取消；触发/手结束清除；Reserved Away 每次决策同策略。
- 实现文件：`ActionPanel`、autopilot commands/runtime/transition、`TableMenuPopover`。
- 测试：autopilot、reserved-away、E3/E4。
- 状态：已实现并测试。

## 4. 加注点开后有拖拽条.jpg

- 页面状态：加注 overlay。
- 文件名需求：点开加注后使用拖拽条。
- 提取布局规则：暗色遮罩、中央竖向刻度、金额气泡、底部确认，原桌弱化但不位移。
- 提取交互规则：触摸/键盘、min/max/all-in、比例快捷、整数 clamp、stale state 关闭/刷新。
- 实现文件：`RaiseSliderOverlay`、`ActionPanel`。
- 测试：raise-slider unit/geometry、E5。
- 状态：已实现并测试。

## 5. 牌局中ui，注意中间的公共盘区域，以及房间中间长期显式的信息（网站广告不需要）以及手牌下当前牌型变化.jpg

- 页面状态：flop/turn/river 进行中。
- 文件名需求：中央公共牌和长期房间摘要；Hero 牌型随 board 变化；无广告。
- 提取布局规则：board/pot 优先，房间摘要低对比，座位不遮挡中央。
- 提取交互规则：服务器/共享 Poker Core 牌型；不发送他人牌型。
- 实现文件：`TableCenterInfo`、`BoardCards`、`HandStrengthLabel`。
- 测试：hand-strength、center-info、E7。
- 状态：已实现并测试。

## 6. 对局结束后的（反应）画面.jpg

- 页面状态：结算后的 POST_HAND_REVIEW。
- 文件名需求：提供结算反应/观察画面。
- 提取布局规则：完整 board、公开牌、结果与 3-2-1 倒计时保持可见。
- 提取交互规则：Review 结束前不发下一手；active hand 预选的待亮牌在此阶段锁定公开；deadline 权威。
- 实现文件：`PostHandReviewOverlay`、review runtime/snapshot。
- 测试：post-hand-review、recovery、E8。
- 状态：已实现并测试。

## 7. 赢家视角.jpg

- 页面状态：Hero 获胜 Review。
- 文件名需求：明确赢家反馈。
- 提取布局规则：项目原创 `YOU WIN!` 与 `+金额`，不复制字体/特效。
- 提取交互规则：金额来自已提交 settlement；动画/声音不影响结果。
- 实现文件：`PostHandReviewOverlay`、`SoundManager`。
- 测试：winner feedback/sound、E8。
- 状态：已实现并测试。

## 8. 历史牌局信息注意下方组件，每手牌一个页面可切换，偷偷看即付费看牌，直接看所有人.jpg

- 页面状态：右侧历史抽屉、完整手牌页。
- 文件名需求：一手一页、底部翻页；一次偷偷看直接查看所有隐藏玩家。
- 提取布局规则：每位玩家一行、逐街动作、净结果、底部 first/prev/page/next/last。
- 提取交互规则：整手授权只扣一次；服务端过滤隐藏牌；Review 期间禁止。
- 实现文件：`HistoryDrawer`、`HandHistoryPager`、`HandAuditPage`、paid hand reveal service。
- 测试：history pager/permissions/paid-reveal-all、E9。
- 状态：已实现并测试。

## 9. 历史信息视角2注意牌没发完的话还有发发看 点击后在本界面补五张牌-不能是本局已发出去的牌，即要概率期望真实。精彩对局按钮目前不做.jpg

- 页面状态：board<5 的已完成历史。
- 文件名需求：发发看补至五张且不使用本局任何已发牌；后续明确删除精彩对局占位。
- 提取布局规则：模拟牌在当前历史页叠加；按钮区与翻页区分离。
- 提取交互规则：全局一次生成/持久化，参与者分别付费后看到同一结果；不改历史结算；精彩对局不显示。
- 实现文件：`HypotheticalRunoutView`、runout service/model、`HandAuditPage`。
- 测试：hypothetical-runout、no-card-reuse、E10。
- 状态：已实现并测试；2026-08-25 已删除精彩对局占位。

## 10. 输光后自动跳出买入按钮，如果拒绝买入则自动站起，如果玩家不够则牌局停发但不停表.jpg

- 页面状态：结算后 Hero stack=0。
- 文件名需求：自动补码弹窗；拒绝则安全站起；不足两人停发不停表。
- 提取布局规则：移动居中买入弹窗覆盖桌面，桌面状态仍可理解。
- 当前交互规则：BUSTED 不参加下一手并自动释放 Seat；重新坐下或补充房间点数不修改 Wallet；Session 关闭保持 exactly-once。
- 实现文件：`BustedRebuyModal`、`BuyInModal`、settlement/accounting/runtime。
- 测试：busted-rebuy、manual restart、E11。
- 状态：已实现并测试。

## 11. 聊天界面，注意不要受广告干扰我们没有广告。功能可不做，但切出页面的组件需要占位.jpg

- 页面状态：左侧聊天抽屉已按后续书面需求升级为真实房间文字聊天。
- 文件名需求：有切出组件；无广告；聊天业务可不做。
- 提取布局规则：左侧深色抽屉、独立消息列表、固定输入/Emoji 区；已入座玩家在头像附近显示不遮挡控件的分段气泡。
- 提取交互规则：与右抽屉互斥；RoomMember 通过 Socket 发送，120 grapheme 上限、50 条临时历史、24 grapheme 气泡分段；不使用 Storage，不提供语音。
- 实现文件：`ChatDrawer`、`PlayerChatBubble`、`room-chat-store`、Realtime room chat。
- 测试：严格协议、服务端权限/限流/幂等/恢复、抽屉发送、Emoji、气泡替换。
- 状态：后续授权功能已实现并测试。

## 12. 创建对局。发两次和保险功能可不做，但先占位.jpg

- 页面状态：移动创建房间。
- 文件名需求：发两次和保险显示占位但不可用。
- 提取布局规则：分组卡片、滑条/选择器、底部清晰创建操作。
- 提取交互规则：真实字段保持；两个占位禁用且不进入请求；不提供 Ante/Straddle。
- 实现文件：`CreateRoomPage`。
- 测试：create-room placeholders/no backend fields。
- 状态：已实现并测试。

## 13. 开局后等待玩家页面。注意周边组件以及中间信息。中间邀请好友按钮和右上角+号组件等价复制房间信息到剪贴板.jpg

- 页面状态：已进入桌但有效玩家不足。
- 文件名需求：中央邀请与右上 + 等价复制邀请。
- 提取布局规则：周边空座、顶部工具、中间摘要/邀请、Hero 底部。
- 提取交互规则：统一 `copyRoomInvite()`；安全内容、Clipboard fallback、toast。
- 实现文件：`TableTopBar`、`TableCenterInfo`、invite utility。
- 测试：clipboard success/fallback/privacy、E1。
- 状态：已实现并测试。

## 14. 右上角购物车展开，带入和买钻石，钻石即积分，这里没有付费系统，买入积分可占位.jpg

- 页面状态：购物车 popover。
- 文件名需求：展示带入和积分购买；项目无付费，积分购买占位。
- 提取布局规则：右上小型浮层，显示当前积分与两个入口。
- 当前交互规则：购物车直接打开补充后手托条；坐下或站起并保留活动 GameSession 的玩家都可补充。托条默认单次最大值，单次上限为 Initial Buy-in，可多次补充；操作不改变钻石。
- 实现文件：`TableTopBar`、`WalletPopover`、`BuyInModal`。
- 测试：wallet popover/placeholder no write。
- 状态：已实现并测试。

## 15. 左上角功能按钮，注意提供站起，桌面设置是更换背景皮肤，可占位，站起后点击主屏幕头像加号可坐下。保位离桌自动进入托管，托管功能见后，有60s倒计时或随时返回.jpg

- 页面状态：左上菜单展开。
- 文件名需求：站起、皮肤占位、可重新坐下、保位离桌/托管/60 秒/返回。
- 提取布局规则：左上锚定的紧凑深色菜单，不占满屏。
- 当前交互规则：站起记录最终房间点数并关闭会话，或进入 leave-after-hand；不转入 Wallet。保位不释放 seat/stack；skin 禁用“暂未开放”。
- 实现文件：`TableMenuPopover`、Seat commands/accounting/runtime。
- 测试：menu/state visibility/reserved-away/reseat、E4。
- 状态：已实现并测试。

## 16. 保位离卓后ui.jpg

- 页面状态：玩家 RESERVED_AWAY。
- 文件名需求：清晰展示暂离状态、剩余秒数和随时返回。
- 提取布局规则：原座位保留，头像覆盖“暂离 + 秒数”；中心/座位提供“回到牌桌”。
- 当前交互规则：服务器 deadline，不参加下一手；返回清托管；过期关闭会话/leave-after-hand exactly once，不修改 Wallet。
- 实现文件：`PlayerSeat`、`TableMenuPopover`、reserved scheduler/snapshot。
- 测试：reserved-away geometry/recovery/process/exactly-once、E4。
- 状态：已实现并测试。
