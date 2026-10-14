import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  cardCodes,
  closeTable,
  createRoom,
  E2E_BASE_URL,
  E2E_PASSWORD,
  e2eEnvironmentValue,
  enterTable,
  joinRoom,
  playToFlop,
  registerUser,
  setupTwoPlayerTable,
  submitPassiveAction,
  takeSeat,
  waitForHand,
  wallet,
  withTestDatabase,
} from "./helpers.js";

const pagesOf = (table: Awaited<ReturnType<typeof setupTwoPlayerTable>>) => [table.first.page, table.second.page] as const;

async function actingAndWaiting(pages: readonly Page[]): Promise<{ readonly acting: Page; readonly waiting: Page }> {
  for (const acting of pages) {
    if (await acting.getByTestId("action-panel").count() > 0) return { acting, waiting: pages.find((page) => page !== acting)! };
  }
  throw new Error("no acting player was projected");
}

async function playUntilBoard(pages: readonly Page[], count: number): Promise<void> {
  for (let action = 0; action < 6; action += 1) {
    if (await pages[0]!.getByTestId("board").locator("[data-card-code]").count() >= count) return;
    await submitPassiveAction(pages);
  }
  throw new Error(`board did not reach ${count} cards`);
}

async function shoveAndCall(table: Awaited<ReturnType<typeof setupTwoPlayerTable>>): Promise<Page> {
  const pages = pagesOf(table);
  const { acting } = await actingAndWaiting(pages);
  await acting.getByRole("button", { name: /^All-in，加注至/u }).click();
  const caller = pages.find((page) => page !== acting)!;
  await expect(caller.getByRole("button", { name: /^跟注/u })).toBeVisible();
  await caller.getByRole("button", { name: /^跟注/u }).click();
  await expect(pages[0].getByTestId("post-hand-review")).toBeVisible();
  await Promise.all(pages.map((page) => expect(page.getByTestId("post-hand-review")).toHaveCount(0, { timeout: 10_000 })));
  for (const page of pages) {
    if (await page.getByTestId("hero-hand").getAttribute("data-seat-stack") === null) return page;
  }
  throw new Error("expected the zero-stack player to stand automatically");
}

async function setupThreePlayerTable(browser: Browser, prefix: string) {
  const first = await registerUser(browser, `${prefix}a`);
  const roomName = `${prefix}-三人桌`;
  const room = await createRoom(first.page, roomName, 3);
  await takeSeat(first.page, 0);
  await enterTable(first.page, room.roomId);
  const second = await registerUser(browser, `${prefix}b`);
  await joinRoom(second.page, room.roomCode, roomName);
  await takeSeat(second.page, 1);
  await enterTable(second.page, room.roomId);
  const third = await registerUser(browser, `${prefix}c`);
  await joinRoom(third.page, room.roomCode, roomName);
  await takeSeat(third.page, 2);
  await enterTable(third.page, room.roomId);
  await expect(first.page.getByRole("button", { name: "开始游戏" })).toBeVisible();
  await first.page.getByRole("button", { name: "开始游戏" }).click();
  await Promise.all([first.page, second.page, third.page].map(waitForHand));
  return { first, roomId: room.roomId, second, third };
}

test("E3 one-shot autopilot checks once, folds to a bet, and never adds chips", async ({ browser }) => {
  const checking = await setupTwoPlayerTable(browser, "autocheck");
  try {
    const pages = pagesOf(checking);
    const { acting, waiting } = await actingAndWaiting(pages);
    await waiting.getByRole("button", { name: "让或弃" }).click();
    await expect(waiting.getByRole("button", { name: "让或弃" })).toHaveAttribute("aria-pressed", "true");
    await acting.getByRole("button", { name: /^跟注/u }).click();
    await expect(waiting.getByRole("button", { name: "过牌", exact: true })).toBeVisible();
    await expect(waiting.getByTestId("board").locator("[data-card-code]")).toHaveCount(3);
    const version = await waiting.locator("[data-state-version]").getAttribute("data-state-version");
    await waiting.waitForTimeout(500);
    await expect(waiting.locator("[data-state-version]")).toHaveAttribute("data-state-version", version!);
    await waiting.getByRole("button", { name: /弃牌$/u }).click();
    await expect(waiting.getByTestId("post-hand-review")).toBeVisible();
    await withTestDatabase(async (database) => {
      const automatic = await database.handActionRecord.findMany({ where: { automaticReason: "NEXT_DECISION_AUTOPILOT", hand: { roomId: checking.roomId } } });
      expect(automatic).toHaveLength(1);
      expect(automatic[0]).toMatchObject({ actionType: "CHECK", amount: null, automatic: true });
    });
  } finally { await closeTable(checking); }

  const folding = await setupTwoPlayerTable(browser, "autofold");
  try {
    const pages = pagesOf(folding);
    const { acting, waiting } = await actingAndWaiting(pages);
    await waiting.getByRole("button", { name: "让或弃" }).click();
    await acting.getByRole("button", { name: /^All-in，加注至/u }).click();
    await expect(waiting.getByTestId("post-hand-review")).toBeVisible();
    await withTestDatabase(async (database) => {
      const automatic = await database.handActionRecord.findMany({ where: { automaticReason: "NEXT_DECISION_AUTOPILOT", hand: { roomId: folding.roomId } } });
      expect(automatic).toHaveLength(1);
      expect(automatic[0]).toMatchObject({ actionType: "FOLD", amount: null, automatic: true });
    });
  } finally { await closeTable(folding); }
});

test("E3b auto-call is cancelled when another player changes the maximum bet", async ({ browser }) => {
  const table = await setupThreePlayerTable(browser, "autocall");
  const users = [table.first, table.second, table.third] as const;
  const pages = users.map((user) => user.page);
  try {
    let acting: Page | null = null;
    let autoCaller: Page | null = null;
    for (const page of pages) {
      if (await page.getByTestId("action-panel").isVisible()) acting = page;
      else if (await page.getByRole("button", { name: /^自动跟注 /u }).isVisible()) autoCaller = page;
    }
    if (!acting || !autoCaller) throw new Error("expected one actor and one waiting caller");
    await autoCaller.getByRole("button", { name: /^自动跟注 /u }).click();
    await expect(autoCaller.getByRole("button", { name: /^自动跟注 /u })).toHaveAttribute("aria-pressed", "true");

    await acting.getByRole("button", { name: /^1\/2 Pot，加注至/u }).click();

    await expect(autoCaller.getByTestId("action-panel")).toBeVisible();
    await expect(autoCaller.getByRole("button", { name: /^跟注/u })).toBeVisible();
    await withTestDatabase(async (database) => {
      const seats = await database.tableSeat.findMany({ where: { roomId: table.roomId } });
      expect(seats.every((seat) => seat.nextActionAutoCallCurrentBet === null && !seat.nextActionAutopilotArmed)).toBe(true);
    });
  } finally { await Promise.allSettled(users.map((user) => user.context.close())); }
});

test("E4 reserved-away retains the seat, returns in time, then closes the session without a Wallet cash-out", async ({ browser }) => {
  test.setTimeout(100_000);
  const table = await setupTwoPlayerTable(browser, "reserved");
  try {
    const page = table.second.page;
    await page.getByRole("button", { name: "打开牌桌菜单" }).click();
    await page.getByRole("button", { name: /保位离桌 · 60 秒/u }).click();
    await expect(page.getByText(/保位剩余/u)).toBeVisible();
    await page.getByRole("button", { name: "打开牌桌菜单" }).click();
    await page.getByRole("button", { name: /回到牌桌/u }).click();
    await expect(page.getByText(/保位剩余/u)).toHaveCount(0);

    await page.getByRole("button", { name: "打开牌桌菜单" }).click();
    await page.getByRole("button", { name: /保位离桌 · 60 秒/u }).click();
    await expect(page.getByText(/保位剩余/u)).toBeVisible();
    await expect(page.getByTestId("hero-hand")).toHaveCount(0, { timeout: 70_000 });
    await withTestDatabase(async (database) => {
      expect(await database.tableSeat.count({ where: { roomId: table.roomId, user: { phoneNumber: table.second.phoneNumber } } })).toBe(0);
      const user = await database.user.findUniqueOrThrow({ where: { phoneNumber: table.second.phoneNumber } });
      expect(await database.walletLedgerEntry.count({ where: { relatedRoomId: table.roomId, type: "CASH_OUT", userId: user.id } })).toBe(0);
    });
  } finally { await closeTable(table); }
});

test("E5 quick sizes commit immediately while the slider supports min/max and an exact value", async ({ browser }) => {
  const table = await setupTwoPlayerTable(browser, "raise");
  try {
    const { acting, waiting } = await actingAndWaiting(pagesOf(table));
    await acting.getByRole("button", { name: /^1\/2 Pot，加注至/u }).click();
    await expect(waiting.getByRole("button", { name: /^加注至 /u })).toBeVisible();
    await waiting.getByRole("button", { name: /^加注至 /u }).click();
    const slider = waiting.getByRole("slider", { name: "竖向加注滑杆" });
    await expect(slider).toHaveAttribute("min", "60");
    await expect(slider).toHaveAttribute("max", "2000");
    await waiting.getByRole("button", { name: "最大 / All-in" }).click();
    await waiting.getByRole("button", { name: "最小" }).click();
    await slider.fill("80");
    await waiting.getByRole("button", { name: "确认加注至 80" }).click();
    await acting.getByRole("button", { name: /弃牌$/u }).click();
    await expect(acting.getByTestId("post-hand-review")).toBeVisible();
    await withTestDatabase(async (database) => {
      const actions = await database.handActionRecord.findMany({ orderBy: { sequence: "asc" }, where: { actionType: "RAISE_TO", hand: { roomId: table.roomId } } });
      expect(actions).toHaveLength(2);
      expect(actions[0]).toMatchObject({ raiseTo: 40 });
      expect(actions[1]).toMatchObject({ amount: 60, raiseTo: 80 });
    });
  } finally { await closeTable(table); }
});

test("E6/E7 deals two rounds, animates each street, restores quietly, and projects only Hero strength", async ({ browser }) => {
  const table = await setupTwoPlayerTable(browser, "animation");
  try {
    const pages = pagesOf(table);
    const hero = (await table.first.page.getByTestId("hand-strength").innerText()) === "一对 K" ? table.first.page : table.second.page;
    await expect(hero.getByTestId("card-animation-layer")).toHaveAttribute("data-animation-kind", "deal");
    await expect(hero.getByTestId("card-animation-layer").locator(".flying-card-back")).toHaveCount(4);
    await expect(hero.getByTestId("own-cards").locator("[data-card-code]")).toHaveCount(2);
    await expect(hero.getByLabel("对手底牌未公开")).toBeVisible();
    await expect(hero.getByTestId("hand-strength")).toHaveText("一对 K");

    await hero.reload();
    await waitForHand(hero);
    await expect(hero.getByTestId("card-animation-layer")).toHaveCount(0);

    await playToFlop(pages);
    await expect(hero.getByTestId("board").locator("[data-card-code]")).toHaveCount(3);
    await expect(hero.getByTestId("board").getByTestId("board-card")).toHaveCount(3);
    await expect(hero.getByTestId("board").getByTestId("board-card").first()).toHaveAttribute("data-face-up", "true");
    await expect(hero.getByTestId("hand-strength")).toHaveText("一对");
    await playUntilBoard(pages, 4);
    await expect(hero.getByTestId("hand-strength")).toHaveText("两对");
    await expect(hero.getByTestId("board").getByTestId("board-card")).toHaveCount(4);
    await playUntilBoard(pages, 5);
    await expect(hero.getByTestId("hand-strength")).toHaveText("葫芦");
    await expect(hero.getByTestId("seat-ring")).not.toContainText("葫芦");
  } finally { await closeTable(table); }
});

test("E8 pending show toggles during play, locks in review, and publishes each selected card without a charge", async ({ browser }) => {
  const table = await setupTwoPlayerTable(browser, "review");
  try {
    const pages = pagesOf(table);
    const { acting } = await actingAndWaiting(pages);
    const loserCards = await cardCodes(acting.getByTestId("own-cards"));
    const observer = pages.find((page) => page !== acting)!;
    const balances = await Promise.all(pages.map(wallet));
    await acting.getByRole("button", { name: "将第 1 张底牌设为待亮" }).click();
    await expect(acting.getByLabel("第 1 张底牌待亮标记")).toBeVisible();
    await acting.getByRole("button", { name: "取消第 1 张底牌待亮" }).click();
    await expect(acting.getByLabel("第 1 张底牌待亮标记")).toHaveCount(0);
    await acting.getByRole("button", { name: "将第 1 张底牌设为待亮" }).click();
    await acting.getByRole("button", { name: "将第 2 张底牌设为待亮" }).click();
    await acting.getByRole("button", { name: /弃牌$/u }).click();
    await expect(acting.getByTestId("post-hand-review")).toBeVisible();
    await expect(observer.getByTestId("post-hand-review")).toBeVisible();
    const deadlineBefore = await withTestDatabase(async (database) => (await database.handRecord.findFirstOrThrow({ where: { roomId: table.roomId } })).reviewEndsAt);
    await expect(acting.getByRole("button", { name: /待亮/u })).toHaveCount(0);
    await expect(observer.getByLabel("第 1 张主动公开底牌")).toBeVisible();
    await expect(observer.locator(`[data-card-code="${loserCards[0]}"]`)).toBeVisible();
    await expect(observer.getByLabel("第 2 张主动公开底牌")).toBeVisible();
    for (const card of loserCards) await expect(observer.locator(`[data-card-code="${card}"]`)).toBeVisible();
    await withTestDatabase(async (database) => {
      const hand = await database.handRecord.findFirstOrThrow({ where: { roomId: table.roomId } });
      const player = await database.handPlayerRecord.findFirstOrThrow({ where: { handId: hand.id, holeCardsPublicReason: "VOLUNTARY" } });
      expect(player.voluntarilyRevealedAt).not.toBeNull();
      expect(player.voluntarilyRevealedCardIndices).toEqual([0, 1]);
      expect(hand.reviewEndsAt).toEqual(deadlineBefore);
      expect(await database.walletLedgerEntry.count({ where: { relatedHandId: hand.id, type: "PAID_CARD_REVEAL" } })).toBe(0);
    });
    expect((await Promise.all(pages.map(wallet))).map((item) => item.balance)).toEqual(balances.map((item) => item.balance));
  } finally { await closeTable(table); }
});

test("E9/E10 one reveal purchase covers the hand while each participant buys the same unique runout", async ({ browser }) => {
  const table = await setupThreePlayerTable(browser, "wholehand");
  const users = [table.first, table.second, table.third] as const;
  try {
    const pages = users.map((user) => user.page);
    const dealtCards = (await Promise.all(pages.map((page) => cardCodes(page.getByTestId("own-cards"))))).flat();
    await table.first.page.getByRole("button", { name: /^跟注/u }).click();
    await table.second.page.getByRole("button", { name: /弃牌$/u }).click();
    await table.third.page.getByRole("button", { name: /弃牌$/u }).click();
    const handId = (await table.first.page.getByTestId("hand-id").innerText()).trim();
    await expect(table.first.page.getByTestId("post-hand-review")).toBeVisible();
    await expect(table.first.page.getByTestId("post-hand-review")).toHaveCount(0, { timeout: 10_000 });
    await table.first.page.goto(`/hands/${handId}`);
    await expect(table.first.page.getByRole("button", { name: "偷偷看 50钻石" })).toBeVisible({ timeout: 10_000 });
    const beforeWallet = await wallet(table.first.page);
    await table.first.page.getByRole("button", { name: "偷偷看 50钻石" }).click();
    await table.first.page.getByRole("dialog", { name: "确认查看整手隐藏牌" }).getByRole("button", { name: "确认扣费" }).click();
    await expect(table.first.page.locator("article [data-card-code]")).toHaveCount(6);
    expect((await wallet(table.first.page)).balance).toBe(beforeWallet.balance - 50);
    await table.second.page.goto(`/hands/${handId}`);
    await expect(table.second.page.locator("article [data-card-code]")).toHaveCount(2);

    const ownerResponse = await table.first.page.context().request.get(`/api/hands/${handId}`);
    const originalData = (await ownerResponse.json() as { readonly data: { readonly ownResult: number; readonly settlement: unknown } }).data;
    const original = { ownResult: originalData.ownResult, settlement: originalData.settlement };
    const beforeRunoutWallet = await wallet(table.first.page);
    await table.first.page.getByRole("button", { name: "发发看", exact: true }).click();
    await expect(table.first.page.getByLabel("发发看公共牌").locator("[data-card-code]")).toHaveCount(5);
    const simulated = await cardCodes(table.first.page.getByLabel("发发看公共牌"));
    expect(simulated).toHaveLength(5);
    expect(simulated.filter((card) => dealtCards.includes(card))).toEqual([]);
    const afterRunoutWallet = await wallet(table.first.page);
    await table.first.page.reload();
    await expect(table.first.page.getByRole("button", { name: "发发看", exact: true })).toHaveCount(0);
    await expect.poll(() => cardCodes(table.first.page.getByLabel("发发看公共牌"))).toEqual(simulated);
    await table.second.page.reload();
    await expect(table.second.page.getByLabel("发发看公共牌")).toHaveCount(0);
    const secondBeforeRunout = await wallet(table.second.page);
    await table.second.page.getByRole("button", { name: "发发看", exact: true }).click();
    await expect.poll(() => cardCodes(table.second.page.getByLabel("发发看公共牌"))).toEqual(simulated);
    expect((await wallet(table.second.page)).balance).toBe(secondBeforeRunout.balance - 10);
    await table.second.page.reload();
    await expect.poll(() => cardCodes(table.second.page.getByLabel("发发看公共牌"))).toEqual(simulated);
    expect(afterRunoutWallet.balance).toBe(beforeRunoutWallet.balance - 10);
    expect((await wallet(table.first.page)).balance).toBe(afterRunoutWallet.balance);
    const afterResponse = await table.first.page.context().request.get(`/api/hands/${handId}`);
    const afterData = (await afterResponse.json() as { readonly data: { readonly ownResult: number; readonly settlement: unknown } }).data;
    const after = { ownResult: afterData.ownResult, settlement: afterData.settlement };
    expect(after).toEqual(original);
    await withTestDatabase(async (database) => {
      expect(await database.paidHandRevealPurchase.count({ where: { handId } })).toBe(1);
      expect(await database.handHypotheticalRunout.count({ where: { handId } })).toBe(1);
      expect(await database.hypotheticalRunoutPurchase.count({ where: { handId } })).toBe(2);
    });
  } finally { await Promise.allSettled(users.map((user) => user.context.close())); }
});

test("E11 a zero stack stands automatically and can re-sit for 100BB without a prompt or lost points", async ({ browser }) => {
  const table = await setupTwoPlayerTable(browser, "zero-stack");
  try {
    const busted = await shoveAndCall(table);
    const phone = busted === table.first.page ? table.first.phoneNumber : table.second.phoneNumber;
    await expect(busted.getByRole("dialog", { name: "筹码已用完" })).toHaveCount(0);
    await expect(busted.getByTestId("hero-hand")).toHaveCount(0);
    await withTestDatabase(async (database) => {
      const user = await database.user.findUniqueOrThrow({ where: { phoneNumber: phone } });
      expect(await database.tableSeat.count({ where: { roomId: table.roomId, userId: user.id } })).toBe(0);
      expect(await database.walletLedgerEntry.count({ where: { relatedRoomId: table.roomId, type: "CASH_OUT", userId: user.id } })).toBe(0);
    });
    await busted.getByRole("button", { name: /^选择座位 /u }).click();
    await expect(busted.getByRole("dialog", { name: /带入|补充筹码/u })).toHaveCount(0);
    await expect(busted.getByTestId("hero-hand")).toHaveAttribute("data-seat-stack", "2000");
    expect((await wallet(busted)).balance).toBe(9_990);
  } finally { await closeTable(table); }
});

test("E12 closed room moves to the closed list, archives softly, and retains hand history", async ({ browser }) => {
  const table = await setupTwoPlayerTable(browser, "archive");
  try {
    table.first.page.once("dialog", (dialog) => dialog.accept());
    await table.first.page.getByRole("button", { name: "打开牌桌菜单" }).click();
    await table.first.page.getByRole("button", { name: /房主：安全关闭房间/u }).click();
    const { acting } = await actingAndWaiting(pagesOf(table));
    await acting.getByRole("button", { name: /弃牌$/u }).click();
    await expect(table.first.page.getByTestId("post-hand-review")).toBeVisible();
    await expect(table.first.page.getByTestId("post-hand-review")).toHaveCount(0, { timeout: 10_000 });
    await table.first.page.goto("/");
    const closedList = table.first.page.getByTestId("closed-room-list");
    await expect(closedList.getByText("archive-双人桌")).toBeVisible({ timeout: 10_000 });
    await expect(table.first.page.getByRole("heading", { name: "进行中的房间" }).locator(".." )).not.toContainText("archive-双人桌");
    table.first.page.once("dialog", (dialog) => dialog.accept());
    await closedList.getByRole("button", { name: "从列表移除" }).click();
    await expect(closedList.getByText("archive-双人桌")).toHaveCount(0);
    await table.first.page.goto("/hands");
    await expect(table.first.page.getByRole("link", { name: /archive-双人桌/u })).toBeVisible();
    await withTestDatabase(async (database) => {
      const room = await database.room.findUniqueOrThrow({ where: { id: table.roomId } });
      expect(room.archivedAt).not.toBeNull();
      expect(await database.handRecord.count({ where: { roomId: table.roomId } })).toBe(1);
    });
  } finally { await closeTable(table); }
});

test("E13 phone register/login rejects duplicates, masks profile, and never exposes the number to an opponent", async ({ browser }) => {
  const owner = await registerUser(browser, "phoneowner");
  const duplicateContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const duplicate = await duplicateContext.newPage();
  try {
    await owner.page.goto("/profile");
    const expectedMask = `${owner.phoneNumber.slice(0, 3)}****${owner.phoneNumber.slice(-4)}`;
    await expect(owner.page.getByText(expectedMask)).toBeVisible();
    expect(await owner.page.locator("body").innerText()).not.toContain(owner.phoneNumber);

    await duplicate.goto("/register");
    await duplicate.getByLabel("手机号").fill(owner.phoneNumber);
    await duplicate.getByLabel("昵称").fill("重复号码");
    await duplicate.getByLabel("密码", { exact: true }).fill(E2E_PASSWORD);
    await duplicate.getByRole("button", { name: "注册并登录" }).click();
    await expect(duplicate.getByRole("alert")).toBeVisible();

    await owner.page.getByRole("button", { name: "退出登录" }).click();
    await owner.page.getByLabel("手机号").fill(owner.phoneNumber);
    await owner.page.getByLabel("密码", { exact: true }).fill(E2E_PASSWORD);
    await owner.page.getByRole("button", { exact: true, name: "登录" }).click();
    await expect(owner.page.getByRole("heading", { name: "你的私人牌局" })).toBeVisible();

    const room = await createRoom(owner.page, "手机号隐私", 2);
    const opponent = await registerUser(browser, "phoneopponent");
    try {
      await joinRoom(opponent.page, room.roomCode, "手机号隐私");
      expect(await opponent.page.locator("body").innerText()).not.toContain(owner.phoneNumber);
      const browserStorage = await opponent.page.evaluate(async () => ({
        cacheNames: await caches.keys(),
        local: Object.values(localStorage),
        session: Object.values(sessionStorage),
      }));
      expect(JSON.stringify(browserStorage)).not.toContain(owner.phoneNumber);
    } finally { await opponent.context.close(); }
  } finally {
    await duplicateContext.close();
    await owner.context.close();
  }
});

test("E13 legacy Seed account binds once and logs back in with the same durable account", async ({ browser }) => {
  const phoneNumber = "18800009991";
  const before = await withTestDatabase(async (database) => {
    const alice = await database.user.findUniqueOrThrow({ include: { wallet: true }, where: { usernameNormalized: "alice" } });
    await database.user.update({ data: { phoneNumber: null }, where: { id: alice.id } });
    return { balance: alice.wallet!.balance, id: alice.id };
  });
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  try {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "使用旧账号登录" })).toHaveCount(0);
    const legacyLogin = await context.request.post("/api/auth/login", {
      data: { identifier: "alice", password: e2eEnvironmentValue("DEV_SEED_PASSWORD") },
      headers: { origin: E2E_BASE_URL, "x-wepoker-request": "1" },
    });
    expect(legacyLogin.status(), await legacyLogin.text()).toBe(200);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "你的私人牌局" })).toBeVisible();
    await page.goto("/profile");
    await page.getByRole("textbox", { name: "手机号" }).fill(phoneNumber);
    await page.getByLabel("当前密码").fill(e2eEnvironmentValue("DEV_SEED_PASSWORD"));
    await page.getByRole("button", { name: "绑定手机号" }).click();
    await expect(page.getByText("已绑定 188****9991")).toBeVisible();
    await page.getByRole("button", { name: "退出登录" }).click();
    await page.getByLabel("手机号").fill(phoneNumber);
    await page.getByLabel("密码", { exact: true }).fill(e2eEnvironmentValue("DEV_SEED_PASSWORD"));
    await page.getByRole("button", { exact: true, name: "登录" }).click();
    await expect(page.getByRole("heading", { name: "你的私人牌局" })).toBeVisible();
    await withTestDatabase(async (database) => {
      const alice = await database.user.findUniqueOrThrow({ include: { wallet: true }, where: { phoneNumber } });
      expect(alice.id).toBe(before.id);
      expect(alice.wallet?.balance).toBe(before.balance);
    });
  } finally { await context.close(); }
});
