import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createDatabaseClient, type DatabaseClient } from "../../server/src/db/client.js";

export const E2E_BASE_URL = process.env.WEPOKER_E2E_BASE_URL ?? "http://127.0.0.1:5173";
export const E2E_IGNORE_HTTPS_ERRORS = process.env.WEPOKER_E2E_IGNORE_HTTPS_ERRORS === "1";
export const E2E_PASSWORD = "Poker-e2e-2026";

interface TestUser {
  readonly context: BrowserContext;
  readonly nickname: string;
  readonly page: Page;
  readonly phoneNumber: string;
}

export interface TwoPlayerTable {
  readonly first: TestUser;
  readonly roomCode: string;
  readonly roomId: string;
  readonly second: TestUser;
}

interface WalletSummary {
  readonly balance: number;
  readonly version: number;
}

function uniquePhoneNumber(): string {
  const randomDigits = BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 13)}`) % 10_000_000_000n;
  return `1${randomDigits.toString().padStart(10, "0")}`;
}

function e2eEnvironmentFile(): string {
  return process.env.WEPOKER_E2E_ENV_FILE
    ?? fileURLToPath(new URL("../../../.env.test", import.meta.url));
}

export function e2eEnvironmentValue(name: string): string {
  const contents = readFileSync(e2eEnvironmentFile(), "utf8");
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0 || line.slice(0, separator).trim() !== name) continue;
    return line.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, "");
  }
  throw new Error(`${name} is missing from the E2E environment file`);
}

function parseTestDatabaseEnvironment(): { readonly poolMaximum: number; readonly url: string } {
  const directUrl = process.env.WEPOKER_E2E_DATABASE_URL;
  if (directUrl) {
    const poolMaximum = Number(process.env.WEPOKER_E2E_DATABASE_POOL_MAX ?? "2");
    if (!Number.isSafeInteger(poolMaximum) || poolMaximum < 1) throw new Error("WEPOKER_E2E_DATABASE_POOL_MAX must be a positive integer");
    return { poolMaximum, url: directUrl };
  }
  const contents = readFileSync(e2eEnvironmentFile(), "utf8");
  let url: string | null = null;
  let poolMaximum = 1;
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, "");
    if (key === "DATABASE_URL") url = value;
    if (key === "DATABASE_POOL_MAX" && /^\d+$/u.test(value)) poolMaximum = Number(value);
  }
  if (!url) throw new Error("DATABASE_URL is missing from the E2E environment file");
  return { poolMaximum, url };
}

export async function withTestDatabase<T>(work: (database: DatabaseClient) => Promise<T>): Promise<T> {
  const environment = parseTestDatabaseEnvironment();
  const database = createDatabaseClient(environment.url, environment.poolMaximum);
  try {
    return await work(database);
  } finally {
    await database.$disconnect();
  }
}

export async function registerUser(
  browser: Browser,
  prefix: string,
  viewport?: { readonly height: number; readonly width: number },
): Promise<TestUser> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL, ignoreHTTPSErrors: E2E_IGNORE_HTTPS_ERRORS, ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  const phoneNumber = uniquePhoneNumber();
  const nickname = `${prefix}-${phoneNumber.slice(-4)}`;
  await page.goto("/register");
  await page.getByLabel("手机号").fill(phoneNumber);
  await page.getByLabel("昵称").fill(nickname);
  await page.getByLabel("密码", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByRole("heading", { name: "你的私人牌局" })).toBeVisible();
  return { context, nickname, page, phoneNumber };
}

export async function createRoom(
  page: Page,
  name: string,
  maxSeats = 2,
): Promise<{ readonly roomCode: string; readonly roomId: string }> {
  await page.getByRole("link", { name: "创建房间" }).click();
  await page.getByLabel("房间名称").fill(name);
  await page.getByLabel("最大座位").selectOption(String(maxSeats));
  await page.getByRole("slider", { name: "行动时间" }).fill("15");
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/rooms");
  await page.getByRole("button", { name: "创建房间" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const body = await response.json() as { readonly data: { readonly id: string; readonly roomCode: string } };
  const { id: roomId, roomCode } = body.data;
  await page.waitForURL(`/tables/${roomId}`);
  await expect(page.getByTestId("table-top-bar")).toContainText(name);
  await expect(page.getByLabel("网络状态：已连接")).toBeVisible({ timeout: 15_000 });
  return { roomCode, roomId };
}

export async function joinRoom(page: Page, roomCode: string, roomName: string): Promise<void> {
  await page.getByRole("link", { name: "加入房间" }).click();
  await page.getByLabel("房间码").fill(roomCode);
  await page.getByRole("button", { name: "加入房间" }).click();
  await page.waitForURL(/\/tables\/[^/]+$/u);
  await expect(page.getByTestId("table-top-bar")).toContainText(roomName);
  await expect(page.getByLabel("网络状态：已连接")).toBeVisible({ timeout: 15_000 });
}

export async function takeSeat(page: Page, seatIndex: number, expectedBuyIn = 2_000): Promise<void> {
  await expect(page.getByLabel("网络状态：已连接")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: `选择座位 ${seatIndex + 1}` }).click();
  await expect(page.getByRole("dialog", { name: /带入|补充筹码/u })).toHaveCount(0);
  await expect(page.getByTestId("hero-hand")).toHaveAttribute("data-seat-index", String(seatIndex));
  await expect(page.getByTestId("hero-hand")).toHaveAttribute("data-seat-stack", String(expectedBuyIn));
}

export async function enterTable(page: Page, roomId: string): Promise<void> {
  if (new URL(page.url()).pathname !== `/tables/${roomId}`) await page.goto(`/tables/${roomId}`);
  await page.waitForURL(`/tables/${roomId}`);
  await expect(page.getByLabel("网络状态：已连接")).toBeVisible({ timeout: 15_000 });
}

export async function waitForHand(page: Page): Promise<void> {
  await expect(page.getByTestId("hand-id")).toHaveText(/[0-9a-f-]{36}/u, { timeout: 15_000 });
  await expect(page.locator("[data-state-version]")).toHaveAttribute("data-state-version", /[1-9]\d*/u);
}

export async function setupTwoPlayerTable(
  browser: Browser,
  prefix: string,
  firstViewport?: { readonly height: number; readonly width: number },
): Promise<TwoPlayerTable> {
  const first = await registerUser(browser, `${prefix}a`, firstViewport);
  const roomName = `${prefix}-双人桌`;
  const { roomCode, roomId } = await createRoom(first.page, roomName, 2);
  await takeSeat(first.page, 0);
  await enterTable(first.page, roomId);
  await expect(first.page.getByRole("button", { name: "邀请好友" })).toBeVisible();
  const second = await registerUser(browser, `${prefix}b`);
  await joinRoom(second.page, roomCode, roomName);
  await takeSeat(second.page, 1);
  await enterTable(second.page, roomId);
  await expect(second.page.getByText("等待房主开始", { exact: true })).toBeVisible();
  const ownerViewOfSecondSeat = first.page.locator('[data-seat-index="1"] [aria-label^="玩家状态："]');
  await expect(ownerViewOfSecondSeat).not.toHaveAttribute("aria-label", /已断开/u);
  const startButton = first.page.getByRole("button", { name: "开始游戏" });
  await expect(startButton).toBeVisible();
  await expect(startButton).toBeEnabled();
  await startButton.click({ timeout: 10_000 });
  await Promise.all([waitForHand(first.page), waitForHand(second.page)]);
  return { first, roomCode, roomId, second };
}

export async function closeTable(table: TwoPlayerTable): Promise<void> {
  await Promise.allSettled([table.first.context.close(), table.second.context.close()]);
}

export async function wallet(page: Page): Promise<WalletSummary> {
  const response = await page.context().request.get("/api/wallet");
  expect(response.ok()).toBe(true);
  const body = await response.json() as { readonly data: WalletSummary };
  return body.data;
}

export async function walletLedger(page: Page): Promise<readonly { readonly relatedGameSessionId: string | null; readonly signedAmount: number; readonly type: string }[]> {
  const response = await page.context().request.get("/api/wallet/ledger?limit=25");
  expect(response.ok()).toBe(true);
  const body = await response.json() as { readonly data: { readonly entries: readonly { readonly relatedGameSessionId: string | null; readonly signedAmount: number; readonly type: string }[] } };
  return body.data.entries;
}

function actionButton(page: Page, pattern: RegExp) {
  return page.getByRole("button", { name: pattern }).filter({ visible: true });
}

async function currentVersion(page: Page): Promise<number> {
  return Number(await page.locator("[data-state-version]").getAttribute("data-state-version"));
}

export async function submitPassiveAction(pages: readonly Page[]): Promise<Page> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      for (const pattern of [/^跟注/u, /^过牌$/u]) {
        const button = actionButton(page, pattern);
        if (await button.count() === 0 || !(await button.first().isEnabled())) continue;
        const previousVersion = await currentVersion(page);
        await button.first().click();
        await expect.poll(() => currentVersion(page)).toBeGreaterThan(previousVersion);
        return page;
      }
    }
    await pages[0]!.waitForTimeout(50);
  }
  throw new Error("no passive action became available before the deadline");
}

export async function playToFlop(pages: readonly Page[]): Promise<void> {
  for (let actions = 0; actions < 4; actions += 1) {
    if (await pages[0]!.getByTestId("board").locator("[data-card-code]").count() === 3) return;
    await submitPassiveAction(pages);
  }
  throw new Error("hand did not reach the flop");
}

export async function playToShowdown(pages: readonly Page[]): Promise<void> {
  for (let actions = 0; actions < 12; actions += 1) {
    const boardCount = await pages[0]!.getByTestId("board").locator("[data-card-code]").count();
    if (boardCount === 5 && await pages[0]!.getByTestId("post-hand-review").count() > 0) return;
    await submitPassiveAction(pages);
  }
  throw new Error("hand did not complete at showdown");
}

export async function cardCodes(locator: ReturnType<Page["locator"]>): Promise<readonly string[]> {
  return locator.locator("[data-card-code]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-card-code") ?? ""));
}

export async function tableSnapshot(page: Page) {
  return {
    board: await cardCodes(page.getByTestId("board")),
    deadline: await page.getByTestId("deadline").getAttribute("data-deadline"),
    handId: await page.getByTestId("hand-id").innerText(),
    ownCards: await cardCodes(page.getByTestId("own-cards")),
    potText: await page.getByTestId("pots").innerText(),
    stacks: await page.locator("[data-seat-index]").evaluateAll((seats) => seats.map((seat) => ({
      seatIndex: Number(seat.getAttribute("data-seat-index")),
      stack: Number(seat.getAttribute("data-seat-stack")),
    })).sort((left, right) => left.seatIndex - right.seatIndex)),
    version: await currentVersion(page),
  };
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })))
    .toEqual(await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.clientWidth })));
}
