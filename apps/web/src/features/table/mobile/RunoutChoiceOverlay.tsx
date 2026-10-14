import type { ProjectedHand } from "@paiyouju/shared";

import { Countdown } from "../../../components/Countdown.js";

export function RunoutChoiceOverlay({ disabled, onChoose, userId, vote }: {
  readonly disabled: boolean;
  readonly onChoose: (choice: "ONCE" | "TWICE") => void;
  readonly userId: string;
  readonly vote: NonNullable<ProjectedHand["runoutVote"]>;
}) {
  const eligible = vote.eligibleUserIds.includes(userId);
  return (
    <section aria-label="发牌次数协商" aria-modal="true" className="runout-choice-overlay" role="dialog">
      <p className="runout-choice-kicker">双人 All-in</p>
      <h2>发一次还是发两次？</h2>
      <p className="runout-choice-status">{vote.respondedUserIds.length}/2 已选择 · 剩余 <Countdown deadline={vote.deadlineAt} /></p>
      {eligible ? <div className="runout-choice-actions">
        <button aria-pressed={vote.ownChoice === "ONCE"} disabled={disabled} onClick={() => onChoose("ONCE")} type="button">发一次</button>
        <button aria-pressed={vote.ownChoice === "TWICE"} disabled={disabled} onClick={() => onChoose("TWICE")} type="button">发两次</button>
      </div> : <p className="runout-choice-watching">等待两名 All-in 玩家选择</p>}
    </section>
  );
}
