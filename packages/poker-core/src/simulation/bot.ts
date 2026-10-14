import { getLegalActions, type HandState, type PlayerAction } from "../engine/index.js";
import type { RandomIntSource } from "../random.js";

export function chooseBotAction(state: HandState, playerId: string, random: RandomIntSource): PlayerAction {
  const legal = getLegalActions(state, playerId);
  const roll = random.nextInt(100);
  if (legal.canCheck && roll < 65) return { playerId, actionType: "check" };
  if (legal.canCall && roll < 58) return { playerId, actionType: "call" };
  if (legal.canFold && roll < 72) return { playerId, actionType: "fold" };
  if (legal.canRaise && legal.minimumRaiseTo !== null && roll < 88) return { playerId, actionType: "raiseTo", amount: legal.minimumRaiseTo };
  if (legal.canBet && legal.minimumBet !== null && roll < 88) return { playerId, actionType: "bet", amount: legal.minimumBet };
  if (legal.canAllIn && roll < 96) return { playerId, actionType: "allIn" };
  if (legal.canCheck) return { playerId, actionType: "check" };
  if (legal.canCall) return { playerId, actionType: "call" };
  if (legal.canAllIn) return { playerId, actionType: "allIn" };
  return { playerId, actionType: "fold" };
}
