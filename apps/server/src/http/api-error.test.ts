import { describe, expect, it } from "vitest";

import { ApiError, success } from "./api-error.js";

describe("HTTP contracts", () => {
  it("keeps stable safe error details", () => {
    const error = new ApiError(401, "AUTH_REQUIRED", "需要先登录");

    expect(error).toMatchObject({
      code: "AUTH_REQUIRED",
      message: "需要先登录",
      statusCode: 401,
    });
    expect(error.expose).toBe(true);
  });

  it("wraps successful data in one envelope", () => {
    expect(success({ balance: 10_000 })).toEqual({ data: { balance: 10_000 } });
  });
});
