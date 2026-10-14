import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { AuthPage } from "./AuthPage.js";
import { useAuthStore } from "../stores/auth-store.js";
import { useNetworkStore } from "../stores/network-store.js";

describe("offline write controls", () => {
  afterEach(() => {
    useNetworkStore.setState({ online: true, pendingWrites: 0 });
    useAuthStore.setState({ error: null, status: "guest", user: null });
  });

  it("disables an HTTP write form while offline", () => {
    useNetworkStore.setState({ online: false, pendingWrites: 0 });
    useAuthStore.setState({ error: null, status: "guest", user: null });
    render(<MemoryRouter><AuthPage mode="login" /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "离线时不可提交" })).toBeDisabled();
  });
});
