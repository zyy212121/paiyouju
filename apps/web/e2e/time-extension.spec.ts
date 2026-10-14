import { expect, test, type Page } from "@playwright/test";

import { closeTable, setupTwoPlayerTable, wallet, withTestDatabase } from "./helpers.js";

async function actingPage(pages: readonly Page[]): Promise<Page> {
  await expect.poll(async () => {
    for (const page of pages) if (await page.getByRole("button", { name: /弃牌$/u }).isVisible()) return true;
    return false;
  }).toBe(true);
  return (await Promise.all(pages.map(async (page) => ({ page, visible: await page.getByRole("button", { name: /弃牌$/u }).isVisible() })))).find((item) => item.visible)!.page;
}

test("the final-three-second control buys one auditable extension without confirmation", async ({ browser }) => {
  test.setTimeout(45_000);
  const table = await setupTwoPlayerTable(browser, "extension");
  try {
    const actor = await actingPage([table.first.page, table.second.page]);
    const handId = (await actor.getByTestId("hand-id").innerText()).trim();
    const originalDeadline = Date.parse(await actor.getByTestId("deadline").getAttribute("data-deadline") ?? "");
    const balanceBefore = (await wallet(actor)).balance;

    await expect(actor.getByTestId("turn-urgency-overlay")).toBeVisible({ timeout: 15_000 });
    await actor.getByRole("button", { name: "加时" }).click();
    await expect.poll(async () => Date.parse(await actor.getByTestId("deadline").getAttribute("data-deadline") ?? ""))
      .toBeGreaterThan(originalDeadline + 7_000);
    await expect(actor.getByTestId("turn-urgency-overlay")).toHaveCount(0);
    expect((await wallet(actor)).balance).toBe(balanceBefore - 10);

    await actor.getByRole("button", { name: /弃牌$/u }).click();
    await expect(actor.getByTestId("post-hand-review")).toBeVisible();
    await withTestDatabase(async (database) => {
      const entries = await database.walletLedgerEntry.findMany({ where: { relatedHandId: handId, type: "ACTION_TIME_EXTENSION" } });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ signedAmount: -10 });
    });
  } finally {
    await closeTable(table);
  }
});
