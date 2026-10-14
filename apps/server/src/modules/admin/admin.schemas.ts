import { z } from "zod";

import { MAX_POINTS } from "../../config/environment.js";

const PlainReasonSchema = z.string()
  .trim()
  .min(8)
  .max(200)
  .refine((value) => !/\p{Cc}/u.test(value), "reason contains a control character")
  .refine((value) => !/[<>]/u.test(value), "reason must be plain text");

export const AdminWalletAdjustmentSchema = z.object({
  operationId: z.uuid(),
  reason: PlainReasonSchema,
  signedAmount: z.number().int().min(-MAX_POINTS).max(MAX_POINTS).refine((value) => value !== 0),
}).strict();

export const AdminRoomActionSchema = z.object({
  operationId: z.uuid(),
  reason: PlainReasonSchema,
}).strict();

export const AdminDestructiveActionSchema = z.object({
  confirmation: z.literal("永久删除"),
  operationId: z.uuid(),
  reason: PlainReasonSchema,
}).strict();

export const AdminTestBotLeaseClaimSchema = z.object({
  count: z.number().int().min(1).max(9),
  leaseId: z.uuid(),
}).strict();

export const AdminTestBotLeaseSchema = z.object({
  leaseId: z.uuid(),
}).strict();

export const AdminListQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(100).optional(),
}).strict();

export type AdminListQuery = z.infer<typeof AdminListQuerySchema>;
export type AdminRoomActionInput = z.infer<typeof AdminRoomActionSchema>;
export type AdminDestructiveActionInput = z.infer<typeof AdminDestructiveActionSchema>;
export type AdminTestBotLeaseClaimInput = z.infer<typeof AdminTestBotLeaseClaimSchema>;
export type AdminTestBotLeaseInput = z.infer<typeof AdminTestBotLeaseSchema>;
export type AdminWalletAdjustmentInput = z.infer<typeof AdminWalletAdjustmentSchema>;
