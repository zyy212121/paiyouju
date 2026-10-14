import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

describe("safe fallback responses", () => {
  it("never exposes an unknown route as a legacy plain error", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/unknown" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "请求的资源不存在",
        requestId: expect.any(String),
      },
    });
    await app.close();
  });

  it("redacts cookies and request bodies from structured logs", async () => {
    let logs = "";
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    });
    const app = await buildApp({ logger: { stream } });
    await app.inject({
      headers: { cookie: "wepoker_session=raw-secret-token" },
      method: "POST",
      payload: { password: "plain-secret-password" },
      url: "/unknown",
    });
    app.log.info(
      { password: "plain-secret-password", tokenHash: "raw-secret-token" },
      "redaction probe",
    );
    await app.close();

    expect(logs).not.toContain("raw-secret-token");
    expect(logs).not.toContain("plain-secret-password");
    expect(logs).toContain("[REDACTED]");
  });
});
