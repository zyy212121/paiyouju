import type { ProjectedHand } from "@paiyouju/shared";

import { BoardCards } from "../BoardCards.js";

function resultLabel(result: NonNullable<ProjectedHand["runoutResults"]>[number], userId: string): string {
  if (result.ownNetResult === null) return "本副已结算";
  if (result.winnerUserIds.includes(userId)) return "YOU WIN";
  if (result.ownNetResult < 0) return "YOU LOSE";
  return "PUSH";
}

export function DoubleRunoutBoard({ boards, completedRunoutCount, results, userId }: {
  readonly boards: readonly [readonly string[], readonly string[]];
  readonly completedRunoutCount: 0 | 1 | 2;
  readonly results: ProjectedHand["runoutResults"];
  readonly userId: string;
}) {
  return <section aria-label="发两次公共牌" className="double-runout-board">
    {boards.map((cards, index) => {
      const runoutIndex = (index + 1) as 1 | 2;
      const result = results?.[index];
      const completed = completedRunoutCount >= runoutIndex;
      return <div className="double-runout-row" data-testid={`runout-board-${runoutIndex}`} key={runoutIndex}>
        <p className="double-runout-label">第{runoutIndex === 1 ? "一" : "二"}次</p>
        <BoardCards cards={cards} compact />
        <div className={`double-runout-result ${completed ? "is-visible" : ""}`}>
          {completed && result && <><strong>{resultLabel(result, userId)}</strong><span>{result.ownNetResult === null ? `底池 ${result.totalPot.toLocaleString()}` : `${result.ownNetResult >= 0 ? "+" : ""}${result.ownNetResult.toLocaleString()}`}</span></>}
        </div>
      </div>;
    })}
  </section>;
}
