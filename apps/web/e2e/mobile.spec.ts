import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { closeTable, E2E_BASE_URL, E2E_PASSWORD, enterTable, expectNoHorizontalOverflow, registerUser, setupTwoPlayerTable, withTestDatabase } from "./helpers.js";

async function loginAtViewport(
  browser: Browser,
  phoneNumber: string,
  viewport: { readonly height: number; readonly width: number },
): Promise<{ readonly context: BrowserContext; readonly page: Page }> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL, viewport });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("手机号").fill(phoneNumber);
  await page.getByLabel("密码", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { exact: true, name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "你的私人牌局" })).toBeVisible();
  return { context, page };
}

async function expectTouchTarget(page: Page, role: "button" | "link", name: string | RegExp): Promise<void> {
  const target = page.getByRole(role, { name }).filter({ visible: true }).first();
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await target.click({ trial: true });
}

async function expectViewportLocked(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    bodyHeight: document.body.scrollHeight,
    documentHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
  expect(metrics.documentHeight).toBeLessThanOrEqual(metrics.innerHeight);
  expect(metrics.bodyHeight).toBeLessThanOrEqual(metrics.innerHeight);
}

async function swipeDrawer(page: Page, label: string, direction: "left" | "right"): Promise<void> {
  const drawer = page.getByLabel(label);
  await drawer.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * (direction === "left" ? 0.8 : 0.2);
  const endX = box!.x + box!.width * (direction === "left" ? 0.1 : 0.9);
  const y = box!.y + Math.min(120, box!.height / 3);
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y + 4, { steps: 8 });
  await page.mouse.up();
}

async function createFullTable(page: Awaited<ReturnType<typeof registerUser>>["page"], phoneNumber: string, maxSeats: number) {
  const name = `移动${maxSeats}人满桌`;
  const response = await page.context().request.post(`${E2E_BASE_URL}/api/rooms`, {
    data: {
      actionTimeSeconds: 15,
      bigBlind: 20,
      durationMinutes: 60,
      maximumBuyIn: 2_000,
      maxSeats,
      minimumBuyIn: 400,
      name,
    },
    headers: { "idempotency-key": randomUUID(), origin: E2E_BASE_URL, "x-wepoker-request": "1" },
  });
  const body = await response.json() as { readonly data?: { readonly id: string }; readonly error?: { readonly message?: string } };
  expect(response.ok(), body.error?.message ?? JSON.stringify(body)).toBe(true);
  expect(body.data?.id).toBeTruthy();
  const roomId = body.data!.id;
  await withTestDatabase(async (database) => database.$transaction(async (transaction) => {
    const owner = await transaction.user.findUniqueOrThrow({ where: { phoneNumber } });
    const perPlayerBuyIn = Math.floor(2_000_000_000 / maxSeats);
    await transaction.room.update({ data: { maximumBuyIn: perPlayerBuyIn, minimumBuyIn: 20 }, where: { id: roomId } });
    for (let seatIndex = 0; seatIndex < maxSeats; seatIndex += 1) {
      const suffix = randomUUID().slice(0, 6);
      const botUsername = `layout_${maxSeats}_${seatIndex}_${suffix}`;
      const user = seatIndex === 0 ? owner : await transaction.user.create({
        data: {
          nickname: `超长昵称玩家${seatIndex}号测试`,
          passwordHash: "e2e-layout-only",
          username: botUsername,
          usernameNormalized: botUsername.toLowerCase(),
        },
      });
      if (seatIndex > 0) await transaction.roomMember.create({ data: { roomId, userId: user.id } });
      const game = await transaction.gameSession.create({ data: { roomId, seatIndex, totalBuyIn: perPlayerBuyIn, userId: user.id } });
      await transaction.tableSeat.create({ data: {
        gameSessionId: game.id,
        roomId,
        seatIndex,
        stack: seatIndex === 0 ? perPlayerBuyIn * maxSeats : 0,
        userId: user.id,
      } });
    }
  }));
  await page.goto(`/rooms/${roomId}`);
  await enterTable(page, roomId);
  return { name, roomId };
}

test("375x812 flow remains usable from auth through a live action", async ({ browser }) => {
  const table = await setupTwoPlayerTable(browser, "mobile", { height: 812, width: 375 });
  try {
    const page = table.first.page;
    await page.setViewportSize({ height: 812, width: 375 });
    await expectNoHorizontalOverflow(page);
    await expectViewportLocked(page);
    await expect(page.locator(".mobile-table-stage [class*='oval']")).toHaveCount(0);
    const heroBox = await page.getByTestId("hero-hand").boundingBox();
    const actionBox = await page.locator(".table-action-layer").boundingBox();
    expect(heroBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(heroBox!.y + 1);
    for (const name of ["打开牌桌菜单", "打开牌桌点数和钻石", "打开牌桌历史", "打开排名和聊天"] as const) await expectTouchTarget(page, "button", name);
    await page.getByRole("button", { name: "打开牌桌菜单" }).click();
    await expect(page.getByRole("region", { name: "牌桌菜单" })).toBeVisible();
    await page.getByRole("button", { name: "关闭菜单" }).click();
    const infoHandle = page.getByRole("button", { name: "打开排名和聊天" });
    const handleBeforeDrag = await infoHandle.boundingBox();
    expect(handleBeforeDrag).not.toBeNull();
    await page.mouse.move(handleBeforeDrag!.x + handleBeforeDrag!.width / 2, handleBeforeDrag!.y + handleBeforeDrag!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBeforeDrag!.x + handleBeforeDrag!.width / 2, handleBeforeDrag!.y + handleBeforeDrag!.height / 2 + 80, { steps: 8 });
    await page.mouse.up();
    const handleAfterDrag = await infoHandle.boundingBox();
    expect(handleAfterDrag).not.toBeNull();
    expect(handleAfterDrag!.y).toBeGreaterThan(handleBeforeDrag!.y + 50);
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("wepoker:table-info-handle:top"))).not.toBeNull();
    await expect(page.getByLabel("排名和聊天抽屉")).toHaveCount(0);
    await page.getByRole("button", { name: "打开牌桌历史" }).first().click();
    await expect(page.getByLabel("牌桌历史抽屉")).toBeVisible();
    await swipeDrawer(page, "牌桌历史抽屉", "right");
    await expect(page.getByLabel("牌桌历史抽屉")).toHaveCount(0);
    await page.getByRole("button", { name: "打开排名和聊天" }).click();
    await expect(page.getByLabel("排名和聊天抽屉")).toBeVisible();
    await expect(page.locator(".ranking-player")).toHaveCount(2);
    await expect(page.getByLabel("牌桌公共信息")).toContainText("4,000");
    await swipeDrawer(page, "排名和聊天抽屉", "left");
    await expect(page.getByLabel("排名和聊天抽屉")).toHaveCount(0);
    await page.getByRole("button", { name: "打开牌桌点数和钻石" }).click();
    await expect(page.getByRole("dialog", { name: "牌桌点数与钻石" })).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    const action = page.getByRole("button", { name: /^跟注/u });
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await action.click();
    await expectNoHorizontalOverflow(page);
    await expectViewportLocked(page);
    await page.goto("/profile");
    const logout = page.getByRole("button", { name: "退出登录" });
    await expect(logout).toBeVisible();
    const logoutBox = await logout.boundingBox();
    expect(logoutBox).not.toBeNull();
    expect(logoutBox!.height).toBeGreaterThanOrEqual(44);
  } finally {
    await closeTable(table);
  }
});

test("375/390/430 resource pages and controls remain mobile-safe", async ({ browser }) => {
  const table = await setupTwoPlayerTable(browser, "mobilematrix", { height: 812, width: 375 });
  const auxiliary: BrowserContext[] = [];
  try {
    const handId = (await table.first.page.getByTestId("hand-id").innerText()).trim();
    const pause = await table.first.page.context().request.post(`${E2E_BASE_URL}/api/rooms/${table.roomId}/pause`, {
      data: {},
      headers: { origin: E2E_BASE_URL, "x-wepoker-request": "1" },
    });
    expect(pause.ok()).toBe(true);

    const views = [{ height: 812, page: table.first.page, width: 375 }];
    for (const viewport of [{ height: 844, width: 390 }, { height: 932, width: 430 }] as const) {
      const loggedIn = await loginAtViewport(browser, table.first.phoneNumber, viewport);
      auxiliary.push(loggedIn.context);
      views.push({ ...viewport, page: loggedIn.page });
    }

    for (const view of views) {
      await view.page.goto("/");
      await expect(view.page.getByRole("heading", { name: "你的私人牌局" })).toBeVisible();
      await expectNoHorizontalOverflow(view.page);
      await expectTouchTarget(view.page, "link", "创建房间");

      await view.page.goto(`/rooms/${table.roomId}`);
      await expect(view.page).toHaveURL(`/tables/${table.roomId}`);
      await expect(view.page.getByTestId("table-top-bar")).toContainText("mobilematrix-双人桌");
      await expect(view.page.getByTestId("hand-id")).toHaveText(handId);
      await expectNoHorizontalOverflow(view.page);
      await expectTouchTarget(view.page, "button", /^跟注/u);
    }

    await table.first.page.getByRole("button", { name: /^跟注/u }).click();
    const foldButton = table.second.page.getByRole("button", { name: /弃牌$/u });
    await expect(foldButton).toBeEnabled();
    await foldButton.click();
    await Promise.all(views.map(({ page }) => expect(page.getByText("下一手已由房主暂停", { exact: true })).toBeVisible({ timeout: 10_000 })));

    for (const view of views) {
      await view.page.goto("/hands");
      await expect(view.page.getByRole("heading", { name: "我的手牌" })).toBeVisible();
      await expectNoHorizontalOverflow(view.page);
      const handLink = view.page.getByRole("link", { name: /mobilematrix-双人桌/u }).first();
      await handLink.scrollIntoViewIfNeeded();
      await handLink.click();

      await expect(view.page).toHaveURL(`/hands/${handId}`);
      await expect(view.page.getByRole("heading", { name: /第 1 手/u })).toBeVisible();
      await expectNoHorizontalOverflow(view.page);
      await expectTouchTarget(view.page, "link", "回放");
      await view.page.getByRole("link", { name: "回放" }).click();

      await expect(view.page).toHaveURL(`/hands/${handId}/replay`);
      await expect(view.page.getByText(/步骤 0 \/ /u)).toBeVisible();
      await expectNoHorizontalOverflow(view.page);
      await expectTouchTarget(view.page, "button", "播放");
      await view.page.getByRole("button", { name: "下一步" }).click();
      await expect(view.page.getByText(/步骤 1 \/ /u)).toBeVisible();

      await view.page.goto("/wallet");
      await expect(view.page.getByRole("heading", { name: /分$/u })).toBeVisible();
      await expect(view.page.getByRole("cell", { name: "每手开局", exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(view.page);

      await view.page.goto("/profile");
      await expect(view.page.getByRole("heading", { name: /mobilematrixa/u })).toBeVisible();
      await expectNoHorizontalOverflow(view.page);
      await expectTouchTarget(view.page, "button", "退出登录");
      const nickname = view.page.getByRole("textbox", { name: "昵称", exact: true });
      await nickname.scrollIntoViewIfNeeded();
      await nickname.click({ trial: true });
    }
  } finally {
    await Promise.allSettled(auxiliary.map((context) => context.close()));
    await closeTable(table);
  }
});

for (const scenario of [
  { height: 844, maxSeats: 6, width: 390 },
  { height: 932, maxSeats: 9, width: 430 },
] as const) {
  test(`${scenario.width}x${scenario.height} keeps a ${scenario.maxSeats}-seat table inside the mobile viewport`, async ({ browser }) => {
    const user = await registerUser(browser, `mobile${scenario.maxSeats}`, { height: scenario.height, width: scenario.width });
    try {
      await createFullTable(user.page, user.phoneNumber, scenario.maxSeats);
      await expectNoHorizontalOverflow(user.page);
      const seats = user.page.getByTestId("seat-ring").locator("[data-seat-index]");
      await expect(seats).toHaveCount(scenario.maxSeats - 1);
      for (let seatIndex = 0; seatIndex < scenario.maxSeats - 1; seatIndex += 1) {
        await expect(seats.nth(seatIndex)).toBeVisible();
      }
      await expect(user.page.getByTestId("hero-hand")).toBeVisible();
      await user.page.getByTestId("seat-ring").scrollIntoViewIfNeeded();
      const ring = await user.page.getByTestId("seat-ring").boundingBox();
      expect(ring).not.toBeNull();
      expect(ring!.y).toBeGreaterThanOrEqual(0);
      expect(ring!.y + ring!.height).toBeLessThanOrEqual(scenario.height);
      const boxes = await seats.evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { bottom: box.bottom, left: box.left, right: box.right, top: box.top, width: box.width };
      }));
      expect(boxes.filter((box) => box.left < ring!.x - 1 || box.right > ring!.x + ring!.width + 1 || box.top < ring!.y - 1 || box.bottom > ring!.y + ring!.height + 1 || box.width < 44)).toEqual([]);
      const overlaps = boxes.flatMap((left, leftIndex) => boxes.slice(leftIndex + 1).filter((right) =>
        Math.min(left.right, right.right) - Math.max(left.left, right.left) > 2
        && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 2));
      expect(overlaps).toEqual([]);
      await expect(user.page.getByTestId("hero-hand")).toContainText((Math.floor(2_000_000_000 / scenario.maxSeats) * scenario.maxSeats).toLocaleString());
      await expectTouchTarget(user.page, "button", "打开牌桌菜单");
    } finally {
      await user.context.close();
    }
  });
}
