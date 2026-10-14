import type { ProjectedSeat, RoomChatMessage, TableStateProjection } from "@paiyouju/shared";
import { Eye } from "lucide-react";
import { useEffect, useRef } from "react";

import { AvatarPortrait } from "../../../components/AvatarPortrait.js";
import { Countdown } from "../../../components/Countdown.js";
import { FlippingPlayingCard } from "../../../components/FlippingPlayingCard.js";
import { StreetCommitment } from "../../../components/PokerChip.js";
import { PlayerChatBubble } from "./PlayerChatBubble.js";
import { SquidBadge } from "./SquidBadge.js";

const heroStatusLabel: Readonly<Record<ProjectedSeat["playStatus"], string>> = {
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

export function HeroHand({ actionLabel = null, chatMessage = null, mySeat, onReveal, state, working }: {
  readonly actionLabel?: string | null;
  readonly chatMessage?: RoomChatMessage | null;
  readonly mySeat: ProjectedSeat | null;
  readonly onReveal: (cardIndex: 0 | 1) => void;
  readonly state: TableStateProjection;
  readonly working: boolean;
}) {
  const handId = state.hand?.handId ?? null;
  const previousHandId = useRef(handId);
  const animateDeal = handId !== null && previousHandId.current !== handId;
  useEffect(() => { previousHandId.current = handId; }, [handId]);
  if (!mySeat) return null;

  const cards = state.hand?.ownHoleCards ?? [];
  const reviewActive = state.runtimeStatus === "POST_HAND_REVIEW";
  const reviewShownIndices = mySeat.voluntarilyRevealedCardIndices ?? (mySeat.voluntarilyRevealed ? [0, 1] : []);
  const selectedIndices = reviewActive ? reviewShownIndices : state.pendingShowCardIndices;
  const canToggle = state.canRevealOwnCards;
  const hasHand = state.hand !== null && mySeat.startingStack !== null;
  const standing = standingStatuses.has(mySeat.playStatus) || (!hasHand && mySeat.playStatus !== "ACTIVE");
  const visualState = standing ? "standing" : mySeat.hasFolded ? "folded" : "active";
  const visibleStatus = mySeat.playStatus !== "ACTIVE"
    ? heroStatusLabel[mySeat.playStatus]
    : mySeat.hasFolded
      ? "已弃牌"
      : state.trusteeshipEnabled
        ? "托管中 · 让或弃"
        : state.ownHandSummary?.label ?? "等待发牌";
  return <section aria-label={`${mySeat.nickname}，我的状态：${visibleStatus}`} className={`hero-hand hero-visual-${visualState}`} data-player-visual-state={visualState} data-seat-index={mySeat.seatIndex} data-seat-stack={mySeat.stack} data-testid="hero-hand">
    <div className="hero-identity"><p className={`truncate text-xs font-medium ${actionLabel ? "seat-action-label" : ""}`}>{actionLabel ?? mySeat.nickname}</p><p className="hero-stack-value">{mySeat.stack.toLocaleString()}</p>{mySeat.reservedAwayEndsAt && <p className="text-[9px] text-sky-200">保位剩余 <Countdown deadline={mySeat.reservedAwayEndsAt} /></p>}</div>
    <div className="hero-avatar" data-testid="hero-avatar">
      {chatMessage && <PlayerChatBubble message={chatMessage} placement="hero" />}
      <span className="hero-seat-markers" aria-label="我的牌桌位置标记">
        {mySeat.isDealer && <span className="seat-marker bg-stone-100 text-stone-900">D</span>}
        {mySeat.isSmallBlind && <span className="seat-marker bg-sky-200 text-sky-950">SB</span>}
        {mySeat.isBigBlind && <span className="seat-marker bg-amber-200 text-amber-950">BB</span>}
        {mySeat.squidMarked && <SquidBadge className="hero-squid-badge" label="我的鱿鱼标记" />}
      </span>
      {standing ? <span className="hero-avatar-standing">站</span> : <AvatarPortrait avatarId={mySeat.avatarId} className="hero-avatar-portrait" />}
      {reviewActive && cards.map((card, index) => selectedIndices.includes(index as 0 | 1) && <button aria-label={`撤回第 ${index + 1} 张底牌展示`} className={`hero-avatar-revealed-card card-${index}`} disabled={!canToggle || working} key={card} onClick={() => onReveal(index as 0 | 1)} type="button"><FlippingPlayingCard animate={false} code={card} highlighted small /></button>)}
    </div>
    <div className="hero-cards" data-testid="own-cards">{cards.length === 2 ? cards.map((card, index) => {
      const cardIndex = index as 0 | 1;
      const pending = selectedIndices.includes(cardIndex);
      if (reviewActive && pending) return null;
      const label = reviewActive ? `展示第 ${index + 1} 张底牌` : pending ? `取消第 ${index + 1} 张底牌待亮` : `将第 ${index + 1} 张底牌设为待亮`;
      return <button aria-label={canToggle ? label : `第 ${index + 1} 张底牌`} className={`hero-card-button ${pending ? "is-pending-show" : canToggle ? "can-reveal" : ""}`} disabled={!canToggle || working} key={`${handId}-${card}`} onClick={() => onReveal(cardIndex)} type="button"><FlippingPlayingCard animate={animateDeal} code={card} delayMs={220 + index * 180} highlighted={pending} small testId="hero-dealt-card" />{pending && !reviewActive && <span aria-label={`第 ${index + 1} 张底牌待亮标记`} className="hero-reveal-hint"><Eye aria-hidden="true" size={10} /></span>}</button>;
    }) : <span className="grid h-12 w-[4.25rem] place-items-center rounded-lg border border-dashed border-white/15 text-[10px] text-stone-500">未参与</span>}</div>
    <div className="hero-hand-status"><p className="truncate text-xs font-semibold text-emerald-200" data-testid="hand-strength">{visibleStatus}</p>{state.hand && <StreetCommitment amount={mySeat.committedThisStreet} />}</div>
  </section>;
}
