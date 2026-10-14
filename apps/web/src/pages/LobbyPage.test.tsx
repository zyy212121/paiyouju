import type { PublicRoom } from "../api/client.js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../stores/auth-store.js";
import { useRoomStore } from "../stores/room-store.js";
import { LobbyPage } from "./LobbyPage.js";

const closedRoom = {
  actionTimeSeconds: 30, archivedAt: null, bigBlind: 20, closeRequestedAt: "2026-08-24T00:00:00.000Z", closedAt: "2026-08-24T00:01:00.000Z", createdAt: "2026-08-24T00:00:00.000Z", durationMinutes: 60, expiresAt: "2026-08-24T01:00:00.000Z",
  hasPassword: false, id: "room-closed", initialBuyIn: 2_000, maximumBuyIn: 2_000, maxSeats: 2, memberRole: "OWNER", members: [{ joinedAt: "2026-08-24T00:00:00.000Z", role: "OWNER", user: { id: "user-a", nickname: "Alice", username: "alice" } }],
  minimumBuyIn: 400, name: "已结束测试桌", nextHandPaused: false, ownerId: "user-a", paidCardRevealCost: 10, paidCardRevealEnabled: true, requiresManualStart: true, runItTwiceEnabled: false,
  roomCode: "123456", smallBlind: 10, specialMode: "NORMAL", status: "CLOSED", squidRoundGraceEndsAt: null, squidRoundNumber: 1, squidStake: null, tableStartedAt: null, updatedAt: "2026-08-24T00:01:00.000Z",
} satisfies PublicRoom;

describe("LobbyPage closed rooms", () => {
  beforeEach(() => {
    useAuthStore.setState({ error: null, status: "authenticated", user: { avatarId: "avatar-01", createdAt: "2026-08-20T00:00:00.000Z", hasPhoneNumber: true, id: "user-a", nickname: "Alice", phoneMasked: "199****0002", role: "USER", username: "alice", walletBalance: 10_000 } });
    const archiveRoom = vi.fn().mockImplementation(async (roomId: string, operationId: string) => {
      useRoomStore.setState((state) => ({ closedRooms: state.closedRooms.filter((room) => room.id !== roomId) }));
      return { alreadyArchived: false, archivedAt: "2026-08-24T00:02:00.000Z", operationId, roomId };
    });
    const archiveAllClosedRooms = vi.fn().mockImplementation(async () => {
      useRoomStore.setState({ closedRooms: [] });
      return 1;
    });
    useRoomStore.setState({ archiveAllClosedRooms, archiveRoom, closedRooms: [closedRoom], closedRoomsNextCursor: null, currentRoom: null, error: null, loading: false, loadClosedRooms: vi.fn().mockResolvedValue(undefined), loadLobby: vi.fn().mockResolvedValue(undefined), rooms: [], wallet: null });
  });

  it("keeps CLOSED rooms out of active cards and removes them only from the list after confirmation", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LobbyPage /></MemoryRouter>);
    const closedList = screen.getByTestId("closed-room-list");
    expect(closedList).toHaveTextContent("已结束测试桌");
    expect(screen.getByText("还没有进行中的房间")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "从列表移除" }));
    expect(screen.getByRole("dialog", { name: "确认移除已结束房间" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(useRoomStore.getState().archiveRoom).toHaveBeenCalledWith("room-closed", expect.any(String)));
    expect(closedList).not.toHaveTextContent("已结束测试桌");
  });

  it("clears every owned closed-room page with one in-app confirmation", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LobbyPage /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "一键清空已结束房间" }));
    expect(screen.getByRole("dialog", { name: "确认清空已结束房间" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认清空" }));
    await waitFor(() => expect(useRoomStore.getState().archiveAllClosedRooms).toHaveBeenCalledOnce());
    expect(screen.getByTestId("closed-room-list")).toHaveTextContent("暂无未归档的已结束房间");
  });
});
