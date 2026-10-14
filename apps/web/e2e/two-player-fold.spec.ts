import { expect, test } from "@playwright/test";

import { closeTable, setupTwoPlayerTable, wallet, withTestDatabase } from "./helpers.js";

test("two browsers complete a fold-to-win hand with only the explicit hand-entry diamond fee", async ({ browser }) => {
  const table = await setupTwoPlayerTable(browser, "fold");
  try {
    const balancesBefore = await Promise.all([wallet(table.first.page), wallet(table.second.page)]);
    expect(balancesBefore.map((item) => item.balance)).toEqual([9_990, 9_990]);

    const foldButtons = [table.first.page, table.second.page].map((page) => page.getByRole("button", { name: /弃牌$/u }));
    const actorIndex = await foldButtons[0]!.isVisible() ? 0 : 1;
    await foldButtons[actorIndex]!.click();
    await Promise.all([
      expect(table.first.page.getByTestId("post-hand-review")).toBeVisible(),
      expect(table.second.page.getByTestId("post-hand-review")).toBeVisible(),
    ]);

    const stacks = await table.first.page.locator("[data-seat-stack]").evaluateAll((seats) => seats.map((seat) => Number(seat.getAttribute("data-seat-stack"))));
    expect(stacks.reduce((sum, stack) => sum + stack, 0)).toBe(4_000);
    const balancesAfter = await Promise.all([wallet(table.first.page), wallet(table.second.page)]);
    expect(balancesAfter.map((item) => item.balance)).toEqual([9_990, 9_990]);

    await withTestDatabase(async (database) => {
      const hand = await database.handRecord.findFirstOrThrow({
        include: { players: true, pots: true, tableStackEntries: true },
        where: { roomId: table.roomId },
      });
      expect(hand.finishReason).toBe("FOLD_TO_WIN");
      expect(hand.players).toHaveLength(2);
      expect(hand.pots).toHaveLength(1);
      expect(hand.tableStackEntries.reduce((sum, entry) => sum + entry.signedAmount, 0)).toBe(0);
    });
  } finally {
    await closeTable(table);
  }
});
