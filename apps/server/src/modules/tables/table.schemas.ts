import { z } from "zod";

import { MAX_POINTS } from "../../config/environment.js";

const RoomIdSchema = z.string().min(1).max(64);
const OperationIdSchema = z.string().uuid();
const ExpectedStateVersionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const OperationEnvelopeSchema = z
  .object({
    expectedStateVersion: ExpectedStateVersionSchema,
    operationId: OperationIdSchema,
    roomId: RoomIdSchema,
  })
  .strict();

export const TakeSeatInputSchema = OperationEnvelopeSchema.extend({
  buyInAmount: z.number().int().min(1).max(MAX_POINTS),
  seatIndex: z.number().int().min(0).max(8),
}).strict();

export const BuyInInputSchema = OperationEnvelopeSchema.extend({
  amount: z.number().int().min(1).max(MAX_POINTS),
}).strict();

export const SeatOperationInputSchema = OperationEnvelopeSchema;

export type TakeSeatInput = z.infer<typeof TakeSeatInputSchema>;
export type BuyInInput = z.infer<typeof BuyInInputSchema>;
export type SeatOperationInput = z.infer<typeof SeatOperationInputSchema>;
