import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ApiErrorResponseSchema,
  HealthResponseSchema,
  MAX_POINTS,
  PRODUCT_NAME,
  successResponseSchema,
} from "./index.js";

describe("shared platform contracts", () => {
  it("exposes the approved Chinese product name", () => {
    expect(PRODUCT_NAME).toBe("牌友局");
  });

  it("accepts the server health response and rejects extra fields", () => {
    const result = HealthResponseSchema.parse({
      status: "ok",
      service: "牌友局 server",
    });

    expect(result).toEqual({ status: "ok", service: "牌友局 server" });
    expect(() =>
      HealthResponseSchema.parse({
        status: "ok",
        service: "牌友局 server",
        internalVersion: "private",
      }),
    ).toThrow();
  });
});

describe("shared HTTP contracts", () => {
  it("validates the safe error envelope", () => {
    expect(
      ApiErrorResponseSchema.parse({
        error: { code: "AUTH_REQUIRED", message: "需要先登录", requestId: "request-1" },
      }),
    ).toBeDefined();
  });

  it("creates typed success envelopes and publishes the point ceiling", () => {
    expect(successResponseSchema(z.object({ balance: z.number() })).parse({ data: { balance: MAX_POINTS } })).toEqual({ data: { balance: 2_000_000_000 } });
  });
});
