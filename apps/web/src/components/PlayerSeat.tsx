import type { ProjectedSeat, RoomChatMessage } from "@paiyouju/shared";
import { Eye, WifiOff } from "lucide-react";

import { DeadlineRing } from "../features/table/mobile/DeadlineRing.js";
import { PlayerChatBubble, type ChatBubblePlacement } from "../features/table/mobile/PlayerChatBubble.js";
import { SquidBadge } from "../features/table/mobile/SquidBadge.js";
import { AvatarPortrait } from "./AvatarPortrait.js";
import { StreetCommitment } from "./PokerChip.js";
import { CardBack, PlayingCard } from "./PlayingCard.js";

const statusLabel: Readonly<Record<ProjectedSeat["playStatus"], string>> = {
  ACTIVE: "参与中",
  BUSTED_WAITING_REBUY: "筹码为零，已站起",
  LEAVE_AFTER_HAND: "本手后离桌",
  RESERVED_AWAY: "保位离桌",
  SIT_OUT: "已暂停",
  SIT_OUT_AFTER_HAND: "本手后暂停",
};

const standingStatuses = new Set<ProjectedSeat["playStatus"]>([
  "BUSTED_WAITING_REBUY",
  "LEAVE_AFTER_HAND",
  "RESERVED_AWAY",
  "SIT_OUT",
]);

export function PlayerSeat({ actionLabel = null, actionTimeSeconds = 30, chatMessage = null, chatPlacement = "above", hasHand = false, publicCards, publicCardSlots, seat, turnDeadlineAt = null, winner }: {
  readonly actionLabel?: string | null;
  readonly actionTimeSeconds?: number;
  readonly chatMessage?: RoomChatMessage | null;
  readonly chatPlacement?: ChatBubblePlacement;
  readonly hasHand?: boolean;
  readonly publicCards: readonly string[];
  readonly publicCardSlots?: readonly (string | null)[];
  readonly seat: ProjectedSeat;
  readonly turnDeadlineAt?: string | null;
  readonly winner: boolean;
}) {
  const standing = standingStatuses.has(seat.playStatus) || (!hasHand && seat.playStatus !== "ACTIVE");
  const visualState = standing ? "standing" : seat.hasFolded ? "folded" : "active";
  const publicSlots = publicCardSlots ?? (publicCards.length === 2 ? publicCards : null);
  const stateDescriptions = [
    !seat.connected ? "已断开" : null,
    seat.hasFolded ? "已弃牌" : null,
    seat.isAllIn ? "全下" : null,
    statusLabel[seat.playStatus],
  ].filter((value): value is string => value !== null);
  return (
    <article
      aria-label={`${seat.nickname}，玩家状态：${stateDescriptions.join("、")}`}
      className={`player-seat seat-visual-${visualState} ${publicSlots ? "has-public-cards" : ""} ${seat.isCurrentActor ? "is-acting" : ""} ${winner ? "is-winner" : ""}`}
      data-player-visual-state={visualState}
      data-seat-index={seat.seatIndex}
      data-seat-stack={seat.stack}
    >
      {chatMessage && <PlayerChatBubble message={chatMessage} placement={chatPlacement} />}
      <p className={actionLabel ? "seat-nickname seat-action-label" : "seat-nickname"}>{actionLabel ?? seat.nickname}</p>
      <div className="seat-avatar-shell">
        <div className="seat-markers" aria-label="牌桌位置标记">
          {seat.isDealer && <span className="seat-marker bg-stone-100 text-stone-900">D</span>}
          {seat.isSmallBlind && <span className="seat-marker bg-sky-200 text-sky-950">SB</span>}
          {seat.isBigBlind && <span className="seat-marker bg-amber-200 text-amber-950">BB</span>}
          {seat.squidMarked && <SquidBadge className="seat-squid-badge" />}
        </div>
        {seat.isCurrentActor && <DeadlineRing deadline={turnDeadlineAt} durationSeconds={actionTimeSeconds} label={`${seat.nickname} 行动倒计时`} />}
        <div className="seat-avatar">
          {standing ? <span className="seat-avatar-standing">站</span> : <AvatarPortrait avatarId={seat.avatarId} className="seat-avatar-portrait" />}
          {!publicSlots && hasHand && !seat.hasFolded && (
            <span aria-label="对手底牌未公开" className="seat-hidden-cards"><CardBack small /><CardBack small /></span>
          )}
          {publicSlots && (
            <span className="seat-public-cards">
              {publicSlots.map((card, index) => {
                const revealed = seat.voluntarilyRevealedCardIndices?.includes(index as 0 | 1) ?? seat.voluntarilyRevealed;
                return (
                  <span className={`opponent-public-card ${revealed && card ? "is-revealed" : ""}`} key={`${seat.userId}-${index}`}>
                    {card ? <PlayingCard code={card} highlighted={revealed} small /> : <CardBack small />}
                    {revealed && card && <span aria-label={`第 ${index + 1} 张主动公开底牌`} className="opponent-reveal-mark"><Eye aria-hidden="true" size={10} /></span>}
                  </span>
                );
              })}
            </span>
          )}
        </div>
        {!seat.connected && <span aria-label="玩家已断开" className="seat-offline-mark"><WifiOff aria-hidden="true" size={10} /></span>}
        {winner && <span className="seat-result-badge is-winner">赢家</span>}
      </div>
      {seat.publicHandLabel && <p className="seat-hand-label">{seat.publicHandLabel}</p>}
      <p className="seat-stack-pill">{seat.stack.toLocaleString()}</p>
      <StreetCommitment amount={seat.committedThisStreet} compact />
      <span className="sr-only" aria-label={`玩家状态：${stateDescriptions.join("、")}`} />
    </article>
  );
}
