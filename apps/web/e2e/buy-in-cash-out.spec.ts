import { expect, test } from "@playwright/test";

import { createRoom, registerUser, takeSeat, wallet, walletLedger, withTestDatabase } from "./helpers.js";

test("auto 100BB sit, stand, and re-sit keep diamonds independent from room points", async ({ browser }) => {
  const player = await registerUser(browser, "cashout");
  try {
    expect((await wallet(player.page)).balance).toBe(10_000);
    const { roomId } = await createRoom(player.page, "房间点数验收");
    await takeSeat(player.page, 0);
    expect((await wallet(player.page)).balance).toBe(10_000);
    await expect(player.page.getByTestId("hero-hand")).toHaveAttribute("data-seat-stack", "2000");

    await player.page.getByRole("button", { name: "打开牌桌菜单" }).click();
    await player.page.getByRole("button", { name: "站起围观" }).click();
    await expect(player.page.getByRole("button", { name: "选择座位 1" })).toBeVisible();
    expect((await wallet(player.page)).balance).toBe(10_000);

    await takeSeat(player.page, 0);
    expect((await wallet(player.page)).balance).toBe(10_000);
    await expect(player.page.getByTestId("hero-hand")).toHaveAttribute("data-seat-stack", "2000");
    await player.page.getByRole("button", { name: "打开牌桌菜单" }).click();
    await player.page.getByRole("button", { name: "站起围观" }).click();
    await expect(player.page.getByRole("button", { name: "选择座位 1" })).toBeVisible();
    expect((await wallet(player.page)).balance).toBe(10_000);

    const ledger = await walletLedger(player.page);
    expect(ledger.filter((entry) => entry.type === "BUY_IN")).toHaveLength(0);
    expect(ledger.filter((entry) => entry.type === "CASH_OUT")).toHaveLength(0);

    await withTestDatabase(async (database) => {
      const sessions = await database.gameSession.findMany({ include: { tableStackEntries: true }, where: { roomId } });
      expect(sessions).toHaveLength(2);
      expect(sessions.every((session) => session.status === "CLOSED" && session.totalBuyIn === 2_000 && session.totalCashOut === 2_000)).toBe(true);
      expect(sessions.flatMap((session) => session.tableStackEntries.map((entry) => [entry.type, entry.signedAmount]))).toEqual(expect.arrayContaining([["BUY_IN", 2_000], ["CASH_OUT", -2_000]]));
      expect(await database.tableSeat.count({ where: { roomId } })).toBe(0);
    });
  } finally {
    await player.context.close();
  }
});
