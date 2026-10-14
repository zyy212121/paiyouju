import type { HistoryEvent, ReplayPlayer, ReplayState } from "./history.js";

function clonePlayer(player: ReplayPlayer): ReplayPlayer {
  return { ...player, holeCards: player.holeCards === null ? null : [...player.holeCards] as [string, string] } as ReplayPlayer;
}

function potLayers(players: readonly ReplayPlayer[]): number[] {
  const levels = [...new Set(players.map((player) => player.committed).filter((amount) => amount > 0))]
    .sort((left, right) => left - right);
  let previous = 0;
  return levels.map((level) => {
    const contributors = players.filter((player) => player.committed >= level).length;
    const amount = (level - previous) * contributors;
    previous = level;
    return amount;
  }).filter((amount) => amount > 0);
}

function updateActor(
  players: readonly ReplayPlayer[],
  actorUserId: string | null,
  update: (player: ReplayPlayer) => ReplayPlayer,
): ReplayPlayer[] {
  if (actorUserId === null) return players.map(clonePlayer);
  let found = false;
  const result = players.map((player) => {
    if (player.userId !== actorUserId) return clonePlayer(player);
    found = true;
    return update(clonePlayer(player));
  });
  if (!found) throw new Error("REPLAY_ACTOR_NOT_FOUND");
  return result;
}

function contribute(state: ReplayState, event: HistoryEvent, allIn: boolean): ReplayState {
  const amount = event.amount ?? 0;
  const players = updateActor(state.players, event.actorUserId, (player) => {
    if (amount < 0 || amount > player.stack) throw new Error("REPLAY_INVALID_CONTRIBUTION");
    return { ...player, allIn: allIn || player.stack === amount, committed: player.committed + amount, stack: player.stack - amount };
  });
  const pots = potLayers(players);
  return { ...state, players, pot: pots.reduce((sum, value) => sum + value, 0), pots };
}

function consumePotLayers(pots: readonly number[], amount: number): number[] {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("REPLAY_INVALID_POT_CONSUMPTION");
  const next = [...pots];
  let remaining = amount;
  for (let index = 0; index < next.length && remaining > 0; index += 1) {
    const consumed = Math.min(next[index] ?? 0, remaining);
    next[index] = (next[index] ?? 0) - consumed;
    remaining -= consumed;
  }
  if (remaining !== 0) throw new Error("REPLAY_INVALID_POT_CONSUMPTION");
  return next;
}

export function applyReplayEvent(previous: ReplayState, event: HistoryEvent): ReplayState {
  const state: ReplayState = {
    board: [...previous.board],
    players: previous.players.map(clonePlayer),
    pot: previous.pot,
    pots: [...previous.pots],
    street: previous.street,
    winners: [...previous.winners],
  };
  switch (event.type) {
    case "BLIND_POSTED":
    case "PLAYER_CALLED":
    case "PLAYER_BET":
    case "PLAYER_RAISED":
      return contribute(state, event, false);
    case "PLAYER_ALL_IN":
      return contribute(state, event, true);
    case "PLAYER_FOLDED":
      return { ...state, players: updateActor(state.players, event.actorUserId, (player) => ({ ...player, folded: true })) };
    case "FLOP_DEALT":
      return { ...state, board: [...state.board, ...(event.cards ?? [])], street: "FLOP" };
    case "TURN_DEALT":
      return { ...state, board: [...state.board, ...(event.cards ?? [])], street: "TURN" };
    case "RIVER_DEALT":
      return { ...state, board: [...state.board, ...(event.cards ?? [])], street: "RIVER" };
    case "SHOWDOWN":
      return { ...state, street: "SHOWDOWN" };
    case "CARDS_REVEALED":
      return {
        ...state,
        players: updateActor(state.players, event.actorUserId, (player) => ({
          ...player,
          holeCards: event.cards?.length === 2 ? [event.cards[0]!, event.cards[1]!] : player.holeCards,
          holeCardsVisibility: event.visibility === "PURCHASED_AFTER_HAND" ? "PURCHASED" : "PUBLIC_SHOWDOWN",
        })),
      };
    case "POT_AWARDED": {
      const winners = event.winners;
      if (winners.length === 0 || event.amount === null || event.potIndex === null) throw new Error("REPLAY_INVALID_POT_AWARD");
      const baseShare = Math.floor(event.amount / winners.length);
      const baseAward = baseShare * winners.length;
      const players = state.players.map((player) => winners.includes(player.userId)
        ? { ...clonePlayer(player), stack: player.stack + baseShare }
        : clonePlayer(player));
      const pots = consumePotLayers(state.pots, baseAward);
      return { ...state, players, pot: state.pot - baseAward, pots, winners: [...new Set([...state.winners, ...winners])] };
    }
    case "ODD_CHIP_AWARDED": {
      const playerId = event.winners[0] ?? null;
      const players = updateActor(state.players, playerId, (player) => ({ ...player, stack: player.stack + 1 }));
      const pots = consumePotLayers(state.pots, 1);
      return { ...state, players, pot: state.pot - 1, pots };
    }
    case "UNCALLED_BET_RETURNED": {
      const amount = event.amount ?? 0;
      const players = updateActor(state.players, event.actorUserId, (player) => ({
        ...player,
        committed: Math.max(0, player.committed - amount),
        stack: player.stack + amount,
      }));
      let remaining = amount;
      const pots = [...state.pots];
      for (let index = pots.length - 1; index >= 0 && remaining > 0; index -= 1) {
        const consumed = Math.min(pots[index] ?? 0, remaining);
        pots[index] = (pots[index] ?? 0) - consumed;
        remaining -= consumed;
      }
      if (remaining !== 0) throw new Error("REPLAY_INVALID_UNCALLED_RETURN");
      return { ...state, players, pot: state.pot - amount, pots };
    }
    case "HAND_FINISHED":
      return { ...state, pot: Math.max(0, state.pot), pots: state.pots.map((amount) => Math.max(0, amount)) };
    case "HAND_STARTED":
    case "PLAYER_CHECKED":
      return state;
  }
}

export function reduceReplayEvents(initialState: ReplayState, events: readonly HistoryEvent[]): ReplayState {
  return events.reduce(applyReplayEvent, initialState);
}

export function replayStateAt(initialState: ReplayState, events: readonly HistoryEvent[], step: number): ReplayState {
  const boundedStep = Math.max(0, Math.min(events.length, Math.trunc(step)));
  return reduceReplayEvents(initialState, events.slice(0, boundedStep));
}
