import { z } from "zod";

import { MAX_POINTS } from "../../config/environment.js";

export const WalletMutationInputSchema = z
  .object({
    idempotencyKey: z.string().min(1).max(160),
    metadata: z.record(z.string(), z.unknown()).optional(),
    relatedGameSessionId: z.string().cuid().optional(),
    relatedHandId: z.string().cuid().optional(),
    relatedRoomId: z.string().cuid().optional(),
    signedAmount: z
      .number()
      .int()
      .min(-MAX_POINTS)
      .max(MAX_POINTS)
      .refine((value) => value !== 0),
    type: z.enum([
      "INITIAL_GRANT",
      "PAID_CARD_REVEAL",
      "ADMIN_ADJUSTMENT",
    ]),
    userId: z.string().cuid(),
  })
  .strict();

export const LedgerQuerySchema = z
  .object({
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type WalletMutationInput = z.infer<typeof WalletMutationInputSchema>;
export type LedgerQuery = z.infer<typeof LedgerQuerySchema>;
