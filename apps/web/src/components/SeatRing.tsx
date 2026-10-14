import type { RoomChatMessage, TableStateProjection } from "@paiyouju/shared";

import { PlayerSeat } from "./PlayerSeat.js";
import { seatPosition } from "../features/table/seat-layout.js";
import type { ChatBubblePlacement } from "../features/table/mobile/PlayerChatBubble.js";

function chatPlacement(x: number, y: number): ChatBubblePlacement {
  if (y <= 20) return "below";
  if (y >= 78) return "above";
  if (x <= 30) return "right";
  if (x >= 70) return "left";
  return y < 50 ? "above" : "below";
}

export function currentStreetActionLabels(state: TableStateProjection): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  const hand = state.hand;
  if (!hand) return labels;
  for (const event of hand.actionHistory) {
    switch (event.eventType) {
      case "PLAYER_ALL_IN": if (event.street === hand.street) labels.set(event.playerId, "全下"); break;
      case "PLAYER_BET": if (event.street === hand.street) labels.set(event.playerId, "下注"); break;
      case "PLAYER_CALLED": if (event.street === hand.street) labels.set(event.playerId, "跟注"); break;
      case "PLAYER_CHECKED": if (event.street === hand.street) labels.set(event.playerId, "过牌"); break;
      case "PLAYER_FOLDED": if (event.street === hand.street) labels.set(event.playerId, "弃牌"); break;
      case "PLAYER_RAISED": if (event.street === hand.street) labels.set(event.playerId, "加注"); break;
      default: break;
    }
  }
  return labels;
}

interface SeatRingProps {
  readonly chatMessagesByUser?: Readonly<Record<string, RoomChatMessage>>;
  readonly hideHero?: boolean;
  readonly maxSeats: number;
  readonly onEmptySeat?: (seatIndex: number) => void;
  readonly selectedSeat?: number | null;
  readonly stage?: boolean;
  readonly state: TableStateProjection;
}

export function SeatRing({ chatMessagesByUser = {}, hideHero = false, maxSeats, onEmptySeat, selectedSeat, stage = false, state }: SeatRingProps) {
  const byIndex = new Map(state.seats.map((seat) => [seat.seatIndex, seat]));
  const heroSeatIndex = state.seats.find((seat) => seat.userId === state.recipient.userId)?.seatIndex ?? 0;
  const winners = new Set(
    state.hand?.actionHistory.flatMap((event) => {
      if (event.eventType === "POT_AWARDED" && event.amount > 0) return event.winners;
      if (event.eventType === "UNCALLED_BET_RETURNED" && event.amount > 0) return [event.playerId];
      return [];
    }) ?? [],
  );
  const latestActionLabels = currentStreetActionLabels(state);
  return (
    <div className={stage ? "absolute inset-0" : "relative mx-auto aspect-[1/1.18] w-full max-w-[720px] sm:aspect-[1.65/1]"} data-layout-count={maxSeats} data-testid="seat-ring">
      <div aria-hidden="true" className="absolute inset-[22%_15%] bg-[radial-gradient(circle_at_center,rgba(24,132,100,.16),transparent_66%)]" />
      {Array.from({ length: maxSeats }, (_, seatIndex) => {
        const { x, y } = seatPosition(seatIndex, maxSeats, heroSeatIndex);
        const seat = byIndex.get(seatIndex);
        const publicCards = seat ? state.hand?.publicHoleCards[seat.userId] ?? [] : [];
        const publicCardSlots = seat ? state.hand?.publicHoleCardSlots?.[seat.userId] : undefined;
        const chatMessage = seat ? chatMessagesByUser[seat.userId] ?? null : null;
        if (hideHero && seat?.userId === state.recipient.userId) return null;
        return (
          <div className={`absolute ${chatMessage ? "z-20" : "z-10"} -translate-x-1/2 -translate-y-1/2 ${stage ? "w-[22%] max-w-[7.4rem] min-w-[4.5rem]" : "w-[20%] max-w-36 sm:w-[22%]"}`} data-visual-seat={(seatIndex - heroSeatIndex + maxSeats) % maxSeats} key={seatIndex} style={{ left: `${x}%`, top: `${y}%` }}>
            {seat ? <PlayerSeat actionLabel={latestActionLabels.get(seat.userId) ?? null} actionTimeSeconds={state.room.actionTimeSeconds} chatMessage={chatMessage} chatPlacement={chatPlacement(x, y)} hasHand={state.hand !== null && seat.startingStack !== null} publicCards={publicCards} {...(publicCardSlots ? { publicCardSlots } : {})} seat={seat} turnDeadlineAt={state.hand?.turnDeadlineAt ?? null} winner={winners.has(seat.userId)} /> : <button aria-label={`选择座位 ${seatIndex + 1}`} className={`empty-seat mx-auto grid min-h-11 min-w-11 place-items-center rounded-xl border border-dashed px-2 text-[10px] transition sm:min-h-14 sm:min-w-14 ${selectedSeat === seatIndex ? "border-amber-300 bg-amber-300/20 text-amber-100" : "border-white/25 bg-black/20 text-stone-400 hover:border-teal-300 hover:text-white"}`} data-seat-index={seatIndex} disabled={!onEmptySeat} onClick={() => onEmptySeat?.(seatIndex)} type="button"><span aria-hidden="true" className="text-lg leading-none">＋</span><span className="sr-only">座位 {seatIndex + 1}</span></button>}
          </div>
        );
      })}
    </div>
  );
}
