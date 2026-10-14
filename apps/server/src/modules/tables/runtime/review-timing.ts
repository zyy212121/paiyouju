import type { DomainEvent } from "@paiyouju/poker-core";

import { POST_HAND_REVIEW_DURATION_MS } from "./constants.js";

const RUNOUT_STREET_PAUSE_MS = 1_000;

export function postHandReviewDurationMs(hand: { readonly actionHistory: readonly DomainEvent[] }): number {
  const automaticRunouts = hand.actionHistory.filter(
    (event) => event.eventType === "BOARD_DEALT" && event.street === "showdown",
  );
  const automaticRunout = automaticRunouts.at(-1);
  const dealtCards = automaticRunout?.cards?.length ?? 0;
  const perBoardPresentationDelay = dealtCards === 1
    ? 2 * RUNOUT_STREET_PAUSE_MS
    : dealtCards > 1
      ? 3 * RUNOUT_STREET_PAUSE_MS
      : 0;
  const doubleRunout = new Set(automaticRunouts.map((event) => event.runoutIndex).filter(Boolean)).size === 2;
  const presentationDelay = doubleRunout
    ? 2 * perBoardPresentationDelay + RUNOUT_STREET_PAUSE_MS
    : perBoardPresentationDelay;
  return POST_HAND_REVIEW_DURATION_MS + presentationDelay;
}
