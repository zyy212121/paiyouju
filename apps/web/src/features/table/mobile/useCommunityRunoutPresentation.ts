import type { ProjectedHand } from "@paiyouju/shared";
import { useEffect, useMemo, useRef, useState } from "react";

const STREET_PAUSE_MS = 1_000;

interface PresentationState {
  readonly completedRunoutCount: 0 | 1 | 2;
  readonly handId: string | null;
  readonly settlementVisible: boolean;
  readonly visibleBoardCount: number;
  readonly visibleRunoutCounts: readonly [number, number] | null;
}

function presentedStreet(boardCount: number, fallback: ProjectedHand["street"], settlementVisible: boolean): ProjectedHand["street"] {
  if (boardCount >= 5) return settlementVisible ? fallback : "river";
  if (boardCount === 4) return "turn";
  if (boardCount >= 3) return "flop";
  return "preflop";
}

function boardCountBeforeAutomaticRunout(hand: ProjectedHand | null): number {
  let count = 0;
  for (const event of hand?.actionHistory ?? []) {
    if (event.eventType !== "BOARD_DEALT" || event.street === "showdown") continue;
    count = Math.max(count, event.street === "river" ? 5 : event.street === "turn" ? 4 : event.street === "flop" ? 3 : 0);
  }
  return Math.min(count, hand?.board.length ?? 0);
}

function sharedRunoutBoardCount(boards: NonNullable<ProjectedHand["runoutBoards"]>): number {
  const firstDifference = boards[0].findIndex((card, index) => card !== boards[1][index]);
  return firstDifference === -1 ? Math.min(boards[0].length, boards[1].length) : firstDifference;
}

export function useCommunityRunoutPresentation(hand: ProjectedHand | null, reviewing: boolean) {
  const handId = hand?.handId ?? null;
  const targetBoardCount = hand?.board.length ?? 0;
  const targetRunoutKey = hand?.runoutBoards?.map((board) => board.join(",")).join("|") ?? "";
  const targetRunoutBoards = useMemo<ProjectedHand["runoutBoards"]>(() => {
    if (targetRunoutKey === "") return null;
    const [first = "", second = ""] = targetRunoutKey.split("|");
    return [first === "" ? [] : first.split(","), second === "" ? [] : second.split(",")];
  }, [targetRunoutKey]);
  const doubleRunout = reviewing && targetRunoutBoards !== null;
  const automaticRunout = reviewing && (hand?.actionHistory.some(
    (event) => event.eventType === "BOARD_DEALT" && event.street === "showdown",
  ) ?? false);
  const preRunoutBoardCount = boardCountBeforeAutomaticRunout(hand);
  const [presentation, setPresentation] = useState<PresentationState>(() => {
    if (automaticRunout && targetRunoutBoards) {
      const sharedCount = sharedRunoutBoardCount(targetRunoutBoards);
      return { completedRunoutCount: 0, handId, settlementVisible: false, visibleBoardCount: sharedCount, visibleRunoutCounts: [sharedCount, sharedCount] };
    }
    if (automaticRunout) {
      return { completedRunoutCount: 0, handId, settlementVisible: false, visibleBoardCount: preRunoutBoardCount, visibleRunoutCounts: null };
    }
    return { completedRunoutCount: targetRunoutBoards ? 2 : 0, handId, settlementVisible: true, visibleBoardCount: targetBoardCount, visibleRunoutCounts: targetRunoutBoards ? [5, 5] : null };
  });
  const presentationRef = useRef(presentation);

  useEffect(() => {
    const update = (next: PresentationState) => {
      presentationRef.current = next;
      setPresentation(next);
    };
    let current = presentationRef.current;
    if (handId === null) {
      update({ completedRunoutCount: 0, handId: null, settlementVisible: true, visibleBoardCount: 0, visibleRunoutCounts: null });
      return;
    }
    if (current.handId !== handId) {
      if (automaticRunout && targetRunoutBoards) {
        const sharedCount = sharedRunoutBoardCount(targetRunoutBoards);
        current = { completedRunoutCount: 0, handId, settlementVisible: false, visibleBoardCount: sharedCount, visibleRunoutCounts: [sharedCount, sharedCount] };
        update(current);
      } else if (automaticRunout) {
        current = { completedRunoutCount: 0, handId, settlementVisible: false, visibleBoardCount: preRunoutBoardCount, visibleRunoutCounts: null };
        update(current);
      } else {
        update({ completedRunoutCount: targetRunoutBoards ? 2 : 0, handId, settlementVisible: true, visibleBoardCount: targetBoardCount, visibleRunoutCounts: targetRunoutBoards ? [5, 5] : null });
        return;
      }
    }
    if (doubleRunout && targetRunoutBoards) {
      const sharedBoardCount = sharedRunoutBoardCount(targetRunoutBoards);
      if (current.visibleRunoutCounts !== null && current.completedRunoutCount === 2) return;
      const streetStages = [3, 4, 5].filter((count) => count > sharedBoardCount);
      const firstDelay = sharedBoardCount < 3 ? 0 : STREET_PAUSE_MS;
      const perBoardDuration = firstDelay + streetStages.length * STREET_PAUSE_MS;
      const secondBoardOffset = perBoardDuration + (sharedBoardCount < 3 ? STREET_PAUSE_MS : 0);
      const fullPresentationDuration = 2 * perBoardDuration + STREET_PAUSE_MS;
      update({
        completedRunoutCount: 0,
        handId,
        settlementVisible: false,
        visibleBoardCount: sharedBoardCount,
        visibleRunoutCounts: [sharedBoardCount, sharedBoardCount],
      });
      const timers: number[] = [];
      streetStages.forEach((count, index) => {
        timers.push(window.setTimeout(() => {
          const latest = presentationRef.current;
          update({ ...latest, visibleBoardCount: count, visibleRunoutCounts: [count, latest.visibleRunoutCounts?.[1] ?? sharedBoardCount] });
        }, firstDelay + index * STREET_PAUSE_MS));
      });
      timers.push(window.setTimeout(() => {
        update({ ...presentationRef.current, completedRunoutCount: 1 });
      }, perBoardDuration));
      streetStages.forEach((count, index) => {
        timers.push(window.setTimeout(() => {
          const latest = presentationRef.current;
          update({ ...latest, visibleRunoutCounts: [latest.visibleRunoutCounts?.[0] ?? 5, count] });
        }, secondBoardOffset + firstDelay + index * STREET_PAUSE_MS));
      });
      timers.push(window.setTimeout(() => {
        update({ completedRunoutCount: 2, handId, settlementVisible: true, visibleBoardCount: 5, visibleRunoutCounts: [5, 5] });
      }, fullPresentationDuration));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }
    if (!automaticRunout || targetBoardCount <= current.visibleBoardCount) {
      update({ completedRunoutCount: 0, handId, settlementVisible: true, visibleBoardCount: targetBoardCount, visibleRunoutCounts: null });
      return;
    }

    const startingCount = current.visibleBoardCount;
    const stages = [3, 4, 5].filter((count) => count > startingCount && count <= targetBoardCount);
    if (stages.length === 0) {
      update({ completedRunoutCount: 0, handId, settlementVisible: true, visibleBoardCount: targetBoardCount, visibleRunoutCounts: null });
      return;
    }

    update({ completedRunoutCount: 0, handId, settlementVisible: false, visibleBoardCount: startingCount, visibleRunoutCounts: null });
    const timers: number[] = [];
    const firstDelay = startingCount < 3 ? 0 : STREET_PAUSE_MS;
    stages.forEach((count, index) => {
      timers.push(window.setTimeout(() => {
        update({ completedRunoutCount: 0, handId, settlementVisible: false, visibleBoardCount: count, visibleRunoutCounts: null });
      }, firstDelay + index * STREET_PAUSE_MS));
    });
    timers.push(window.setTimeout(() => {
      update({ completedRunoutCount: 0, handId, settlementVisible: true, visibleBoardCount: targetBoardCount, visibleRunoutCounts: null });
    }, firstDelay + stages.length * STREET_PAUSE_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [automaticRunout, doubleRunout, handId, preRunoutBoardCount, targetBoardCount, targetRunoutBoards]);

  const visibleBoardCount = presentation.handId === handId
    ? Math.min(presentation.visibleBoardCount, targetBoardCount)
    : targetBoardCount;
  const boardIsStillArriving = automaticRunout && visibleBoardCount < targetBoardCount;
  const settlementVisible = !automaticRunout || (!boardIsStillArriving && presentation.settlementVisible);
  const presentedHand = hand === null ? null : {
    ...hand,
    actionHistory: doubleRunout
      ? hand.actionHistory.filter((event) => event.eventType !== "POT_AWARDED")
      : settlementVisible
        ? hand.actionHistory
        : hand.actionHistory.filter((event) => event.eventType !== "POT_AWARDED" && event.eventType !== "HAND_FINISHED"),
    board: hand.board.slice(0, visibleBoardCount),
    street: presentedStreet(visibleBoardCount, hand.street, settlementVisible),
  };

  const runoutBoards = targetRunoutBoards && presentation.visibleRunoutCounts
    ? [
        targetRunoutBoards[0].slice(0, presentation.visibleRunoutCounts[0]),
        targetRunoutBoards[1].slice(0, presentation.visibleRunoutCounts[1]),
      ] as const
    : null;

  return { completedRunoutCount: presentation.completedRunoutCount, hand: presentedHand, runoutBoards, settlementVisible } as const;
}
