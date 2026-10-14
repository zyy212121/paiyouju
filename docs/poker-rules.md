# No-Limit Texas Hold'em 规则决策

本文档是 `poker-core` 已实现规则与测试基线。Stage 2 已实现本文件第 1–8 节的独立牌局核心；第 9 节的服务器计时与连接生命周期属于下一阶段应用层，不在 Poker Core 中读取时钟或网络。

## 1. 牌局范围

只支持 2–9 人常规 No-Limit Texas Hold'em。使用 52 张标准牌，无 Joker。每位参与者最多两张私有底牌，公共牌依次为 Flop 三张、Turn 一张、River 一张。

流程：Dealer Button → Small Blind → Big Blind → Preflop → Flop → Turn → River → Showdown。合法动作集合按状态提供 Fold、Check、Call、Bet、Raise、All-in。

不支持 ante、straddle、rake 或其他变体。普通模式房间可在创建时启用双人 All-in“发两次”；特殊模式强制关闭。

## 2. Button、盲注与行动顺序

- Button 每手按仍有资格参加下一手的座位顺时针移动。
- 三人及以上：Button 左侧第一位下 Small Blind，下一位下 Big Blind；Preflop 从 Big Blind 左侧第一位开始，Postflop 从 Button 左侧第一位仍在手中的玩家开始。
- Heads-up：Button 同时为 Small Blind，另一人是 Big Blind。Preflop Button 先行动，Postflop 非 Button 玩家先行动。
- Table Stack 小于应付盲注但大于 0 时，玩家投入全部剩余筹码作为全下盲注，不被排除出该手。

所有筹码、投入和底池金额都是安全范围整数。

## 3. Bet、Raise 和最小完整加注

使用“本轮总投入”（total-to）表达下注/加注，避免把增量与目标额混淆。

- 尚无下注时，最小 bet 通常为 Big Blind（若只剩更少筹码可短全下）。
- 已有下注时，完整加注增量至少等于本轮最近一次完整 bet/raise 的增量。
- Preflop Big Blind 视作初始完整下注；初始最小加注增量是 Big Blind。
- All-in 可以小于合法完整最小加注；这会提高跟注目标，但是否重开加注权由下节决定。

示例：盲注 50/100，A raise to 300，完整加注增量是 200，因此下一次完整 raise 至少到 500。

## 4. 短全下与加注权重开

必须同时追踪：当前最高本轮投入、最近完整加注增量、每位玩家上次行动时面对的投入额、该玩家是否已对当前完整加注序列行动。

决策：

1. 达到至少一个完整最小加注增量的 bet/raise，立即为仍有筹码玩家重新开放加注权，并把实际完整增量设为新的最小加注增量。
2. 单次不足完整加注的 all-in 会提高 `amountToCall`，但不会给已经行动过且其后只面对这次短额增长的玩家重新开放 raise；他们仍可 Fold 或 Call（为零差额时 Check）。
3. 多个不足完整加注的 all-in 可以累计。对某位已行动玩家，若“当前最高投入 - 该玩家上次行动时所面对的最高投入”达到当时要求的完整最小加注增量，则该玩家的加注权重新开放。
4. 未对当前下注序列行动的玩家不因短全下丧失原有 raise 权。
5. 只能 Call 到全下的玩家不需要 raise 权；Fold 后不再有资格行动或获胜。

必须包括的测试案例：

- 100 完整下注后，单个玩家 all-in 到 150：已行动者不得 re-raise。
- 100 完整下注后，短全下依次到 150、200：若对已行动者累计增加达到 100，其 raise 权重开。
- 累计增加只有 99：不重开。
- 尚未行动的玩家面对同一组短全下仍可合法 raise。
- 不同筹码深度、轮次和 heads-up 下的相同语义。

## 5. 一轮结束与全下推进

一轮下注结束条件是所有仍有资格且仍有筹码的玩家都已行动，并且本轮投入与当前最高可匹配投入相等，或已 Fold/All-in。只有一名未 Fold 玩家时立即结束整手，不再发公共牌供结算需要。

若至少两名未 Fold 玩家但所有人都已 All-in，服务器按既定牌堆自动发完所需公共牌，然后 Showdown。普通模式开启“发两次”且最终仅有两名未 Fold 玩家时，先进入 5 秒协商；只有两人都选择发两次才执行，否则完整等待期结束后发一次。已公开公共牌复制到两副牌面，未公开牌从同一剩余牌堆先完成第一副、再完成第二副，绝不收回或重复使用。每个底池分别拆半；不能整除时第一副多 1 点，第二副取得余数。

## 6. Showdown 与底牌公开

- 所有到达 Showdown 且未 Fold 的玩家底牌自动公开。
- 提前 Fold 的底牌不公开。
- 若所有其他玩家 Fold，唯一获胜者的底牌默认不公开。
- 公共历史只包含上述公开牌；积分看牌授权不能改变公共公开状态。

牌型比较使用标准五张牌最佳组合：Straight Flush、Four of a Kind、Full House、Flush、Straight、Three of a Kind、Two Pair、One Pair、High Card。Ace 在顺子中可作为最高牌，也可用于 A-2-3-4-5；不得环绕。

## 7. 主池与边池

结算使用整手累计投入，而非仅最后一轮。Fold 玩家投入仍贡献底池，但没有任何获胜资格。

概念算法：

1. 收集所有玩家大于 0 的整手累计投入；
2. 按不同正投入层级从低到高切片；
3. 每层金额是“相邻层级差 × 在该层有投入的玩家数”；
4. 该层的获胜资格集合只包含未 Fold 且投入达到该层的玩家；
5. 相邻切片的获胜资格集合完全相同时，先合并金额和贡献者；不能把同一批赢家拆成多个池重复取整；
6. 规范化后的第一个池形成主池，只有获胜资格集合变化时才形成后续边池，分别评牌和分配；
7. 若 All-in 结算的最高层只有一名未弃牌贡献者，该层仍作为只由该玩家获胜的锁定末层池记录并派奖，不产生退款事件。

若合法行动序列导致最高层只剩已弃牌玩家的投入，该层是不可退款的死钱，合并到最近一个仍有合法获胜资格的池；绝不退款给弃牌者，也不建立无获胜者的池。

每个池记录总额、贡献者和 eligiblePlayers。金额守恒必须满足：投入总和 = 全部底池总和 = 全部派奖总和，且不抽水；新完成手的未匹配退款映射必须为空。

进行中的 UI 把已投入点数全部显示在实时底池中；没有 All-in 时只显示一个主池，All-in 累计投入形成资格上限后才显示对应边池。例：Small Blind 10、Big Blind 20 的开局主池为 30；若 Small Blind 随后弃牌，Big Blind 获得完整 30 主池，没有任何退回。

必须覆盖：多名不同全下深度、Fold 玩家贡献、多层并列、单人锁定末层池、只有两名玩家及零余额玩家。

## 8. 平分和奇数筹码

每个池独立决定并列获胜者。先用整数除法平均分配；余数形成奇数筹码。

奇数筹码从 Dealer Button 左侧第一个座位开始，沿顺时针遍历，只发给该池的并列获胜者；每位一次一枚，继续顺时针直到余数为零。不得按加入顺序、用户 ID 或行动顺序发放。

所有池分配后验证筹码守恒，任何不守恒都是阻断错误。

## 9. 已实现状态机、事件和不变量

`startHand` 接收确定的座位、筹码、上手 Button 与完整固定牌堆；`getLegalActions` 返回 Fold/Check/Call/Bet/Raise/All-in 的精确权限和金额；`applyPlayerAction` 返回新 `HandState` 与本次新增 `DomainEvent[]`。公开 Raise 始终用 `raiseTo` 表示该玩家本街最终累计投入。

状态转换不原地修改输入。接受一个玩家动作后 `stateVersion` 严格递增；事件包含 hand、version、type 以及必要的 player/amount/street/cards/pot 数据，可 JSON 序列化用于历史与回放。事件覆盖开局、Button、盲注、发牌、各类玩家行动、街道推进、Runout、公开、退款、奖池和结束。

`assertHandStateInvariants` 验证安全整数/非负筹码、街与整手投入关系、起始筹码关系、52 张牌唯一性、公共牌数量、合法行动者、当前最高投入、Pot 资格、完成结算和全手筹码守恒。模拟器每次状态转换均执行这些检查。

## 10. 行动超时、断线和离桌

- 服务端持有绝对截止时间并决定超时；客户端计时仅为显示。
- 到时可 Check 则自动 Check，否则自动 Fold。
- 断线不改变当前投入、不退款、不离桌，也不在手末自动暂停。
- 断线座位保持 `ACTIVE`，按常驻“让或弃”托管处理：轮到时能 Check 就立即 Check，否则 Fold；强制盲注照常投入，后续手牌继续参与。重连后恢复人工行动。
- 当前参与者离桌请求在结算后执行；后手保存到同一房间 GameSession，重新入座继续使用。GameSession 只在房间最终关闭时关闭一次且不修改 Wallet。

超时动作与真人动作走同一单桌串行命令队列，只有一个能在给定状态版本上成功，避免截止瞬间双动作。

## 11. 测试纪律

每条规则先写失败测试再实现。除示例测试外，应使用属性测试验证：牌唯一性、牌型排序反对称/传递性、牌堆不重复、筹码守恒、池金额守恒、事件确定性和序列化往返。生产随机性不能成为单元测试不稳定来源。

## 12. Stage 1 已实现的 Card / Deck / Hand Evaluator 基线

卡牌内部结构使用 `rank + suit`。Rank 是 `2..14` 的整数联合类型，`11/12/13/14` 分别代表 Jack/Queen/King/Ace；Suit 仅为 `clubs/diamonds/hearts/spades`。稳定 ASCII 编码为 `[2-9TJQKA][cdhs]`，严格使用大写 `T/J/Q/K/A` 与小写 `c/d/h/s`，不接受大小写自动修正或 Unicode 花色。

标准牌堆的规范创建顺序为 clubs、diamonds、hearts、spades，每种花色内按 2 到 Ace；共 52 张且编码唯一。`shuffleCards` 以注入的 `RandomIntSource.nextInt(exclusiveMax)` 执行返回副本的 Fisher–Yates。Poker Core 不调用 `Math.random()`；Server 的生产适配器使用 `node:crypto` 的 `randomInt`，测试使用每例独立的确定性源。

`HandCategory` 从弱到强依次为 High Card、One Pair、Two Pair、Three of a Kind、Straight、Flush、Full House、Four of a Kind、Straight Flush。Royal Flush 不另设类别，只是 Ace-high Straight Flush 的显示名。Wheel 的牌力最高点按 5，其 `bestFive` 为 `5,4,3,2,A`。

评估结果包含 `category`、`tiebreak`、`bestFive` 和 `displayName`。`tiebreak` 结构为：

- High Card / Flush：五个点数降序；
- One Pair：`[pair, kicker1, kicker2, kicker3]`；
- Two Pair：`[highPair, lowPair, kicker]`；
- Three of a Kind：`[trips, kicker1, kicker2]`；
- Straight / Straight Flush：`[high]`；
- Full House：`[trips, pair]`；
- Four of a Kind：`[quads, kicker]`。

`bestFive` 先按上述牌型角色/点数顺序排列，同点数实体牌仅为输出稳定按 spades、hearts、diamonds、clubs 排序。7 张牌会枚举全部 21 个组合；牌力完全相同的多个组合使用规范编码签名作确定性选择。花色选择器不进入牌力比较，相同点数结构始终平局。`compareHandStrength(left, right)` 小于零表示左弱、零表示平局、大于零表示左强。

完整五张牌穷举通过 `pnpm verify:five-card-distribution` 执行，必须覆盖标准牌堆全部 2,598,960 个组合，并对照 High Card 1,302,540、One Pair 1,098,240、Two Pair 123,552、Three of a Kind 54,912、Straight 10,200、Flush 5,108、Full House 3,744、Four of a Kind 624、Straight Flush 40。
