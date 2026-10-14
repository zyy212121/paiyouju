import type { Card } from "../card.js";
import { PokerRuleError } from "./errors.js";
import { settleHand, settleRunoutBoards } from "./settlement.js";
import { nextMatchingSeat } from "./seats.js";
import type { ActionOptions, ActionResult, DomainEvent, HandState, PlayerHandState, Street } from "./types.js";

function makeEvent(state: HandState, eventType: DomainEvent["eventType"], extra: Omit<DomainEvent, "handId" | "eventType" | "stateVersion"> = {}): DomainEvent {
  return { handId: state.handId, eventType, stateVersion: state.stateVersion, ...extra };
}

function canAct(player: Pick<PlayerHandState, "hasFolded" | "isAllIn">): boolean {
  return !player.hasFolded && !player.isAllIn;
}

export function nextPendingActor(state: HandState, fromSeat: number): number | null {
  return nextMatchingSeat(state.players, fromSeat, state.config.maxSeats, (candidate) => {
    const player = state.players.find((item) => item.seatIndex === candidate.seatIndex)!;
    return canAct(player) && (!player.hasActedThisStreet || player.committedThisStreet < state.currentBet);
  });
}

export function bettingRoundComplete(state: HandState): boolean {
  return state.players.filter(canAct).every((player) => player.hasActedThisStreet && player.committedThisStreet === state.currentBet);
}

function finish(state: HandState, uncontestedWinnerId?: string): { state: HandState; events: readonly DomainEvent[] } {
  const settlement = settleHand(state, uncontestedWinnerId);
  const players = state.players.map((player) => ({
    ...player,
    stack: settlement.finalStacks[player.playerId]!,
    holeCardsVisibility: uncontestedWinnerId === undefined && !player.hasFolded ? "showdown" as const : player.hasFolded ? "hidden" as const : "private" as const,
  }));
  const events: DomainEvent[] = [];
  if (uncontestedWinnerId === undefined) {
    events.push(makeEvent(state, "SHOWDOWN_STARTED"), makeEvent(state, "CARDS_REVEALED", { cards: players.filter((player) => !player.hasFolded).flatMap((player) => player.holeCards) }));
  }
  for (const [potIndex, pot] of settlement.pots.entries()) {
    events.push(makeEvent(state, "POT_AWARDED", { potIndex, amount: pot.amount, winners: pot.winners }));
  }
  for (const [playerId, amount] of Object.entries(settlement.uncalledReturnsByPlayer)) {
    events.push(makeEvent(state, "UNCALLED_BET_RETURNED", { playerId, amount }));
  }
  events.push(makeEvent(state, "HAND_FINISHED"));
  return {
    state: { ...state, status: "finished", street: uncontestedWinnerId === undefined ? "showdown" : state.street, players, currentActorSeat: null, pots: settlement.pots, settlement, actionHistory: [...state.actionHistory, ...events] },
    events,
  };
}

function dealForStreet(deck: readonly Card[], street: Street): { cards: readonly Card[]; deck: readonly Card[] } {
  const count = street === "flop" ? 3 : 1;
  return { cards: deck.slice(0, count), deck: deck.slice(count) };
}

function canOfferRunoutChoice(state: HandState): boolean {
  const contenders = state.players.filter((player) => !player.hasFolded);
  return state.board.length < 5 && contenders.length === 2 && contenders.some((player) => player.isAllIn);
}

export function progressAfterAction(state: HandState, actingSeat: number, options: ActionOptions = {}): { state: HandState; events: readonly DomainEvent[] } {
  const remaining = state.players.filter((player) => !player.hasFolded);
  if (remaining.length === 1) return finish(state, remaining[0]!.playerId);

  const actionablePlayers = state.players.filter(canAct);
  const soleActorOwesNothing = actionablePlayers.length <= 1
    && (actionablePlayers[0]?.committedThisStreet ?? state.currentBet) >= state.currentBet;
  if (soleActorOwesNothing) {
    if (options.deferHeadsUpAllInRunout && canOfferRunoutChoice(state)) {
      const event = makeEvent(state, "RUNOUT_CHOICE_STARTED");
      return {
        state: { ...state, status: "runout_choice", currentActorSeat: null, actionHistory: [...state.actionHistory, event] },
        events: [event],
      };
    }
    const needed = 5 - state.board.length;
    const cards = state.deck.slice(0, needed);
    const runout = { ...state, street: "showdown" as const, board: [...state.board, ...cards], deck: state.deck.slice(needed), currentActorSeat: null };
    const dealEvent = makeEvent(runout, "BOARD_DEALT", { street: "showdown", cards });
    const finished = finish({ ...runout, actionHistory: [...runout.actionHistory, dealEvent] });
    return { state: finished.state, events: [dealEvent, ...finished.events] };
  }

  if (!bettingRoundComplete(state)) {
    return { state: { ...state, currentActorSeat: nextPendingActor(state, actingSeat) }, events: [] };
  }

  if (state.street === "river") return finish({ ...state, street: "showdown", currentActorSeat: null });
  const nextStreet: Street = state.street === "preflop" ? "flop" : state.street === "flop" ? "turn" : "river";
  const dealt = dealForStreet(state.deck, nextStreet);
  const players = state.players.map((player) => ({ ...player, committedThisStreet: 0, hasActedThisStreet: false, lastActedBetLevel: null, lastActedFullRaiseSize: null }));
  const advanced: HandState = {
    ...state, street: nextStreet, players, board: [...state.board, ...dealt.cards], deck: dealt.deck,
    currentBet: 0, lastFullRaiseSize: state.config.bigBlind, currentActorSeat: null,
  };
  const currentActorSeat = nextMatchingSeat(players, state.buttonSeat, state.config.maxSeats, canAct);
  const events = [makeEvent(advanced, "STREET_ADVANCED", { street: nextStreet }), makeEvent(advanced, "BOARD_DEALT", { street: nextStreet, cards: dealt.cards })];
  return { state: { ...advanced, currentActorSeat, actionHistory: [...advanced.actionHistory, ...events] }, events };
}

export function resolveRunoutChoice(state: HandState, runTwice: boolean): ActionResult {
  if (state.status !== "runout_choice" || !canOfferRunoutChoice(state)) {
    throw new PokerRuleError("HAND_NOT_ACTIVE", "Hand is not awaiting a runout choice", { handId: state.handId, status: state.status });
  }
  const stateVersion = state.stateVersion + 1;
  const runoutCount = runTwice ? 2 : 1;
  const resolving: HandState = { ...state, stateVersion };
  const choiceEvent = makeEvent(resolving, "RUNOUT_CHOICE_RESOLVED", { runoutCount });
  const needed = 5 - state.board.length;

  if (!runTwice) {
    const cards = state.deck.slice(0, needed);
    const runout: HandState = {
      ...resolving,
      status: "active",
      street: "showdown",
      board: [...state.board, ...cards],
      deck: state.deck.slice(needed),
      currentActorSeat: null,
      actionHistory: [...state.actionHistory, choiceEvent],
    };
    const dealEvent = makeEvent(runout, "BOARD_DEALT", { street: "showdown", cards, runoutIndex: 1 });
    const finished = finish({ ...runout, actionHistory: [...runout.actionHistory, dealEvent] });
    return { state: finished.state, events: [choiceEvent, dealEvent, ...finished.events] };
  }

  const shared = [...state.board];
  const firstCards = state.deck.slice(0, needed);
  const secondCards = state.deck.slice(needed, needed * 2);
  const boards: readonly [readonly Card[], readonly Card[]] = [
    [...shared, ...firstCards],
    [...shared, ...secondCards],
  ];
  const showdown: HandState = {
    ...resolving,
    status: "active",
    street: "showdown",
    board: boards[0],
    deck: state.deck.slice(needed * 2),
    currentActorSeat: null,
    runoutBoards: boards,
    runoutSharedCardCount: shared.length,
  };
  const settlement = settleRunoutBoards(showdown, boards);
  const players = showdown.players.map((player) => ({
    ...player,
    stack: settlement.finalStacks[player.playerId]!,
    holeCardsVisibility: player.hasFolded ? "hidden" as const : "showdown" as const,
  }));
  const events: DomainEvent[] = [choiceEvent];
  for (const runout of settlement.runouts!) {
    events.push(makeEvent(showdown, "BOARD_DEALT", {
      street: "showdown",
      cards: runout.runoutIndex === 1 ? firstCards : secondCards,
      runoutIndex: runout.runoutIndex,
    }));
    if (runout.runoutIndex === 1) {
      events.push(
        makeEvent(showdown, "SHOWDOWN_STARTED"),
        makeEvent(showdown, "CARDS_REVEALED", { cards: players.filter((player) => !player.hasFolded).flatMap((player) => player.holeCards) }),
      );
    }
    for (const [potIndex, pot] of runout.pots.entries()) {
      events.push(makeEvent(showdown, "POT_AWARDED", { potIndex, amount: pot.amount, winners: pot.winners, runoutIndex: runout.runoutIndex }));
    }
  }
  events.push(makeEvent(showdown, "HAND_FINISHED", { runoutCount: 2 }));
  return {
    state: {
      ...showdown,
      status: "finished",
      players,
      pots: settlement.pots,
      settlement,
      actionHistory: [...state.actionHistory, ...events],
    },
    events,
  };
}
