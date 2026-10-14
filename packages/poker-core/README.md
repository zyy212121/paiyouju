# @paiyouju/poker-core

牌友局的框架无关扑克领域核心。Stage 2 在 Card/Deck/Evaluator 基线上提供完整单手 No-Limit Hold'em 状态机、合法行动、任意边池、结算、不变量和 Seed 模拟；仍不包含房间、网络、数据库、Wallet 或系统计时。

## Card 编码

```ts
type Suit = "clubs" | "diamonds" | "hearts" | "spades";
type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}
```

Rank 数值为 `2..14`，其中 `11=Jack`、`12=Queen`、`13=King`、`14=Ace`。唯一内部编码使用 `[2-9TJQKA][cdhs]`，例如 `2c`、`Td`、`Jh`、`Qs`、`Ac`。解析严格区分大小写：点数字母必须大写、花色字母必须小写；Unicode 花色不属于内部编码。

```ts
const card = parseCard("Ac");
serializeCard(card); // "Ac"
cardsEqual(card, { rank: 14, suit: "clubs" }); // true
createStandardDeck(); // 52 张，clubs/diamonds/hearts/spades，每种内按 2..A
```

## 洗牌与随机源

```ts
interface RandomIntSource {
  nextInt(exclusiveMax: number): number; // 0 <= result < exclusiveMax
}

const shuffled = shuffleCards(deck, source);
```

`shuffleCards` 使用整数 Fisher–Yates，返回新数组且不修改传入牌堆。Poker Core 不生成浮点随机数、不取模、不调用 `Math.random()`。测试传入独立的确定性序列；生产适配器位于 `apps/server/src/crypto-random.ts`，直接使用 Node `crypto.randomInt`，由其提供无 modulo bias 的有界整数。

## 牌型与结果

`HandCategory` 从弱到强固定为：

1. `HighCard`
2. `OnePair`
3. `TwoPair`
4. `ThreeOfAKind`
5. `Straight`
6. `Flush`
7. `FullHouse`
8. `FourOfAKind`
9. `StraightFlush`

Royal Flush 仍属于 `StraightFlush`，仅将 `displayName` 设为 `Royal Flush`。A-2-3-4-5 的 Ace 按低位使用，`tiebreak` 为 `[5]`。

```ts
interface HandEvaluation {
  readonly category: HandCategory;
  readonly tiebreak: readonly number[];
  readonly bestFive: readonly Card[];
  readonly displayName: string;
}
```

`tiebreak` 采用可字典序比较的数值：

| 牌型 | tiebreak |
| --- | --- |
| High Card / Flush | 五张点数从高到低 |
| One Pair | `[pair, kicker1, kicker2, kicker3]` |
| Two Pair | `[highPair, lowPair, kicker]` |
| Three of a Kind | `[trips, kicker1, kicker2]` |
| Straight / Straight Flush | `[high]`，Wheel 为 `[5]` |
| Full House | `[trips, pair]` |
| Four of a Kind | `[quads, kicker]` |

`bestFive` 的稳定顺序遵循牌型角色和 `tiebreak`：成组牌先于 kicker、点数从强到弱；顺子从最高牌向下，Wheel 是 `5,4,3,2,A`。同一点数的实体牌只为确定性按 `spades, hearts, diamonds, clubs` 排序。若 7 张中多个组合牌力完全相同，选择规范序列化签名字典序最大的组合。上述花色规则只稳定输出，绝不参与 `compareHandStrength`。

## 公开 API

```ts
evaluateFiveCards(cards);  // 必须恰好 5 张且唯一
evaluateSevenCards(cards); // 必须恰好 7 张且唯一，枚举全部 21 组合

compareHandStrength(left, right);
// < 0：left 较弱；0：完全平局；> 0：left 较强

determineWinners(contenders);
// 返回所有最强者；平局者保持输入顺序

startHand({ handId, config, seats, previousButtonSeat, deck });
getLegalActions(state, playerId);
applyPlayerAction(state, action); // { state, events }
buildPots(players);
settleHand(state);
assertHandStateInvariants(state, previousState?);
```

`PlayerAction` 支持 `fold/check/call/bet/raiseTo/allIn`；金额动作的 `raiseTo` 是玩家本街最终累计投入。状态/事件是 readonly、可 JSON 序列化的普通对象，同一状态、命令和固定牌堆产生相同结果。

机器人与 Seed 模拟仅位于 `simulation/` 验证子模块，机器人只能从 `getLegalActions` 选择。CLI 支持 `--hands` 和 `--seed`，失败会输出 seed、handIndex、桌配置、初始玩家、牌堆标识和完整动作序列。为规避 Windows Node 24 长时间高负载的 V8 原生崩溃，CLI 将大规模运行确定性切成最多 10,000 手的顺序隔离进程并汇总；这不减少请求的总 hands，也不关闭任何不变量。

非法编码抛出 `InvalidCardError`；非法手牌数量或重复实体牌抛出 `InvalidHandError`；注入源返回越界/小数值时抛出 `InvalidRandomSourceError`。

## 验证命令

```powershell
pnpm --filter @paiyouju/poker-core test
pnpm --filter @paiyouju/poker-core test:properties
pnpm --filter @paiyouju/poker-core test:engine-properties
pnpm --filter @paiyouju/poker-core test:short-all-in
pnpm --filter @paiyouju/poker-core test:side-pots
pnpm --filter @paiyouju/poker-core simulate --hands=100000 --seed=123456
pnpm verify:five-card-distribution
```

穷举命令真实评估标准牌堆全部 `2,598,960` 种五张组合，逐类对照已知精确分布；任一数量不符时以非零退出码结束。
