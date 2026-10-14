import { afterEach, describe, expect, it, vi } from "vitest";

import { apiRequest, createOperationId, HttpApiError, readableError } from "./client.js";

describe("private API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("forces every request to bypass browser HTTP caches", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { headers: { "content-type": "application/json" }, status: 200 }));
    await expect(apiRequest<{ readonly ok: boolean }>("/api/private")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/private", expect.objectContaining({ cache: "no-store", credentials: "include" }));
  });

  it("rejects offline writes before fetch is called", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(apiRequest("/api/private", { method: "POST" })).rejects.toMatchObject({ code: "OFFLINE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds the CSRF request marker to every write and does not add it to GET", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ data: { ok: true } }), { headers: { "content-type": "application/json" }, status: 200 }),
    );
    await apiRequest("/api/write", { method: "POST" });
    const writeInit = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(writeInit?.headers).get("x-wepoker-request")).toBe("1");
    await apiRequest("/api/read");
    const readInit = fetchMock.mock.calls[1]?.[1];
    expect(new Headers(readInit?.headers).has("x-wepoker-request")).toBe(false);
  });

  it("generates a secure operation id when randomUUID is unavailable on LAN HTTP", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, index) => { bytes[index] = index; });
        return bytes;
      },
    });

    expect(createOperationId()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("turns an Origin rejection into an actionable local-startup hint", () => {
    expect(readableError(new HttpApiError("ORIGIN_NOT_ALLOWED", "请求来源不可信"))).toBe(
      "访问地址与服务器配置不一致，请使用启动终端显示的牌友局网址重新打开",
    );
  });
});
