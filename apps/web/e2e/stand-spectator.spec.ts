import { expect, test } from "@playwright/test";

import { joinRoom, registerUser, takeSeat, waitForHand } from "./helpers.js";

for (const maxSeats of [6, 9]) {
  for (const mode of ["普通", "鱿鱼", "短牌", "暴击"]) {
    test(`${maxSeats} 人${mode}桌未弃牌站起后恢复观战布局`, async ({ browser }) => {
      const first = await registerUser(browser, "standa", { width: 375, height: 812 });
      const second = await registerUser(browser, "standb", { width: 375, height: 812 });
      try {
        await first.page.getByRole("link", { name: "创建房间" }).click();
        await first.page.getByLabel("房间名称").fill("站起观战回归");
        await first.page.getByLabel("最大座位").selectOption(String(maxSeats));
        if (mode !== "普通") await first.page.getByLabel(`${mode}模式`, { exact: true }).check();
        const created = first.page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/rooms");
        await first.page.getByRole("button", { name: "创建房间" }).click();
        const room = (await (await created).json()) as { data: { id: string; roomCode: string } };
        await first.page.waitForURL(`/tables/${room.data.id}`);
        await takeSeat(first.page, 0, mode === "短牌" ? 500 : 2_000);
        await joinRoom(second.page, room.data.roomCode, "站起观战回归");
        await takeSeat(second.page, 1, mode === "短牌" ? 500 : 2_000);
        await expect(first.page.locator('[data-seat-index="1"] [aria-label^="玩家状态："]')).not.toHaveAttribute("aria-label", /已断开/u);
        await first.page.getByRole("button", { name: "开始游戏" }).click();
        await Promise.all([waitForHand(first.page), waitForHand(second.page)]);
        const pages = [first.page, second.page];
        await expect.poll(async () => (await Promise.all(pages.map((page) => page.getByTestId("action-panel").isVisible()))).some(Boolean)).toBe(true);
        const page = await first.page.getByTestId("action-panel").isVisible() ? first.page : second.page;
        await expect(page.getByTestId("hero-hand")).toHaveAttribute("data-player-visual-state", "active");
        const seatNumber = page === first.page ? 1 : 2;
        const tableSpace = page.locator(".table-play-space");
        expect(await tableSpace.evaluate((element) => Number.parseFloat(getComputedStyle(element).bottom))).toBeGreaterThan(200);
        await page.getByRole("button", { name: "打开牌桌菜单" }).click();
        await page.getByRole("button", { name: "站起围观", exact: true }).click();
        if (mode === "鱿鱼") await page.getByRole("dialog", { name: "离开鱿鱼牌局" }).getByRole("button", { name: "确认", exact: true }).click();
        await expect(page.getByTestId("mobile-table-stage")).toHaveAttribute("data-view-mode", "spectator");
        await expect(page.getByTestId("hero-hand")).toHaveCount(0);
        await expect(page.locator(".table-hero-layer, .table-action-layer")).toHaveCount(0);
        await expect(page.getByRole("button", { name: `选择座位 ${seatNumber}` })).toBeEnabled();
        await expect(page.getByRole("alert")).toHaveCount(0);
        expect(await tableSpace.evaluate((element) => Number.parseFloat(getComputedStyle(element).bottom))).toBeLessThanOrEqual(20);
        await page.setViewportSize({ width: 812, height: 375 });
        expect(await tableSpace.evaluate((element) => Number.parseFloat(getComputedStyle(element).bottom))).toBeLessThanOrEqual(20);
        expect(await tableSpace.evaluate((element) => Number.parseFloat(getComputedStyle(element).right))).toBeLessThanOrEqual(20);
        await page.reload();
        await expect(page.getByTestId("mobile-table-stage")).toHaveAttribute("data-view-mode", "spectator");
        await expect(page.locator(".table-hero-layer, .table-action-layer")).toHaveCount(0);
      } finally { await Promise.allSettled([first.context.close(), second.context.close()]); }
    });
  }
}
