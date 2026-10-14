import type { ProjectedHand, ProjectedSeat } from "@paiyouju/shared";
import { useEffect, useRef, type CSSProperties } from "react";

import { seatPosition } from "../seat-layout.js";

interface ChipFlight {
  readonly amount: number;
  readonly key: string;
  readonly winnerId: string;
  readonly x: number;
  readonly y: number;
}

function chipFlights(hand: ProjectedHand | null, seats: readonly ProjectedSeat[], maxSeats: number, heroSeatIndex: number): readonly ChipFlight[] {
  if (!hand) return [];
  const seatByUser = new Map(seats.map((seat) => [seat.userId, seat] as const));
  const flights: ChipFlight[] = [];
  for (const event of hand.actionHistory) {
    if (event.eventType === "POT_AWARDED" && event.amount > 0) {
      for (const [winnerIndex, winnerId] of event.winners.entries()) {
        const seat = seatByUser.get(winnerId);
        if (!seat) continue;
        const target = seatPosition(seat.seatIndex, maxSeats, heroSeatIndex);
        flights.push({ amount: event.amount, key: `${event.stateVersion}:pot:${event.potIndex}:${winnerIndex}:${winnerId}`, winnerId, ...target });
      }
    }
    if (event.eventType === "UNCALLED_BET_RETURNED" && event.amount > 0) {
      const seat = seatByUser.get(event.playerId);
      if (!seat) continue;
      const target = seatPosition(seat.seatIndex, maxSeats, heroSeatIndex);
      flights.push({ amount: event.amount, key: `${event.stateVersion}:return:${event.playerId}`, winnerId: event.playerId, ...target });
    }
  }
  return flights;
}

export function ChipAwardAnimation({ hand, heroSeatIndex, maxSeats, onCollect, seats, visible }: {
  readonly hand: ProjectedHand | null;
  readonly heroSeatIndex: number;
  readonly maxSeats: number;
  readonly onCollect: () => void;
  readonly seats: readonly ProjectedSeat[];
  readonly visible: boolean;
}) {
  const flights = chipFlights(hand, seats, maxSeats, heroSeatIndex);
  const signature = visible && flights.length > 0 ? `${hand?.handId ?? "none"}:${flights.map((flight) => flight.key).join("|")}` : null;
  const collectedSignature = useRef<string | null>(null);
  useEffect(() => {
    if (!signature || signature === collectedSignature.current || document.visibilityState === "hidden") return;
    collectedSignature.current = signature;
    onCollect();
  }, [onCollect, signature]);
  if (!visible || flights.length === 0) return null;
  return (
    <div aria-hidden="true" className="chip-award-animation-layer" data-animation-kind="chip-award" data-testid="chip-award-animation">
      {flights.map((flight, index) => (
        <span
          className="chip-award-flight"
          data-amount={flight.amount}
          data-testid="chip-award-flight"
          data-winner-id={flight.winnerId}
          key={flight.key}
          style={{
            "--chip-award-delay": `${Math.min(index, 12) * 45}ms`,
            "--chip-target-x": `${flight.x}%`,
            "--chip-target-y": `${flight.y}%`,
          } as CSSProperties}
        >
          <i /><i /><i />
        </span>
      ))}
    </div>
  );
}
