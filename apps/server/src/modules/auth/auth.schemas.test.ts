import { describe, expect, it } from "vitest";

import { LoginInputSchema, RegisterInputSchema } from "./auth.schemas.js";

describe("authentication input", () => {
  it("accepts an exact phone registration without a client username", () => {
    expect(
      RegisterInputSchema.parse({
        nickname: "  爱丽丝  ",
        password: "example-password",
        phoneNumber: "13800138000",
      }),
    ).toEqual({
      nickname: "爱丽丝",
      password: "example-password",
      phoneNumber: "13800138000",
    });
  });

  it.each([
    { nickname: "爱丽丝", password: "example-password", phoneNumber: "+8613800138000" },
    { nickname: "爱丽丝", password: "example-password", phoneNumber: "138 0013 8000" },
    { nickname: "<b>Alice</b>", password: "example-password", phoneNumber: "13800138000" },
    { nickname: "Alice\u0000", password: "example-password", phoneNumber: "13800138000" },
    { nickname: "   ", password: "example-password", phoneNumber: "13800138000" },
    { nickname: "爱丽丝", password: "        ", phoneNumber: "13800138000" },
    { nickname: "爱丽丝", password: "short", phoneNumber: "13800138000" },
  ])("rejects invalid registration %#", (input) => {
    expect(() => RegisterInputSchema.parse(input)).toThrow();
  });

  it("strictly rejects unknown fields", () => {
    expect(() =>
      LoginInputSchema.parse({
        password: "example-password",
        role: "ADMIN",
        identifier: "13800138000",
      }),
    ).toThrow();
  });

  it("counts Unicode code points instead of UTF-16 units for nicknames", () => {
    expect(
      RegisterInputSchema.parse({
        nickname: "🃏".repeat(20),
        password: "example-password",
        phoneNumber: "13800138000",
      }).nickname,
    ).toBe("🃏".repeat(20));
    expect(() =>
      RegisterInputSchema.parse({
        nickname: "🃏".repeat(21),
        password: "example-password",
        phoneNumber: "13800138000",
      }),
    ).toThrow();
  });
});
