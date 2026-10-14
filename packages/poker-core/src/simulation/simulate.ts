import { createStandardDeck } from "../deck.js";
import { applyPlayerAction, assertHandStateInvariants, startHand, type PlayerAction, type SeatState } from "../engine/index.js";
import { shuffleCards } from "../shuffle.js";
import { chooseBotAction } from "./bot.js";
import { createSeededRandom } from "./seeded-random.js";

export interface SimulationOptions { readonly hands: number; readonly seed: number }
export interface SimulationSummary {
  readonly hands: number; readonly seed: number; readonly completed: number; readonly failed: number;
  readonly invariantFailures: number; readonly elapsedTimeMs: number; readonly sidePotHands: number; readonly shortAllInHands: number;
}

export class SimulationError extends Error {
  public constructor(
    message: string,
    public readonly diagnostics: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) { super(message, options); this.name = "SimulationError"; }
}

export function runSimulation(options: SimulationOptions): SimulationSummary {
  if (!Number.isSafeInteger(options.hands) || options.hands <= 0 || !Number.isSafeInteger(options.seed)) throw new SimulationError("hands must be positive and seed must be a safe integer", { options });
  const random = createSeededRandom(options.seed);
  let completed = 0, sidePotHands = 0, shortAllInHands = 0;

  for (let handIndex = 0; handIndex < options.hands; handIndex += 1) {
    const playerCount = 2 + random.nextInt(8);
    const maxSeats = playerCount + random.nextInt(10 - playerCount);
    const occupied = new Set<number>();
    while (occupied.size < playerCount) occupied.add(random.nextInt(maxSeats));
    const seats: SeatState[] = [...occupied].sort((a, b) => a - b).map((seatIndex, index) => ({
      playerId: `h${handIndex}p${index}`, seatIndex,
      stack: 1 + random.nextInt(300), isParticipating: true,
    }));
    const deck = shuffleCards(createStandardDeck(), random);
    const actions: PlayerAction[] = [];
    let hadShortAllInRaise = false;
    try {
      let state = startHand({ handId: `sim-${options.seed}-${handIndex}`, config: { maxSeats, smallBlind: 5, bigBlind: 10 }, seats, previousButtonSeat: random.nextInt(maxSeats), deck }).state;
      assertHandStateInvariants(state);
      let actionCount = 0;
      while (state.status === "active") {
        if (actionCount++ >= 500) throw new SimulationError("Action limit exceeded", { handIndex, actionCount });
        const actor = state.players.find((player) => player.seatIndex === state.currentActorSeat);
        if (actor === undefined) throw new SimulationError("No actor for active hand", { handIndex, state });
        const action = chooseBotAction(state, actor.playerId, random);
        actions.push(action);
        if (action.actionType === "allIn") {
          const target = actor.committedThisStreet + actor.stack;
          hadShortAllInRaise ||= target > state.currentBet && target - state.currentBet < state.lastFullRaiseSize;
        }
        const previous = state;
        state = applyPlayerAction(state, action).state;
        assertHandStateInvariants(state, previous);
      }
      if (state.settlement === null) throw new SimulationError("Finished hand has no settlement", { handIndex, state });
      if (state.settlement.pots.length > 1) sidePotHands += 1;
      if (hadShortAllInRaise) shortAllInHands += 1;
      completed += 1;
    } catch (cause) {
      throw new SimulationError("Simulation hand failed", { seed: options.seed, handIndex, tableConfig: { maxSeats, smallBlind: 5, bigBlind: 10 }, initialPlayers: seats, deckIdentifier: deck.map((card) => `${card.rank}-${card.suit}`).join(","), actions }, { cause });
    }
  }
  return { hands: options.hands, seed: options.seed, completed, failed: 0, invariantFailures: 0, elapsedTimeMs: 0, sidePotHands, shortAllInHands };
}
