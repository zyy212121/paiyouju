import type { ProjectedHand, TableStateProjection } from "@paiyouju/shared";

/**
 * The server commits a finished hand atomically for crash recovery. While an
 * automatic all-in board is still being presented, keep every settlement-only
 * field at its pre-award value so the durable result cannot leak through the UI.
 */
export function settlementPresentationState(
  state: TableStateProjection,
  hand: ProjectedHand | null,
  settlementVisible: boolean,
  previousOwnHandSummary: TableStateProjection["ownHandSummary"],
): TableStateProjection {
  if (settlementVisible) return { ...state, hand };

  return {
    ...state,
    canRevealOwnCards: false,
    hand,
    lastHandSummary: null,
    ownHandSummary: previousOwnHandSummary,
    runtimeStatus: "PLAYING",
    seats: state.seats.map((seat) => ({
      ...seat,
      publicHandLabel: null,
      stack: seat.startingStack === null || seat.committedThisHand === undefined
        ? seat.stack
        : Math.max(0, seat.startingStack - seat.committedThisHand),
    })),
  };
}
