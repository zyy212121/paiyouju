import { applyPlayerAction, createStandardDeck, parseCard, serializeCard, startHand } from "@paiyouju/poker-core";
import { describe, expect, it } from "vitest";

import { TableRuntime } from "./table-runtime.js";
import { projectTableStateForUser } from "./project-table-state.js";

function runtimeWithHand() {
  const runtime = new TableRuntime({
    actionTimeSeconds: 30, bigBlind: 20, durationMinutes: 60, expiresAt: new Date("2099-01-01T00:00:00.000Z"), maximumBuyIn: 2_000, maxSeats: 2,
    minimumBuyIn: 400, name: "隐私牌桌", nextHandPaused: false, roomCode: "123456",
    roomId: "room-1", smallBlind: 10, status: "OPEN",
  });
  runtime.status = "PLAYING";
  runtime.stateVersion = 7;
  runtime.seats.set(0, { avatarId: "avatar-04", gameSessionId: "ga", nickname: "爱丽丝", playStatus: "ACTIVE", seatId: "sa", seatIndex: 0, stack: 400, userId: "alice", version: 1 });
  runtime.seats.set(1, { avatarId: "avatar-09", gameSessionId: "gb", nickname: "鲍勃", playStatus: "ACTIVE", seatId: "sb", seatIndex: 1, stack: 400, userId: "bob", version: 1 });
  runtime.addPresence("alice", "a1");
  runtime.addPresence("bob", "b1");
  const started = startHand({
    config: { bigBlind: 20, maxSeats: 2, smallBlind: 10 },
    deck: createStandardDeck(),
    handId: "11111111-1111-4111-8111-111111111111",
    previousButtonSeat: null,
    seats: [
      { isParticipating: true, playerId: "alice", seatIndex: 0, stack: 400 },
      { isParticipating: true, playerId: "bob", seatIndex: 1, stack: 400 },
    ],
  });
  runtime.currentHand = { actions: [], handNumber: 1, paidCardRevealCost: 0, paidCardRevealEnabled: false, startedAt: new Date("2026-01-01T00:00:00Z"), state: started.state, turnDeadlineAt: new Date("2026-01-01T00:00:30Z") };
  return runtime;
}

describe("recipient-specific table projections", () => {
  it("shows each player only their own hole cards and actor-only legal actions", () => {
    const runtime = runtimeWithHand();
    const alice = projectTableStateForUser(runtime, "alice");
    const bob = projectTableStateForUser(runtime, "bob");
    const aliceCards = runtime.currentHand!.state.players.find((player) => player.playerId === "alice")!.holeCards;
    const bobCards = runtime.currentHand!.state.players.find((player) => player.playerId === "bob")!.holeCards;
    const aliceJson = JSON.stringify(alice);
    const bobJson = JSON.stringify(bob);

    expect(alice.hand?.ownHoleCards).toHaveLength(2);
    expect(bob.hand?.ownHoleCards).toHaveLength(2);
    expect(alice.seats.map((seat) => seat.avatarId)).toEqual(["avatar-04", "avatar-09"]);
    for (const card of bobCards) expect(aliceJson).not.toContain(serializeCard(card));
    for (const card of aliceCards) expect(bobJson).not.toContain(serializeCard(card));
    const actor = runtime.currentHand!.state.players.find((player) => player.seatIndex === runtime.currentHand!.state.currentActorSeat)!.playerId;
    expect((actor === "alice" ? alice : bob).hand?.legalActions).not.toBeNull();
    expect((actor === "alice" ? bob : alice).hand?.legalActions).toBeNull();
  });

  it("describes preflop pairs and high-card suited starters without calling two cards a flush", () => {
    const runtime = runtimeWithHand();
    expect(projectTableStateForUser(runtime, "alice").ownHandSummary).toEqual({ category: "PREFLOP", label: "5 高 · 同花起手" });
    const hand = runtime.currentHand!;
    hand.state = {
      ...hand.state,
      players: hand.state.players.map((player) => player.playerId === "alice"
        ? { ...player, holeCards: [parseCard("Kc"), parseCard("Kd")] as const }
        : player),
    };
    expect(projectTableStateForUser(runtime, "alice").ownHandSummary).toEqual({ category: "PREFLOP", label: "一对 K" });
  });

  it("uses Poker Core to project pair, two-pair, and full-house labels as the board develops", () => {
    const runtime = runtimeWithHand();
    const hand = runtime.currentHand!;
    const players = hand.state.players.map((player) => player.playerId === "alice"
      ? { ...player, holeCards: [parseCard("Kc"), parseCard("Kd")] as const }
      : player);
    hand.state = { ...hand.state, board: [parseCard("2c"), parseCard("7d"), parseCard("9h")], players };
    expect(projectTableStateForUser(runtime, "alice").ownHandSummary).toEqual({ category: "ONE_PAIR", label: "一对" });
    hand.state = { ...hand.state, board: [...hand.state.board, parseCard("2d")] };
    expect(projectTableStateForUser(runtime, "alice").ownHandSummary).toEqual({ category: "TWO_PAIR", label: "两对" });
    hand.state = { ...hand.state, board: [...hand.state.board, parseCard("Kh")] };
    expect(projectTableStateForUser(runtime, "alice").ownHandSummary).toEqual({ category: "FULL_HOUSE", label: "葫芦" });
  });

  it("sends no private cards to a spectator or ordinary admin socket", () => {
    const runtime = runtimeWithHand();
    const spectator = JSON.stringify(projectTableStateForUser(runtime, "spectator"));
    const admin = JSON.stringify(projectTableStateForUser(runtime, "admin"));
    for (const player of runtime.currentHand!.state.players) {
      for (const card of player.holeCards) {
        const stable = serializeCard(card);
        expect(spectator).not.toContain(stable);
        expect(admin).not.toContain(stable);
      }
    }
  });

  it("never includes deck, remaining deck, future board, or internal runtime fields", () => {
    const runtime = runtimeWithHand();
    const projection = projectTableStateForUser(runtime, "alice");
    const serialized = JSON.stringify(projection);
    const futureCard = runtime.currentHand!.state.deck[0]!;
    expect(serialized).not.toMatch(/remainingDeck|processedAction|actionCache|gameSessionId|passwordHash/i);
    expect(Object.prototype.hasOwnProperty.call(projection.hand ?? {}, "deck")).toBe(false);
    expect(serialized).not.toContain(serializeCard(futureCard));
  });

  it("projects every blind chip in the active main pot", () => {
    const runtime = runtimeWithHand();
    const projection = projectTableStateForUser(runtime, "alice");
    expect(projection.hand?.mainPot).toBe(30);
    expect(projection.hand?.sidePots).toEqual([]);
  });

  it("uses the durable seat stack and removes completed cards after the review closes", () => {
    const runtime = runtimeWithHand();
    runtime.lastCompletedHand = runtime.currentHand;
    runtime.currentHand = null;
    runtime.status = "START_COUNTDOWN";
    runtime.seats.set(0, { ...runtime.seats.get(0)!, stack: 500, version: 2 });

    const projection = projectTableStateForUser(runtime, "alice");

    expect(projection.seats.find((seat) => seat.userId === "alice")?.stack).toBe(500);
    expect(projection.hand).toBeNull();
  });

  it("treats a pure returned-chip recipient as a winner for the settlement UI", () => {
    const runtime = runtimeWithHand();
    const completed = runtime.currentHand!;
    completed.state = {
      ...completed.state,
      actionHistory: [
        ...completed.state.actionHistory,
        { amount: 10, eventType: "UNCALLED_BET_RETURNED", handId: completed.state.handId, playerId: "alice", stateVersion: completed.state.stateVersion },
      ],
    };
    runtime.lastCompletedHand = completed;
    runtime.currentHand = null;
    runtime.status = "START_COUNTDOWN";

    expect(projectTableStateForUser(runtime, "alice").lastHandSummary?.winnerUserIds).toContain("alice");
  });

  it("does not project a disconnected active seat as an insufficient-player stop", () => {
    const runtime = runtimeWithHand();
    runtime.currentHand = null;
    runtime.status = "IDLE";
    runtime.room = { ...runtime.room, requiresManualStart: false, tableStartedAt: new Date("2026-01-01T00:00:00Z") };
    runtime.removePresence("bob", "b1");

    expect(projectTableStateForUser(runtime, "alice").tableRunState).toBe("RUNNING");
  });

  it("projects voluntary reveals one card at a time without leaking the other card", () => {
    const runtime = runtimeWithHand();
    const completed = runtime.currentHand!;
    runtime.currentHand = null;
    runtime.status = "POST_HAND_REVIEW";
    runtime.postHandReview = {
      endsAt: new Date("2026-01-01T00:00:04Z"),
      hand: completed,
      voluntarilyRevealedCardIndicesByUser: { alice: [0] },
      voluntarilyRevealedUserIds: [],
    };

    const alice = projectTableStateForUser(runtime, "alice");
    const bob = projectTableStateForUser(runtime, "bob");
    const aliceCards = completed.state.players.find((player) => player.playerId === "alice")!.holeCards.map(serializeCard);

    expect(bob.hand?.publicHoleCardSlots?.alice).toEqual([aliceCards[0], null]);
    expect(bob.hand?.publicHoleCards.alice).toBeUndefined();
    expect(JSON.stringify(bob)).not.toContain(aliceCards[1]);
    expect(alice.seats.find((seat) => seat.userId === "alice")?.voluntarilyRevealedCardIndices).toEqual([0]);
    expect(alice.canRevealOwnCards).toBe(true);

    runtime.postHandReview = {
      ...runtime.postHandReview,
      voluntarilyRevealedCardIndicesByUser: { alice: [0, 1] },
      voluntarilyRevealedUserIds: ["alice"],
    };
    expect(projectTableStateForUser(runtime, "alice").canRevealOwnCards).toBe(true);
  });

  it("projects a public hand label only after both hole cards are public", () => {
    const runtime = runtimeWithHand();
    const hand = runtime.currentHand!;
    hand.state = {
      ...hand.state,
      board: [parseCard("2c"), parseCard("7d"), parseCard("9h"), parseCard("Js"), parseCard("3s")],
      players: hand.state.players.map((player) => player.playerId === "alice"
        ? { ...player, holeCards: [parseCard("Kc"), parseCard("Kd")] as const }
        : player),
    };
    runtime.currentHand = null;
    runtime.status = "POST_HAND_REVIEW";
    runtime.postHandReview = {
      endsAt: new Date("2026-01-01T00:00:04Z"),
      hand,
      voluntarilyRevealedCardIndicesByUser: { alice: [0] },
      voluntarilyRevealedUserIds: [],
    };

    expect(projectTableStateForUser(runtime, "spectator").seats.find((seat) => seat.userId === "alice")?.publicHandLabel).toBeNull();
    runtime.postHandReview = {
      ...runtime.postHandReview,
      voluntarilyRevealedCardIndicesByUser: { alice: [0, 1] },
      voluntarilyRevealedUserIds: ["alice"],
    };
    expect(projectTableStateForUser(runtime, "spectator").seats.find((seat) => seat.userId === "alice")?.publicHandLabel).toBe("一对");
  });

  it("projects only durable seat state when completed-hand persistence has failed", () => {
    const runtime = runtimeWithHand();
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!.playerId;
    runtime.currentHand!.state = applyPlayerAction(hand, { actionType: "fold", playerId: actor }).state;
    runtime.status = "PERSISTENCE_ERROR";

    const projection = projectTableStateForUser(runtime, "alice");

    expect(runtime.currentHand?.state.status).toBe("finished");
    expect(projection.runtimeStatus).toBe("PERSISTENCE_ERROR");
    expect(projection.hand).toBeNull();
    expect(projection.seats.map((seat) => seat.stack)).toEqual([400, 400]);
    expect(JSON.stringify(projection)).not.toMatch(/HAND_FINISHED|POT_AWARDED|CARDS_REVEALED/u);
  });

  it("hides every private hand field while a room is in recovery error", () => {
    const runtime = runtimeWithHand();
    runtime.status = "RECOVERY_ERROR";

    const projection = projectTableStateForUser(runtime, "alice");

    expect(projection.hand).toBeNull();
    expect(JSON.stringify(projection)).not.toMatch(/holeCards|deck|remainingDeck/i);
    expect(projection.seats.map((seat) => seat.stack)).toEqual([400, 400]);
  });
});
