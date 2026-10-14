interface SeatBuyInRoom {
  readonly initialBuyIn: number;
}

export function defaultSeatBuyIn(room: SeatBuyInRoom): number {
  return room.initialBuyIn;
}
