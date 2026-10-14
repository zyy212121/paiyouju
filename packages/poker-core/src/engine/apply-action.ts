import { PokerRuleError } from "./errors.js";
import { getLegalActions } from "./legal-actions.js";
import { progressAfterAction } from "./round.js";
import type { ActionOptions, ActionResult, DomainEvent, HandState, PlayerAction, PlayerHandState } from "./types.js";

function fail(code: ConstructorParameters<typeof PokerRuleError>[0], message: string, context: Readonly<Record<string, unknown>>): never {
  throw new PokerRuleError(code, message, context);
}

function payTo(player: PlayerHandState, target: number): PlayerHandState {
  const payment = target - player.committedThisStreet;
  const stack = player.stack - payment;
  return { ...player, stack, committedThisStreet: target, committedThisHand: player.committedThisHand + payment, isAllIn: stack === 0 };
}

export function applyPlayerAction(state: HandState, action: PlayerAction, options: ActionOptions = {}): ActionResult {
  if (state.status !== "active") fail("HAND_NOT_ACTIVE", "Hand is not active", { handId: state.handId });
  const index = state.players.findIndex((player) => player.playerId === action.playerId);
  if (index < 0) fail("PLAYER_NOT_IN_HAND", "Player is not in this hand", { playerId: action.playerId });
  const original = state.players[index]!;
  if (original.hasFolded) fail("PLAYER_ALREADY_FOLDED", "Player has already folded", { playerId: action.playerId });
  if (original.isAllIn) fail("PLAYER_ALL_IN", "All-in player cannot act", { playerId: action.playerId });
  if (original.seatIndex !== state.currentActorSeat) fail("NOT_PLAYER_TURN", "It is not this player's turn", { playerId: action.playerId, currentActorSeat: state.currentActorSeat });

  const legal = getLegalActions(state, action.playerId);
  let player = original;
  let currentBet = state.currentBet;
  let lastFullRaiseSize = state.lastFullRaiseSize;
  let eventType: DomainEvent["eventType"];
  let amount: number | undefined;
  const previousBet = state.currentBet;

  switch (action.actionType) {
    case "fold":
      player = { ...player, hasFolded: true };
      eventType = "PLAYER_FOLDED";
      break;
    case "check":
      if (!legal.canCheck) fail("ILLEGAL_CHECK", "Check is not legal while chips are owed", { playerId: action.playerId });
      eventType = "PLAYER_CHECKED";
      break;
    case "call": {
      if (!legal.canCall) fail("ILLEGAL_CALL", "Call is not legal", { playerId: action.playerId });
      const target = player.committedThisStreet + legal.callAmount;
      player = payTo(player, target); amount = legal.callAmount; eventType = player.isAllIn ? "PLAYER_ALL_IN" : "PLAYER_CALLED";
      break;
    }
    case "bet": {
      if (!Number.isSafeInteger(action.amount) || action.amount > player.committedThisStreet + player.stack) fail("AMOUNT_EXCEEDS_STACK", "Bet exceeds stack or is not a safe integer", { amount: action.amount });
      if (!legal.canBet || action.amount < (legal.minimumBet ?? Number.POSITIVE_INFINITY)) fail("ILLEGAL_BET", "Bet is below the legal minimum", { amount: action.amount });
      player = payTo(player, action.amount); currentBet = action.amount; lastFullRaiseSize = action.amount; amount = action.amount; eventType = player.isAllIn ? "PLAYER_ALL_IN" : "PLAYER_BET";
      break;
    }
    case "raiseTo": {
      const maximum = player.committedThisStreet + player.stack;
      if (!Number.isSafeInteger(action.amount) || action.amount > maximum) fail("AMOUNT_EXCEEDS_STACK", "Raise exceeds stack or is not a safe integer", { amount: action.amount, maximum });
      if (!legal.canRaise || action.amount < (legal.minimumRaiseTo ?? Number.POSITIVE_INFINITY)) fail("RAISE_BELOW_MINIMUM", "Raise-to amount is below the legal minimum", { amount: action.amount, minimumRaiseTo: legal.minimumRaiseTo });
      const increment = action.amount - currentBet;
      player = payTo(player, action.amount); currentBet = action.amount; lastFullRaiseSize = increment; amount = action.amount; eventType = player.isAllIn ? "PLAYER_ALL_IN" : "PLAYER_RAISED";
      break;
    }
    case "allIn": {
      const target = player.committedThisStreet + player.stack;
      if (!legal.canAllIn) fail(target > currentBet ? "ILLEGAL_RAISE" : "PLAYER_ALL_IN", "All-in is not legal in the current state", { playerId: action.playerId, target });
      player = payTo(player, target); amount = target;
      if (target > currentBet) {
        const increment = target - currentBet;
        currentBet = target;
        if (increment >= lastFullRaiseSize) lastFullRaiseSize = increment;
      }
      eventType = "PLAYER_ALL_IN";
      break;
    }
  }

  player = { ...player, hasActedThisStreet: true, lastActedBetLevel: currentBet, lastActedFullRaiseSize: lastFullRaiseSize };
  let players = state.players.map((candidate, playerIndex) => playerIndex === index ? player : candidate);
  const madeFullRaise = currentBet > previousBet && currentBet - previousBet >= state.lastFullRaiseSize;
  if (madeFullRaise) players = players.map((candidate) => candidate.playerId !== player.playerId && !candidate.hasFolded && !candidate.isAllIn ? { ...candidate, hasActedThisStreet: false } : candidate);

  const stateVersion = state.stateVersion + 1;
  const actionEvent: DomainEvent = {
    eventType, handId: state.handId, stateVersion, playerId: action.playerId, street: state.street,
    ...(amount === undefined ? {} : { amount }),
  };
  const acted: HandState = { ...state, players, currentBet, lastFullRaiseSize, stateVersion, actionHistory: [...state.actionHistory, actionEvent] };
  const progressed = progressAfterAction(acted, original.seatIndex, options);
  return { state: progressed.state, events: [actionEvent, ...progressed.events] };
}
