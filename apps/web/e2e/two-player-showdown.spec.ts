import { expect, test } from "@playwright/test";

import { cardCodes, closeTable, playToShowdown, setupTwoPlayerTable, withTestDatabase } from "./helpers.js";

test("two browsers check and call through a deterministic showdown", async ({ browser }) => {
  const table = await setupTwoPlayerTable(browser, "showdown");
  try {
    const handId = (await table.first.page.getByTestId("hand-id").innerText()).trim();
    await playToShowdown([table.first.page, table.second.page]);

    await expect.poll(() => cardCodes(table.first.page.getByTestId("board"))).toEqual(["2c", "7d", "9h", "2d", "Kh"]);
    const publicCards = await table.first.page.locator("[data-seat-index] [data-card-code]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-card-code")));
    expect(publicCards.sort()).toEqual(["Ac", "Kc", "Kd", "Qc"]);
    const stacks = await table.first.page.locator("[data-seat-stack]").evaluateAll((seats) => seats.map((seat) => Number(seat.getAttribute("data-seat-stack"))));
    expect(stacks.sort((left, right) => left - right)).toEqual([1_980, 2_020]);

    await withTestDatabase(async (database) => {
      const hand = await database.handRecord.findFirstOrThrow({
        include: { players: true, pots: true },
        where: { roomId: table.roomId },
      });
      expect(hand).toMatchObject({ board: ["2c", "7d", "9h", "2d", "Kh"], finishReason: "SHOWDOWN" });
      expect(hand.players.every((player) => player.holeCardsPublic)).toBe(true);
      expect(hand.pots).toHaveLength(1);
      const pocketKingsWinner = hand.players.find((player) => player.holeCards.includes("Kc") && player.holeCards.includes("Kd"));
      expect(pocketKingsWinner).toBeDefined();
      expect(hand.pots[0]?.winners).toEqual([pocketKingsWinner?.userId]);
      expect(hand.players.map((player) => player.endingStack).sort((left, right) => left - right)).toEqual([1_980, 2_020]);
    });

    await table.first.page.goto(`/hands/${handId}/replay`);
    await expect(table.first.page.getByText(/^步骤 0 \/ /u)).toBeVisible();
    await table.first.page.getByRole("button", { name: "下一步" }).click();
    await expect(table.first.page.getByText(/^步骤 1 \/ /u)).toBeVisible();
    await table.first.page.getByRole("button", { name: "上一步" }).click();
    await expect(table.first.page.getByText(/^步骤 0 \/ /u)).toBeVisible();
    for (let step = 0; step < 16 && await table.first.page.getByTestId("replay-board").locator("[data-card-code]").count() < 3; step += 1) {
      await table.first.page.getByRole("button", { name: "下一步" }).click();
    }
    await expect.poll(() => cardCodes(table.first.page.getByTestId("replay-board"))).toEqual(["2c", "7d", "9h"]);
    const slider = table.first.page.getByLabel("回放步骤");
    await slider.fill(await slider.getAttribute("max") ?? "0");
    await expect.poll(() => cardCodes(table.first.page.getByTestId("replay-board"))).toEqual(["2c", "7d", "9h", "2d", "Kh"]);
    await expect(table.first.page.getByText("底池 0 · SHOWDOWN")).toBeVisible();
    await expect(table.first.page.getByText("座位 1 · 筹码 1,980")).toBeVisible();
    await expect(table.first.page.getByText("座位 2 · 筹码 2,020")).toBeVisible();
    await table.first.page.getByRole("button", { name: "回到开始" }).click();
    await expect(table.first.page.getByTestId("replay-board").locator("[data-card-code]")).toHaveCount(0);
  } finally {
    await closeTable(table);
  }
});
