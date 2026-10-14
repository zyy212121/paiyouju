import { expect, test } from "@playwright/test";

import { cardCodes, closeTable, playToFlop, setupTwoPlayerTable, wallet, withTestDatabase } from "./helpers.js";

test("history, buyer-only paid reveal, finalized game, profile and Wallet remain consistent", async ({ browser }) => {
  test.setTimeout(90_000);
  const table = await setupTwoPlayerTable(browser, "history");
  try {
    const handId = (await table.first.page.getByTestId("hand-id").innerText()).trim();
    const aliceCards = await cardCodes(table.first.page.getByTestId("own-cards"));
    const bobCards = await cardCodes(table.second.page.getByTestId("own-cards"));
    expect(aliceCards).toHaveLength(2);
    expect(bobCards).toHaveLength(2);

    const pauseAccepted = await table.first.page.evaluate(async (roomId) => {
      const response = await fetch(`/api/rooms/${roomId}/pause`, {
        body: "{}",
        credentials: "include",
        headers: { "content-type": "application/json", "x-wepoker-request": "1" },
        method: "POST",
      });
      return response.ok;
    }, table.roomId);
    expect(pauseAccepted).toBe(true);

    await playToFlop([table.first.page, table.second.page]);
    const board = await cardCodes(table.first.page.getByTestId("board"));
    expect(board).toHaveLength(3);
    const foldButton = table.second.page.getByRole("button", { name: /弃牌$/u });
    await expect(foldButton).toBeEnabled();
    await foldButton.click();
    await Promise.all([
      expect(table.first.page.getByTestId("post-hand-review")).toBeVisible(),
      expect(table.second.page.getByTestId("post-hand-review")).toBeVisible(),
    ]);
    await Promise.all([
      expect(table.first.page.getByText("下一手已由房主暂停", { exact: true })).toBeVisible({ timeout: 10_000 }),
      expect(table.second.page.getByText("下一手已由房主暂停", { exact: true })).toBeVisible({ timeout: 10_000 }),
    ]);
    await Promise.all([
      expect(table.first.page.getByTestId("post-hand-review")).toHaveCount(0, { timeout: 10_000 }),
      expect(table.second.page.getByTestId("post-hand-review")).toHaveCount(0, { timeout: 10_000 }),
    ]);

    await table.first.page.goto("/hands");
    await expect(table.first.page.getByRole("heading", { name: "我的手牌" })).toBeVisible();
    await table.first.page.getByRole("link", { name: /history-双人桌/u }).click();
    await expect(table.first.page).toHaveURL(`/hands/${handId}`);
    await expect.poll(() => cardCodes(table.first.page.locator("header"))).toEqual([...board]);

    const bobPanel = table.first.page.locator("article").filter({ hasText: table.second.nickname });
    await expect(bobPanel.getByLabel("隐藏底牌")).toHaveCount(2);
    const hiddenHtml = await table.first.page.locator("body").innerHTML();
    for (const secret of bobCards) expect(hiddenHtml).not.toContain(`data-card-code="${secret}"`);

    const balanceBefore = await wallet(table.first.page);
    await table.first.page.getByRole("button", { name: "偷偷看 50钻石" }).click();
    const dialog = table.first.page.getByRole("dialog", { name: "确认查看整手隐藏牌" });
    await expect(dialog).toContainText("1");
    await expect(dialog).toContainText("50 钻石");
    await dialog.getByRole("button", { name: "确认扣费" }).click();
    await expect.poll(() => cardCodes(bobPanel)).toEqual([...bobCards]);
    expect((await wallet(table.first.page)).balance).toBe(balanceBefore.balance - 50);

    await table.first.page.reload();
    const purchasedPanel = table.first.page.locator("article").filter({ hasText: table.second.nickname });
    await expect.poll(() => cardCodes(purchasedPanel)).toEqual([...bobCards]);
    expect((await wallet(table.first.page)).balance).toBe(balanceBefore.balance - 50);

    await table.second.page.goto(`/hands/${handId}`);
    const alicePanelForBob = table.second.page.locator("article").filter({ hasText: table.first.nickname });
    await expect(alicePanelForBob.getByLabel("隐藏底牌")).toHaveCount(2);
    const bobViewHtml = await table.second.page.locator("body").innerHTML();
    for (const secret of aliceCards) expect(bobViewHtml).not.toContain(`data-card-code="${secret}"`);

    await table.second.page.goto(`/hands/${handId}/replay`);
    await expect(table.second.page.getByText("牌局结束后购买可见", { exact: false })).toHaveCount(0);
    const bobReplayHtml = await table.second.page.locator("body").innerHTML();
    for (const secret of aliceCards) expect(bobReplayHtml).not.toContain(`data-card-code="${secret}"`);

    await Promise.all([
      table.first.page.goto(`/rooms/${table.roomId}`),
      table.second.page.goto(`/rooms/${table.roomId}`),
    ]);
    await Promise.all([
      expect(table.first.page.getByLabel("网络状态：已连接")).toBeVisible({ timeout: 15_000 }),
      expect(table.second.page.getByLabel("网络状态：已连接")).toBeVisible({ timeout: 15_000 }),
    ]);
    await table.second.page.getByRole("button", { name: "打开牌桌菜单" }).click();
    await table.second.page.getByRole("button", { name: "站起围观" }).click();
    await expect(table.second.page.getByTestId("hero-hand")).toHaveCount(0);
    await table.first.page.getByRole("button", { name: "打开牌桌菜单" }).click();
    await table.first.page.getByRole("button", { name: "站起围观" }).click();
    await expect(table.first.page.getByTestId("hero-hand")).toHaveCount(0);

    await table.first.page.goto("/games");
    const gameLink = table.first.page.getByRole("link", { name: /history-双人桌/u });
    await expect(gameLink).toContainText("已结束");
    await gameLink.click();
    await expect(table.first.page.getByText("已结束对局")).toBeVisible();
    await expect(table.first.page.getByText("累计领取 2,000 · 离桌点数 2,020")).toBeVisible();

    await table.first.page.goto("/profile");
    await table.first.page.getByRole("textbox", { name: "昵称", exact: true }).fill("爱丽丝 E2E");
    await table.first.page.getByRole("button", { name: "保存昵称" }).click();
    await expect(table.first.page.getByRole("heading", { name: "爱丽丝 E2E" })).toBeVisible();
    await expect(table.first.page.getByLabel("昵称首字符头像")).toHaveText("爱");
    await expect(table.first.page.getByTestId("profile-user-id")).not.toBeEmpty();
    await expect(table.first.page.getByTestId("profile-wallet")).toHaveText((balanceBefore.balance - 50).toLocaleString());
    await expect(table.first.page.getByTestId("profile-profitable-hands")).toHaveText("1");
    await expect(table.first.page.getByTestId("profile-total-buy-in")).toHaveText("2,000");
    await expect(table.first.page.getByTestId("profile-total-cash-out")).toHaveText("2,020");
    await expect(table.first.page.getByRole("heading", { name: "最近对局" })).toBeVisible();

    await table.first.page.goto("/wallet");
    await expect(table.first.page.getByRole("cell", { name: "旧版点数转入", exact: true })).toHaveCount(0);
    await expect(table.first.page.getByRole("cell", { name: "旧版点数转出", exact: true })).toHaveCount(0);
    await expect(table.first.page.getByRole("cell", { name: "每手开局", exact: true })).toBeVisible();
    await expect(table.first.page.getByRole("cell", { name: "偷偷看", exact: true })).toBeVisible();

    await withTestDatabase(async (database) => {
      const alice = await database.user.findFirstOrThrow({ where: { phoneNumber: table.first.phoneNumber } });
      const reveal = await database.paidHandRevealPurchase.findFirstOrThrow({ where: { buyerUserId: alice.id, handId } });
      expect(reveal.cost).toBe(50);
      expect(await database.walletLedgerEntry.count({ where: { relatedHandId: handId, type: "PAID_CARD_REVEAL" } })).toBe(1);
      expect(await database.walletLedgerEntry.count({ where: { relatedRoomId: table.roomId, type: { in: ["BUY_IN", "CASH_OUT"] } } })).toBe(0);
      expect(await database.gameSession.count({ where: { roomId: table.roomId, status: "CLOSED" } })).toBe(2);
    });
  } finally {
    await closeTable(table);
  }
});
