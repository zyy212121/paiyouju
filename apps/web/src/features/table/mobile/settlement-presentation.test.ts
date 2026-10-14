import type { TableStateProjection } from "@paiyouju/shared";
import { describe, expect, it } from "vitest";

import { tableState } from "../../../test/table-fixture.js";
import { settlementPresentationState } from "./settlement-presentation.js";

describe("settlementPresentationState", () => {
  it("keeps stacks, labels, winner summary and own hand strength pre-settlement until the board is visible", () => {
    const state = tableState({
      canRevealOwnCards: true,
      lastHandSummary: {
        handId: "hand-1",
        handNumber: 1,
        ownNetResult: 200,
        voluntarilyRevealedUserIds: [],
        winnerUserIds: ["user-1"],
      },
      ownHandSummary: { category: "STRAIGHT", label: "顺子" },
      runtimeStatus: "POST_HAND_REVIEW",
      seats: [{
        committedThisHand: 100,
        committedThisStreet: 100,
        connected: true,
        hasFolded: false,
        isAllIn: true,
        isBigBlind: false,
        isCurrentActor: false,
        isDealer: true,
        isSmallBlind: false,
        nickname: "Alice",
        playStatus: "ACTIVE",
        publicHandLabel: "顺子",
        reservedAwayEndsAt: null,
        seatIndex: 0,
        stack: 300,
        startingStack: 100,
        squidMarked: false,
        squidRoundParticipant: false,
        userId: "user-1",
        voluntarilyRevealed: false,
      }],
    });
    const previousSummary: TableStateProjection["ownHandSummary"] = { category: "PREFLOP", label: "A 高" };

    const hidden = settlementPresentationState(state, state.hand, false, previousSummary);
    expect(hidden.runtimeStatus).toBe("PLAYING");
    expect(hidden.canRevealOwnCards).toBe(false);
    expect(hidden.lastHandSummary).toBeNull();
    expect(hidden.ownHandSummary).toEqual(previousSummary);
    expect(hidden.seats[0]).toMatchObject({ publicHandLabel: null, stack: 0 });

    const visible = settlementPresentationState(state, state.hand, true, previousSummary);
    expect(visible.runtimeStatus).toBe("POST_HAND_REVIEW");
    expect(visible.lastHandSummary?.winnerUserIds).toEqual(["user-1"]);
    expect(visible.ownHandSummary?.label).toBe("顺子");
    expect(visible.seats[0]).toMatchObject({ publicHandLabel: "顺子", stack: 300 });
  });
});
