import { describe, expect, it } from "vitest";

import { LedgerQuerySchema, WalletMutationInputSchema } from "./wallet.schemas.js";

describe("wallet input", () => {
  it("accepts bounded integer mutations and pagination", () => {
    expect(
      WalletMutationInputSchema.parse({
        idempotencyKey: "admin-adjustment:request-1",
        signedAmount: -500,
        type: "ADMIN_ADJUSTMENT",
        userId: "cm00000000000000000000000",
      }),
    ).toMatchObject({ signedAmount: -500 });
    expect(LedgerQuerySchema.parse({ cursor: "10", limit: "100" })).toEqual({
      cursor: 10,
      limit: 100,
    });
  });

  it.each([0, 1.5, Number.NaN, 2_000_000_001, -2_000_000_001])(
    "rejects invalid signed amount %s",
    (signedAmount) => {
      expect(() =>
        WalletMutationInputSchema.parse({
          idempotencyKey: "test:key",
          signedAmount,
          type: "ADMIN_ADJUSTMENT",
          userId: "cm00000000000000000000000",
        }),
      ).toThrow();
    },
  );

  it("caps pagination at 100", () => {
    expect(() => LedgerQuerySchema.parse({ limit: "101" })).toThrow();
  });
});
