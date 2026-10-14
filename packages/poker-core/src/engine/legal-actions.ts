import type { HandState, LegalAction, PlayerHandState } from "./types.js";

const NO_ACTIONS: LegalAction = {
  canFold: false, canCheck: false, callAmount: 0, canCall: false,
  canBet: false, minimumBet: null, maximumBet: null,
  canRaise: false, minimumRaiseTo: null, maximumRaiseTo: null,
  canAllIn: false, allInTo: null,
};

function hasRaiseRights(state: HandState, player: PlayerHandState): boolean {
  if (!player.hasActedThisStreet || player.lastActedBetLevel === null || player.lastActedFullRaiseSize === null) return true;
  return state.currentBet - player.lastActedBetLevel >= player.lastActedFullRaiseSize;
}

export function getLegalActions(state: HandState, playerId: string): LegalAction {
  const player = state.players.find((candidate) => candidate.playerId === playerId);
  if (state.status !== "active" || player === undefined || player.seatIndex !== state.currentActorSeat || player.hasFolded || player.isAllIn) return NO_ACTIONS;

  const toCall = Math.max(0, state.currentBet - player.committedThisStreet);
  const callAmount = Math.min(toCall, player.stack);
  const allInTo = player.committedThisStreet + player.stack;
  const maximumRaiseTo = allInTo;
  const minimumRaiseTo = state.currentBet + state.lastFullRaiseSize;
  const canRaise = state.currentBet > 0 && hasRaiseRights(state, player) && maximumRaiseTo >= minimumRaiseTo;
  const canBet = state.currentBet === 0 && player.stack >= state.config.bigBlind;

  const canAllIn = player.stack > 0 && (allInTo <= state.currentBet || hasRaiseRights(state, player));
  return {
    canFold: true,
    canCheck: toCall === 0,
    callAmount,
    canCall: toCall > 0 && player.stack > 0,
    canBet,
    minimumBet: canBet ? state.config.bigBlind : null,
    maximumBet: canBet ? allInTo : null,
    canRaise,
    minimumRaiseTo: canRaise ? minimumRaiseTo : null,
    maximumRaiseTo: canRaise ? maximumRaiseTo : null,
    canAllIn,
    allInTo: canAllIn ? allInTo : null,
  };
}
