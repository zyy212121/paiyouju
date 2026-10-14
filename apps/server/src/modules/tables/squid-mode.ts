import { MAX_POINTS } from "../../config/environment.js";

export interface SquidSeatState {
  readonly leavingAfterHand: boolean;
  readonly marked: boolean;
  readonly participant: boolean;
  readonly seatIndex: number;
  readonly stack: number;
  readonly userId: string;
}

export interface SquidSettlementResult {
  readonly autoBuyInAmount: number;
  readonly payerStackAfterPayment: number;
  readonly payerUserId: string;
  readonly recipientUserIds: readonly string[];
  readonly stakePerRecipient: number;
  readonly totalPayment: number;
}

export interface SquidHandEndResult {
  readonly roundCompleted: boolean;
  readonly seats: readonly SquidSeatState[];
  readonly settlement: SquidSettlementResult | null;
}

interface ResolveSquidHandEndInput {
  readonly forcedSettlementPending: boolean;
  readonly initialBuyIn: number;
  readonly mainPotWinnerUserIds: readonly string[];
  readonly seats: readonly SquidSeatState[];
  readonly stakePerRecipient: number;
}

function assertPoints(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_POINTS) {
    throw new RangeError(`${name} is outside the safe table-points range`);
  }
}

export function resolveSquidHandEnd(input: ResolveSquidHandEndInput): SquidHandEndResult {
  if (!Number.isSafeInteger(input.initialBuyIn) || input.initialBuyIn <= 0 || input.initialBuyIn > MAX_POINTS) {
    throw new RangeError("initial buy-in is outside the safe table-points range");
  }
  if (!Number.isSafeInteger(input.stakePerRecipient) || input.stakePerRecipient <= 0 || input.stakePerRecipient > MAX_POINTS) {
    throw new RangeError("squid stake is outside the safe table-points range");
  }
  if (new Set(input.seats.map((seat) => seat.userId)).size !== input.seats.length) {
    throw new RangeError("squid seats contain duplicate users");
  }
  for (const seat of input.seats) assertPoints(seat.stack, "seat stack");

  const uniqueMainPotWinner = input.mainPotWinnerUserIds.length === 1
    ? input.mainPotWinnerUserIds[0]!
    : null;
  let markedSeats = input.seats.map((seat) => {
    if (seat.userId !== uniqueMainPotWinner || !seat.participant) return { ...seat };
    const isFrozenForcedPayer = input.forcedSettlementPending && seat.leavingAfterHand && !seat.marked;
    return isFrozenForcedPayer ? { ...seat } : { ...seat, marked: true };
  });
  const participants = markedSeats.filter((seat) => seat.participant);
  const unmarked = participants.filter((seat) => !seat.marked);
  if (input.forcedSettlementPending && participants.length < 2) {
    return {
      roundCompleted: true,
      seats: markedSeats.map((seat) => ({ ...seat, marked: false, participant: true })),
      settlement: null,
    };
  }
  if (participants.length < 2 || unmarked.length !== 1) {
    return { roundCompleted: false, seats: markedSeats, settlement: null };
  }

  const payer = unmarked[0]!;
  const recipients = participants
    .filter((seat) => seat.userId !== payer.userId)
    .sort((left, right) => left.seatIndex - right.seatIndex);
  const totalPayment = input.stakePerRecipient * recipients.length;
  assertPoints(totalPayment, "total squid payment");
  const payerStackAfterPayment = payer.stack - totalPayment;
  const autoBuyInAmount = payerStackAfterPayment <= 0
    ? input.initialBuyIn - payerStackAfterPayment
    : 0;
  assertPoints(autoBuyInAmount, "automatic squid buy-in");

  const recipientIds = new Set(recipients.map((seat) => seat.userId));
  markedSeats = markedSeats.map((seat) => {
    let stack = seat.stack;
    if (seat.userId === payer.userId) {
      stack = payerStackAfterPayment <= 0 ? input.initialBuyIn : payerStackAfterPayment;
    } else if (recipientIds.has(seat.userId)) {
      stack += input.stakePerRecipient;
    }
    assertPoints(stack, "settled seat stack");
    return { ...seat, marked: false, participant: true, stack };
  });

  return {
    roundCompleted: true,
    seats: markedSeats,
    settlement: {
      autoBuyInAmount,
      payerStackAfterPayment,
      payerUserId: payer.userId,
      recipientUserIds: recipients.map((seat) => seat.userId),
      stakePerRecipient: input.stakePerRecipient,
      totalPayment,
    },
  };
}
