import { z } from "zod";

import { GameSessionSummarySchema, NonNegativePointsSchema } from "./history.js";
import { AvatarIdSchema } from "./avatar.js";

const AggregatePointsSchema = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const NonNegativeAggregatePointsSchema = AggregatePointsSchema.min(0);

const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const HTML_PATTERN = /[<>]/;

export const NicknameSchema = z.string().trim().min(1)
  .refine((value) => Array.from(value).length <= 20, "nickname exceeds 20 visible characters")
  .refine((value) => !CONTROL_CHARACTER_PATTERN.test(value), "nickname contains control characters")
  .refine((value) => !HTML_PATTERN.test(value), "nickname contains HTML delimiters");

export const ProfileUpdateInputSchema = z.object({
  avatarId: AvatarIdSchema.optional(),
  nickname: NicknameSchema.optional(),
}).strict().refine((input) => input.avatarId !== undefined || input.nickname !== undefined, "profile patch is empty");

export const ProfileSchema = z.object({
  activeGameSessions: z.number().int().min(0),
  avatarId: AvatarIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  handsBreakEven: z.number().int().min(0),
  handsLost: z.number().int().min(0),
  handsPlayed: z.number().int().min(0),
  handsWon: z.number().int().min(0),
  hasPhoneNumber: z.boolean(),
  nickname: NicknameSchema,
  phoneMasked: z.string().regex(/^1\d{2}\*{4}\d{4}$/).nullable(),
  profitableHands: z.number().int().min(0),
  recentGames: z.array(GameSessionSummarySchema).max(10),
  role: z.enum(["USER", "ADMIN"]),
  totalBuyIn: NonNegativeAggregatePointsSchema,
  totalCashOut: NonNegativeAggregatePointsSchema,
  totalNetResult: AggregatePointsSchema,
  userId: z.string().min(1).max(64),
  username: z.string().min(1).max(32),
  walletBalance: NonNegativePointsSchema,
}).strict().superRefine((profile, context) => {
  if (profile.hasPhoneNumber !== (profile.phoneMasked !== null)) {
    context.addIssue({ code: "custom", message: "phone mask presence is inconsistent", path: ["phoneMasked"] });
  }
});

export type ProfileUpdateInput = z.infer<typeof ProfileUpdateInputSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
