import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tableSocket } from "../realtime/table-socket.js";
import { useTableStore } from "../stores/table-store.js";
import { TablePage } from "./TablePage.js";

describe("TablePage connection recovery", () => {
  beforeEach(() => {
    useTableStore.setState({ connection: "disconnected", error: null, state: null });
    vi.spyOn(tableSocket, "connect").mockImplementation(() => undefined);
    vi.spyOn(tableSocket, "disconnect").mockImplementation(() => undefined);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("does not leave a rejected realtime connection looking like an endless recovery", () => {
    render(
      <MemoryRouter initialEntries={["/tables/room-1"]}>
        <Routes><Route element={<TablePage />} path="/tables/:roomId" /></Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("无法连接牌桌服务器");
    expect(screen.queryByText("正在恢复服务器权威牌桌状态…")).not.toBeInTheDocument();
  });
});
