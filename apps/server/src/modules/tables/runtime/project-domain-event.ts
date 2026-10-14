import type { DomainEvent } from "@paiyouju/poker-core";
import type { ProjectedAction } from "@paiyouju/shared";

function required<T>(value: T | undefined, field: string, eventType: DomainEvent["eventType"]): T {
  if (value === undefined) throw new Error(`${eventType} is missing ${field}`);
  return value;
}

export function projectDomainEvent(event: DomainEvent): ProjectedAction {
  const base = { stateVersion: event.stateVersion };
  switch (event.eventType) {
    case "HAND_STARTED":
    case "HOLE_CARDS_DEALT":
    case "SHOWDOWN_STARTED":
    case "CARDS_REVEALED":
      return { ...base, eventType: event.eventType };
    case "HAND_FINISHED":
      return { ...base, eventType: event.eventType, ...(event.runoutCount === undefined ? {} : { runoutCount: event.runoutCount }) };
    case "RUNOUT_CHOICE_STARTED":
      return { ...base, eventType: event.eventType };
    case "RUNOUT_CHOICE_RESOLVED":
      return { ...base, eventType: event.eventType, runoutCount: required(event.runoutCount, "runoutCount", event.eventType) };
    case "BUTTON_ASSIGNED":
      return { ...base, eventType: event.eventType, seatIndex: required(event.seatIndex, "seatIndex", event.eventType) };
    case "BLIND_POSTED":
      return {
        ...base,
        amount: required(event.amount, "amount", event.eventType),
        eventType: event.eventType,
        playerId: required(event.playerId, "playerId", event.eventType),
        seatIndex: required(event.seatIndex, "seatIndex", event.eventType),
      };
    case "PLAYER_FOLDED":
    case "PLAYER_CHECKED":
      return {
        ...base,
        eventType: event.eventType,
        playerId: required(event.playerId, "playerId", event.eventType),
        street: required(event.street, "street", event.eventType),
      };
    case "PLAYER_CALLED":
    case "PLAYER_BET":
    case "PLAYER_RAISED":
    case "PLAYER_ALL_IN":
      return {
        ...base,
        amount: required(event.amount, "amount", event.eventType),
        eventType: event.eventType,
        playerId: required(event.playerId, "playerId", event.eventType),
        street: required(event.street, "street", event.eventType),
      };
    case "UNCALLED_BET_RETURNED":
      return {
        ...base,
        amount: required(event.amount, "amount", event.eventType),
        eventType: event.eventType,
        playerId: required(event.playerId, "playerId", event.eventType),
      };
    case "STREET_ADVANCED":
    case "BOARD_DEALT":
      return { ...base, eventType: event.eventType, ...(event.runoutIndex === undefined ? {} : { runoutIndex: event.runoutIndex }), street: required(event.street, "street", event.eventType) };
    case "POT_AWARDED":
      return {
        ...base,
        amount: required(event.amount, "amount", event.eventType),
        eventType: event.eventType,
        potIndex: required(event.potIndex, "potIndex", event.eventType),
        ...(event.runoutIndex === undefined ? {} : { runoutIndex: event.runoutIndex }),
        winners: [...required(event.winners, "winners", event.eventType)],
      };
  }
}
