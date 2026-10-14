import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";

describe("authenticated H5 application", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ error: { code: "AUTH_REQUIRED", message: "请先登录", requestId: "test" } }), ok: false }));
    window.history.pushState({}, "", "/login");
  });

  it("renders a compact login page without policy footnotes", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "欢迎回来" })).toBeInTheDocument();
    expect(screen.queryByText(/钻石仅供娱乐/)).not.toBeInTheDocument();
    expect(screen.queryByText(/不发送短信验证码/)).not.toBeInTheDocument();
  });
});
