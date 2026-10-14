import {
  LoginAccountInputSchema,
  RegisterAccountInputSchema,
  type LoginAccountInput,
  type RegisterAccountInput,
} from "@paiyouju/shared";

export const RegisterInputSchema = RegisterAccountInputSchema;
export const LoginInputSchema = LoginAccountInputSchema;

export type RegisterInput = RegisterAccountInput;
export type LoginInput = LoginAccountInput;
