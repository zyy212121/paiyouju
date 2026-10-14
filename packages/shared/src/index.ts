import { z } from "zod";

export const PRODUCT_NAME = "牌友局" as const;
export const MIN_POINTS = 0 as const;
export const MAX_POINTS = 2_000_000_000 as const;

export const ApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string(),
        requestId: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export function successResponseSchema<T extends z.ZodType>(data: T) {
  return z.object({ data }).strict();
}

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal(`${PRODUCT_NAME} server`),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export * from "./history.js";
export * from "./avatar.js";
export * from "./bomb-pot.js";
export * from "./account.js";
export * from "./profile.js";
export * from "./replay.js";
export * from "./realtime.js";
export * from "./room-chat.js";
export * from "./rooms.js";
export * from "./squid-mode.js";
export * from "./table-fees.js";
