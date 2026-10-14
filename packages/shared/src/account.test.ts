import { describe, expect, it } from "vitest";

import {
  BindPhoneInputSchema,
  LoginAccountInputSchema,
  PhoneNumberSchema,
  RegisterAccountInputSchema,
} from "./account.js";

describe("Step 6.5 phone account contracts", () => {
  it("accepts only an exact mainland-style 11 digit login identifier", () => {
    expect(PhoneNumberSchema.parse("13800138000")).toBe("13800138000");
    for (const invalid of ["+8613800138000", "138 0013 8000", "138-0013-8000", "03800138000", "1380013800", "138001380000", "1380013800.0", "1e10", "１２８００１３８０００"]) {
      expect(PhoneNumberSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("keeps register, login and one-time binding payloads strict", () => {
    expect(RegisterAccountInputSchema.parse({ nickname: "爱丽丝", password: "password-1", phoneNumber: "13800138000" })).toMatchObject({ phoneNumber: "13800138000" });
    expect(LoginAccountInputSchema.parse({ identifier: "13800138000", password: "password-1" })).toMatchObject({ identifier: "13800138000" });
    expect(BindPhoneInputSchema.parse({ currentPassword: "password-1", operationId: "10000000-0000-4000-8000-000000000001", phoneNumber: "13900139000" })).toMatchObject({ phoneNumber: "13900139000" });
    expect(RegisterAccountInputSchema.safeParse({ nickname: "爱丽丝", password: "password-1", phoneNumber: "13800138000", username: "alice" }).success).toBe(false);
  });
});
