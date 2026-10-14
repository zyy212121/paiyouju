import { z } from "zod";

import { NicknameSchema } from "./profile.js";
import { IdentifierSchema } from "./realtime.js";

export const PhoneNumberSchema = z.string().regex(/^1\d{10}$/);
export const LegacyUsernameSchema = z.string().min(3).max(32).regex(/^[A-Za-z0-9_]+$/);
export const PasswordSchema = z.string().min(8).max(128).refine((value) => value.trim().length > 0);

export const RegisterAccountInputSchema = z.object({
  nickname: NicknameSchema,
  password: PasswordSchema,
  phoneNumber: PhoneNumberSchema,
}).strict();

export const LoginAccountInputSchema = z.object({
  identifier: z.union([PhoneNumberSchema, LegacyUsernameSchema]),
  password: PasswordSchema,
}).strict();

export const BindPhoneInputSchema = z.object({
  currentPassword: PasswordSchema,
  operationId: IdentifierSchema,
  phoneNumber: PhoneNumberSchema,
}).strict();

export const PhoneBindingResultSchema = z.object({
  alreadyBound: z.boolean(),
  hasPhoneNumber: z.literal(true),
  operationId: IdentifierSchema,
  phoneMasked: z.string().regex(/^1\d{2}\*{4}\d{4}$/),
}).strict();

export type RegisterAccountInput = z.infer<typeof RegisterAccountInputSchema>;
export type LoginAccountInput = z.infer<typeof LoginAccountInputSchema>;
export type BindPhoneInput = z.infer<typeof BindPhoneInputSchema>;
export type PhoneBindingResult = z.infer<typeof PhoneBindingResultSchema>;
