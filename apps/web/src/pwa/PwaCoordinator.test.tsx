import { act, render, screen } from "@testing-library/react";
import type { TableStateProjection } from "@paiyouju/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNetworkStore } from "../stores/network-store.js";
import { tableSocket } from "../realtime/table-socket.js";
import { useTableStore } from "../stores/table-store.js";
import { PwaCoordinator } from "./PwaCoordinator.js";

const serviceWorker = vi.hoisted(() => ({
  needRefresh: null as (() => void) | null,
  update: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("virtual:pwa-register", () => ({
  registerSW: (options: { readonly onNeedRefresh?: () => void }) => {
    serviceWorker.needRefresh = options.onNeedRefresh ?? null;
    return serviceWorker.update;
  },
}));

describe("safe PWA updates", () => {
  afterEach(() => {
    vi.useRealTimers();
    serviceWorker.needRefresh = null;
    serviceWorker.update.mockClear();
    useNetworkStore.setState({ online: true, pendingWrites: 0, refreshVersion: 0 });
    useTableStore.setState({ state: null });
  });

  it("announces reconnection, advances the resource epoch, and requests canonical table state", async () => {
    vi.useFakeTimers();
    useNetworkStore.setState({ online: false, pendingWrites: 0, refreshVersion: 4 });
    const requestState = vi.spyOn(tableSocket, "requestState").mockImplementation(() => undefined);
    render(<PwaCoordinator />);
    expect(screen.getByText(/当前离线/u)).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event("online")));
    expect(screen.getByText(/已重新连接/u)).toBeInTheDocument();
    expect(useNetworkStore.getState().refreshVersion).toBe(5);
    expect(requestState).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(screen.queryByText(/已重新连接/u)).not.toBeInTheDocument();
  });

  it("does not activate an update while a write is pending", () => {
    useNetworkStore.setState({ online: true, pendingWrites: 1 });
    render(<PwaCoordinator />);
    act(() => serviceWorker.needRefresh?.());
    expect(screen.getByText(/当前操作完成后再更新/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "安全更新" })).toBeDisabled();
    act(() => useNetworkStore.setState({ pendingWrites: 0 }));
    expect(screen.getByRole("button", { name: "安全更新" })).toBeEnabled();
  });

  it("allows an update after settlement while the completed-hand summary remains visible", () => {
    useTableStore.setState({
      state: { hand: { handId: "completed-hand" }, runtimeStatus: "IDLE" } as TableStateProjection,
    });
    render(<PwaCoordinator />);
    act(() => serviceWorker.needRefresh?.());
    expect(screen.getByRole("button", { name: "安全更新" })).toBeEnabled();
  });

  it("blocks an update while a closing room can still have an active hand", () => {
    useTableStore.setState({
      state: { hand: { handId: "closing-hand" }, runtimeStatus: "CLOSING" } as TableStateProjection,
    });
    render(<PwaCoordinator />);
    act(() => serviceWorker.needRefresh?.());
    expect(screen.getByRole("button", { name: "安全更新" })).toBeDisabled();
    expect(screen.getByText(/当前牌局结束后再更新/u)).toBeInTheDocument();
  });
});
