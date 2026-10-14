import { describe, expect, it, vi } from "vitest";

import { tableState } from "../../../test/table-fixture.js";
import { copyRoomInvite, roomInviteText } from "./copy-room-invite.js";

describe("copyRoomInvite", () => {
  it("copies the same safe invite payload without password, session, phone, or internal room id", async () => {
    const room = tableState().room;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await expect(copyRoomInvite(room)).resolves.toBe(true);
    const text = roomInviteText(room, "https://poker.example");
    expect(text).toContain("周末私人牌局");
    expect(text).toContain("123456");
    expect(text).toContain("10/20");
    expect(text).toContain("/rooms/join?roomCode=123456");
    expect(text).not.toContain("room-1");
    expect(text).not.toMatch(/password|session|phone|手机号/iu);
    expect(writeText).toHaveBeenCalledOnce();
  });
});
