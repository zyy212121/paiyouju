import { expect, test } from "@playwright/test";

import { closeTable, playToFlop, playToShowdown, setupTwoPlayerTable, tableSnapshot } from "./helpers.js";

test("refresh on the flop restores the same authoritative hand and deadline", async ({ browser }) => {
  const table = await setupTwoPlayerTable(browser, "refresh");
  try {
    const pages = [table.first.page, table.second.page] as const;
    await playToFlop(pages);
    const actor = await pages[0].getByRole("button", { name: "过牌", exact: true }).isVisible() ? pages[0] : pages[1];
    const before = await tableSnapshot(actor);
    expect(before.board).toEqual(["2c", "7d", "9h"]);
    expect(before.deadline).not.toBe("");

    await actor.reload();
    await expect(actor.getByLabel("网络状态：已连接")).toBeVisible({ timeout: 15_000 });
    await expect(actor.getByTestId("hand-id")).toHaveText(before.handId);
    const after = await tableSnapshot(actor);
    expect(after.board).toEqual(before.board);
    expect(after.ownCards).toEqual(before.ownCards);
    expect(after.potText).toBe(before.potText);
    expect(after.stacks).toEqual(before.stacks);
    expect(after.deadline).toBe(before.deadline);
    expect(after.version).toBeGreaterThanOrEqual(before.version);

    await playToShowdown(pages);
    await expect(actor.getByTestId("post-hand-review")).toBeVisible();
  } finally {
    await closeTable(table);
  }
});
