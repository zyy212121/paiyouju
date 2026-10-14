import { serializeCard, type Card } from "../card.js";
import { PokerRuleError } from "./errors.js";
import { progressAfterAction } from "./round.js";
import { getNextButtonSeat, nextMatchingSeat } from "./seats.js";
import { settleHand } from "./settlement.js";
import type { ActionResult, DomainEvent, HandState, PlayerHandState, StartHandInput, TableConfig } from "./types.js";

function isSafePositive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateConfig(config: TableConfig): void {
  if (!Number.isInteger(config.maxSeats) || config.maxSeats < 2 || config.maxSeats > 9 || !isSafePositive(config.smallBlind) || !isSafePositive(config.bigBlind) || config.bigBlind <= config.smallBlind || (config.variant !== undefined && !["STANDARD", "SHORT_DECK"].includes(config.variant))) {
    throw new PokerRuleError("INVALID_TABLE_CONFIG", "Table config must have 2-9 seats and positive increasing blinds", { config });
  }
}

function validateInput(input: StartHandInput): void {
  validateConfig(input.config);
  if (input.bombPotBlind !== undefined && !isSafePositive(input.bombPotBlind)) {
    throw new PokerRuleError("INVALID_TABLE_CONFIG", "Bomb-pot blind must be a positive safe integer", { bombPotBlind: input.bombPotBlind });
  }
  const seats = new Set<number>();
  const players = new Set<string>();
  for (const seat of input.seats) {
    if (seat.playerId.length === 0 || players.has(seat.playerId) || !Number.isInteger(seat.seatIndex) || seat.seatIndex < 0 || seat.seatIndex >= input.config.maxSeats || seats.has(seat.seatIndex) || !Number.isSafeInteger(seat.stack) || seat.stack < 0) {
      throw new PokerRuleError("INVALID_SEAT_STATE", "Seat state is invalid", { seat });
    }
    seats.add(seat.seatIndex); players.add(seat.playerId);
  }
  const variant = input.config.variant ?? "STANDARD";
  const expectedCards = variant === "SHORT_DECK" ? 36 : 52;
  if (input.deck.length !== expectedCards || new Set(input.deck.map(serializeCard)).size !== expectedCards || (variant === "SHORT_DECK" && input.deck.some((card) => card.rank < 6))) {
    throw new PokerRuleError("INVALID_DECK", `A ${variant.toLowerCase()} hand requires ${String(expectedCards)} unique cards`, { cardCount: input.deck.length, variant });
  }
}

function event(handId: string, eventType: DomainEvent["eventType"], extra: Omit<DomainEvent, "handId" | "eventType" | "stateVersion"> = {}): DomainEvent {
  return { handId, eventType, stateVersion: 1, ...extra };
}

function postBlind(player: PlayerHandState, required: number): PlayerHandState {
  const amount = Math.min(player.stack, required);
  const stack = player.stack - amount;
  return { ...player, stack, committedThisStreet: amount, committedThisHand: amount, isAllIn: stack === 0 };
}

function postBombBlind(player: PlayerHandState, required: number): PlayerHandState {
  const amount = Math.min(player.stack, required);
  const stack = player.stack - amount;
  return { ...player, stack, committedThisStreet: 0, committedThisHand: amount, isAllIn: stack === 0 };
}

export function startHand(input: StartHandInput): ActionResult {
  validateInput(input);
  const eligibleSeats = input.seats.filter((seat) => seat.isParticipating && seat.stack > 0);
  const buttonSeat = getNextButtonSeat(input.seats, input.previousButtonSeat, input.config.maxSeats);
  const headsUp = eligibleSeats.length === 2;
  const skeletons: PlayerHandState[] = eligibleSeats.map((seat) => ({
    playerId: seat.playerId, seatIndex: seat.seatIndex, startingStack: seat.stack, stack: seat.stack,
    committedThisStreet: 0, committedThisHand: 0, hasFolded: false, isAllIn: false,
    hasActedThisStreet: false, lastActedBetLevel: null, lastActedFullRaiseSize: null,
    holeCards: [{ rank: 2, suit: "clubs" }, { rank: 2, suit: "diamonds" }], holeCardsVisibility: "private",
  }));
  const active = (player: Pick<PlayerHandState, "hasFolded" | "isAllIn">) => !player.hasFolded && !player.isAllIn;
  const smallBlindSeat = headsUp ? buttonSeat : nextMatchingSeat(skeletons, buttonSeat, input.config.maxSeats, active)!;
  const bigBlindSeat = nextMatchingSeat(skeletons, smallBlindSeat, input.config.maxSeats, active)!;

  const bombPotBlind = input.bombPotBlind;
  let players = bombPotBlind === undefined
    ? skeletons.map((player) => player.seatIndex === smallBlindSeat ? postBlind(player, input.config.smallBlind) : player)
    : skeletons.map((player) => postBombBlind(player, bombPotBlind));
  if (bombPotBlind === undefined) {
    players = players.map((player) => player.seatIndex === bigBlindSeat ? postBlind(player, input.config.bigBlind) : player);
  }
  const dealOrder: number[] = [];
  let cursor = buttonSeat;
  for (let count = 0; count < players.length; count += 1) {
    cursor = nextMatchingSeat(players, cursor, input.config.maxSeats, () => true)!;
    dealOrder.push(cursor);
  }
  let deckIndex = 0;
  for (let round = 0; round < 2; round += 1) {
    for (const seatIndex of dealOrder) {
      const playerIndex = players.findIndex((player) => player.seatIndex === seatIndex);
      const player = players[playerIndex]!;
      const cards = [...player.holeCards] as [Card, Card];
      cards[round] = input.deck[deckIndex++]!;
      players[playerIndex] = { ...player, holeCards: cards };
    }
  }
  const currentBet = Math.max(...players.map((player) => player.committedThisStreet));
  const preflopStart = headsUp ? buttonSeat : bigBlindSeat;
  let currentActorSeat = nextMatchingSeat(players, headsUp ? (bigBlindSeat) : preflopStart, input.config.maxSeats, active);
  if (headsUp && players.find((player) => player.seatIndex === buttonSeat)?.isAllIn === false) currentActorSeat = buttonSeat;
  const actionablePlayers = players.filter(active);
  if (actionablePlayers.length <= 1 && (actionablePlayers[0]?.committedThisStreet ?? currentBet) >= currentBet) currentActorSeat = null;
  let board: readonly Card[] = [];
  let remainingDeck = input.deck.slice(deckIndex);
  const blindEvents: DomainEvent[] = bombPotBlind === undefined
    ? [
        event(input.handId, "BLIND_POSTED", { seatIndex: smallBlindSeat, playerId: players.find((player) => player.seatIndex === smallBlindSeat)!.playerId, amount: players.find((player) => player.seatIndex === smallBlindSeat)!.committedThisStreet }),
        event(input.handId, "BLIND_POSTED", { seatIndex: bigBlindSeat, playerId: players.find((player) => player.seatIndex === bigBlindSeat)!.playerId, amount: players.find((player) => player.seatIndex === bigBlindSeat)!.committedThisStreet }),
      ]
    : players.map((player) => event(input.handId, "BLIND_POSTED", { amount: player.committedThisHand, playerId: player.playerId, seatIndex: player.seatIndex }));
  const initialEvents: DomainEvent[] = [
    event(input.handId, "HAND_STARTED"), event(input.handId, "BUTTON_ASSIGNED", { seatIndex: buttonSeat }),
    ...blindEvents,
    event(input.handId, "HOLE_CARDS_DEALT"),
  ];
  if (bombPotBlind !== undefined) {
    const flop = remainingDeck.slice(0, 3);
    remainingDeck = remainingDeck.slice(3);
    board = flop;
    currentActorSeat = nextMatchingSeat(players, buttonSeat, input.config.maxSeats, active);
    const flopEvents = [
      event(input.handId, "STREET_ADVANCED", { street: "flop" }),
      event(input.handId, "BOARD_DEALT", { cards: flop, street: "flop" }),
    ];
    let bombState: HandState = {
      actionHistory: [...initialEvents, ...flopEvents], bigBlindSeat, board, bombPotBlind, buttonSeat,
      config: { ...input.config }, currentActorSeat, currentBet: 0, deck: remainingDeck, handId: input.handId,
      lastFullRaiseSize: input.config.bigBlind, players, pots: [], settlement: null,
      smallBlindSeat, stateVersion: 1, status: "active", street: "flop",
    };
    const actionable = players.filter(active);
    if (actionable.length <= 1) {
      const progressed = progressAfterAction(bombState, buttonSeat);
      bombState = progressed.state;
      return { events: [...initialEvents, ...flopEvents, ...progressed.events], state: bombState };
    }
    return { events: [...initialEvents, ...flopEvents], state: bombState };
  }
  let state: HandState = {
    handId: input.handId, status: "active", street: "preflop", config: { ...input.config }, players,
    buttonSeat, smallBlindSeat, bigBlindSeat, currentActorSeat, currentBet, lastFullRaiseSize: input.config.bigBlind,
    board, deck: remainingDeck, pots: [], actionHistory: initialEvents, stateVersion: 1, settlement: null,
  };
  let resultEvents: readonly DomainEvent[] = initialEvents;
  if (currentActorSeat === null) {
    if (input.deferHeadsUpAllInRunout && board.length < 5 && players.length === 2 && players.some((player) => player.isAllIn)) {
      const choiceEvent = event(input.handId, "RUNOUT_CHOICE_STARTED");
      state = { ...state, status: "runout_choice", actionHistory: [...initialEvents, choiceEvent] };
      return { state, events: [...initialEvents, choiceEvent] };
    }
    board = remainingDeck.slice(0, 5); remainingDeck = remainingDeck.slice(5);
    state = { ...state, street: "showdown", board, deck: remainingDeck };
    const settlement = settleHand(state);
    players = state.players.map((player) => ({ ...player, stack: settlement.finalStacks[player.playerId]!, holeCardsVisibility: "showdown" }));
    const finishEvents: DomainEvent[] = [
      event(input.handId, "BOARD_DEALT", { street: "showdown", cards: board }),
      event(input.handId, "SHOWDOWN_STARTED"),
      event(input.handId, "CARDS_REVEALED", { cards: players.flatMap((player) => player.holeCards) }),
      ...settlement.pots.map((pot, potIndex) => event(input.handId, "POT_AWARDED", { potIndex, amount: pot.amount, winners: pot.winners })),
      ...Object.entries(settlement.uncalledReturnsByPlayer).map(([playerId, amount]) => event(input.handId, "UNCALLED_BET_RETURNED", { playerId, amount })),
      event(input.handId, "HAND_FINISHED"),
    ];
    state = { ...state, status: "finished", players, pots: settlement.pots, settlement, currentActorSeat: null, actionHistory: [...initialEvents, ...finishEvents] };
    resultEvents = [...initialEvents, ...finishEvents];
  }
  return { state, events: resultEvents };
}
