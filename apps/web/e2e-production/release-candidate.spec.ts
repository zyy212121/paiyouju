import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const password = "Poker-production-e2e-2026";
const baseURL = process.env.WEPOKER_E2E_BASE_URL ?? "https://localhost";
const adminPhone = process.env.WEPOKER_PROD_ADMIN_PHONE;
const adminPassword = process.env.WEPOKER_PROD_ADMIN_PASSWORD;

interface Account {
  readonly nickname: string;
  readonly phoneNumber: string;
}

const state: {
  alice?: Account;
  bob?: Account;
  firstHandId?: string;
  roomId?: string;
  roomName?: string;
  showdownHandId?: string;
} = {};

test.describe.configure({ mode: "serial" });

function uniquePhoneNumber(): string {
  const digits = BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 13)}`) % 10_000_000_000n;
  return `1${digits.toString().padStart(10, "0")}`;
}

async function newPage(browser: Browser): Promise<{ readonly context: BrowserContext; readonly page: Page }> {
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  return { context, page: await context.newPage() };
}

async function register(page: Page, prefix: string): Promise<Account> {
  const phoneNumber = uniquePhoneNumber();
  const nickname = `${prefix}-${phoneNumber.slice(-4)}`;
  await page.goto("/register");
  await page.getByLabel("手机号").fill(phoneNumber);
  await page.getByLabel("昵称").fill(nickname);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByRole("heading", { name: "你的私人牌局" })).toBeVisible();
  return { nickname, phoneNumber };
}

async function login(page: Page, phoneNumber: string, accountPassword = password): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("手机号").fill(phoneNumber);
  await page.getByLabel("密码", { exact: true }).fill(accountPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "你的私人牌局" })).toBeVisible();
}

async function waitForConnection(page: Page): Promise<void> {
  await expect(page.getByLabel("网络状态：已连接")).toBeVisible({ timeout: 15_000 });
}

async function currentVersion(page: Page): Promise<number> {
  return Number(await page.locator("[data-state-version]").getAttribute("data-state-version"));
}

async function submitPassiveAction(pages: readonly Page[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      for (const pattern of [/^跟注/u, /^过牌$/u]) {
        const button = page.getByRole("button", { name: pattern }).filter({ visible: true }).first();
        if (await button.count() === 0 || !(await button.isEnabled())) continue;
        const version = await currentVersion(page);
        await button.click();
        await expect.poll(() => currentVersion(page)).toBeGreaterThan(version);
        return;
      }
    }
    await pages[0]!.waitForTimeout(50);
  }
  throw new Error("no passive action became available");
}

async function playToShowdown(pages: readonly Page[]): Promise<void> {
  for (let action = 0; action < 14; action += 1) {
    if (await pages[0]!.getByTestId("post-hand-review").count() > 0) return;
    await submitPassiveAction(pages);
  }
  throw new Error("showdown did not complete");
}

async function purchaseTimeExtension(pages: readonly Page[]): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      const button = page.getByRole("button", { name: "加时", exact: true }).filter({ visible: true }).first();
      if (await button.count() === 0 || !(await button.isEnabled())) continue;
      await button.click();
      await expect(button).not.toBeVisible();
      return;
    }
    await pages[0]!.waitForTimeout(100);
  }
  throw new Error("action time extension did not become available");
}

async function post(page: Page, path: string, body: object): Promise<boolean> {
  return page.evaluate(async ({ body: requestBody, path: requestPath }) => (await fetch(requestPath, {
    body: JSON.stringify(requestBody),
    credentials: "include",
    headers: { "content-type": "application/json", "x-wepoker-request": "1" },
    method: "POST",
  })).ok, { body, path });
}

test("production edge serves health, readiness, manifest and safe errors", async ({ request }) => {
  const health = await request.get("/health");
  const ready = await request.get("/ready");
  const manifest = await request.get("/manifest.webmanifest");
  const missing = await request.get("/api/release-candidate-missing");
  expect(health.status()).toBe(200);
  expect(ready.status()).toBe(200);
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).display).toBe("standalone");
  expect(missing.status()).toBe(404);
  const missingBody = await missing.text();
  expect(missingBody).toContain("NOT_FOUND");
  expect(missingBody).not.toMatch(/(?:stack|node_modules|DATABASE_URL)/u);
});

test("Alice and Bob complete fold, reconnect, showdown, safe close and archive", async ({ browser }) => {
  test.setTimeout(150_000);
  const first = await newPage(browser);
  const second = await newPage(browser);
  try {
    state.alice = await register(first.page, "rc-alice");
    state.roomName = `RC browser ${randomUUID().slice(0, 8)}`;
    await first.page.getByRole("link", { name: "创建房间" }).click();
    await first.page.getByLabel("房间名称").fill(state.roomName);
    await first.page.getByLabel("最大座位").selectOption("2");
    await first.page.getByRole("slider", { name: "行动时间" }).fill("15");
    const createResponse = first.page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/rooms");
    await first.page.getByRole("button", { name: "创建房间" }).click();
    const created = await (await createResponse).json() as { readonly data: { readonly id: string; readonly roomCode: string } };
    state.roomId = created.data.id;
    await first.page.waitForURL(`/tables/${state.roomId}`);
    await waitForConnection(first.page);
    await first.page.getByRole("button", { name: "选择座位 1" }).click();
    await expect(first.page.getByTestId("hero-hand")).toHaveAttribute("data-seat-stack", "2000");

    state.bob = await register(second.page, "rc-bob");
    await second.page.getByRole("link", { name: "加入房间" }).click();
    await second.page.getByLabel("房间码").fill(created.data.roomCode);
    await second.page.getByRole("button", { name: "加入房间" }).click();
    await second.page.waitForURL(`/tables/${state.roomId}`);
    await waitForConnection(second.page);
    await second.page.getByRole("button", { name: "选择座位 2" }).click();
    await expect(second.page.getByTestId("hero-hand")).toHaveAttribute("data-seat-stack", "2000");

    await first.page.getByRole("button", { name: "开始游戏" }).click();
    await expect(first.page.getByTestId("hand-id")).not.toBeEmpty({ timeout: 15_000 });
    await expect(second.page.getByTestId("hand-id")).not.toBeEmpty({ timeout: 15_000 });
    state.firstHandId = (await first.page.getByTestId("hand-id").innerText()).trim();
    await purchaseTimeExtension([first.page, second.page]);
    const foldButtons = [first.page, second.page].map((page) => page.getByRole("button", { name: /弃牌$/u }).filter({ visible: true }));
    const folder = await foldButtons[0]!.count() > 0 ? foldButtons[0]! : foldButtons[1]!;
    await folder.click();
    await expect(first.page.getByTestId("post-hand-review")).toBeVisible();
    await expect(second.page.getByTestId("post-hand-review")).toBeVisible();

    await expect.poll(async () => (await first.page.getByTestId("hand-id").innerText()).trim(), { timeout: 15_000 }).not.toBe(state.firstHandId);
    state.showdownHandId = (await first.page.getByTestId("hand-id").innerText()).trim();
    const beforeReload = state.showdownHandId;
    await first.page.reload();
    await waitForConnection(first.page);
    await expect(first.page.getByTestId("hand-id")).toHaveText(beforeReload);
    expect(await post(first.page, `/api/rooms/${state.roomId}/pause`, {})).toBe(true);
    await playToShowdown([first.page, second.page]);
    await expect(first.page.getByTestId("board").locator("[data-card-code]")).toHaveCount(5);
    await expect(first.page.getByText("下一手已由房主暂停", { exact: true })).toBeVisible({ timeout: 12_000 });

    for (const page of [second.page, first.page]) {
      await page.getByRole("button", { name: "打开牌桌菜单" }).click();
      await page.getByRole("button", { name: "站起围观" }).click();
      await expect(page.getByTestId("hero-hand")).toHaveCount(0);
    }
    first.page.once("dialog", (dialog) => dialog.accept());
    await first.page.getByRole("button", { name: "打开牌桌菜单" }).click();
    const closeResponse = first.page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/rooms/${state.roomId}/close`);
    await first.page.getByRole("button", { name: "房主：安全关闭房间" }).click();
    expect((await closeResponse).status()).toBe(200);
    await first.page.goto("/");
    const closedRoom = first.page.locator("article").filter({ hasText: state.roomName });
    await expect(closedRoom).toBeVisible();
    first.page.once("dialog", (dialog) => dialog.accept());
    await closedRoom.getByRole("button", { name: "从列表移除" }).click();
    await expect(closedRoom).toHaveCount(0);
  } finally {
    await Promise.allSettled([first.context.close(), second.context.close()]);
  }
});

test("Alice can log back in and read durable history, replay, Wallet and profile", async ({ browser }) => {
  const account = state.alice;
  if (!account || !state.firstHandId || !state.showdownHandId || !state.roomName) throw new Error("lifecycle state is missing");
  const view = await newPage(browser);
  try {
    await login(view.page, account.phoneNumber);
    await view.page.goto("/hands");
    await expect(view.page.getByRole("heading", { name: "我的手牌" })).toBeVisible();
    await expect(view.page.getByRole("link", { name: new RegExp(state.roomName, "u") }).first()).toBeVisible();
    await view.page.goto(`/hands/${state.showdownHandId}`);
    await expect(view.page.getByRole("link", { name: "回放" })).toBeVisible();
    await view.page.getByRole("link", { name: "回放" }).click();
    await expect(view.page.getByText(/步骤 0 \/ /u)).toBeVisible();
    await view.page.getByRole("button", { name: "下一步" }).click();
    await expect(view.page.getByText(/步骤 1 \/ /u)).toBeVisible();
    await view.page.goto("/wallet");
    await expect(view.page.getByRole("cell", { name: "每手开局", exact: true })).toBeVisible();
    await expect(view.page.getByRole("cell", { name: "旧版点数转入", exact: true })).toHaveCount(0);
    await expect(view.page.getByRole("cell", { name: "旧版点数转出", exact: true })).toHaveCount(0);
    await view.page.goto("/profile");
    await expect(view.page.getByText(`${account.phoneNumber.slice(0, 3)}****${account.phoneNumber.slice(-4)}`)).toBeVisible();
  } finally {
    await view.context.close();
  }
});

test("non-admin access is denied and participant payloads never expose phone numbers", async ({ browser }) => {
  const account = state.bob;
  if (!account || !state.alice || !state.firstHandId) throw new Error("privacy state is missing");
  const view = await newPage(browser);
  try {
    await login(view.page, account.phoneNumber);
    await view.page.goto("/admin");
    await expect(view.page.getByRole("heading", { name: "无管理员权限" })).toBeVisible();
    const hand = await view.context.request.get(`/api/hands/${state.firstHandId}`);
    expect(hand.status()).toBe(200);
    const payload = await hand.text();
    expect(payload).not.toContain(account.phoneNumber);
    expect(payload).not.toContain(state.alice.phoneNumber);
  } finally {
    await view.context.close();
  }
});

test("administrator logs in and performs one auditable Wallet adjustment", async ({ browser }) => {
  if (!adminPhone || !adminPassword || !state.alice) throw new Error("production-like admin credentials or Alice state are missing");
  const view = await newPage(browser);
  try {
    await login(view.page, adminPhone, adminPassword);
    await view.page.goto("/admin");
    await expect(view.page.getByRole("heading", { name: "管理概览" })).toBeVisible();
    await view.page.getByRole("link", { name: "用户", exact: true }).click();
    const search = view.page.getByPlaceholder("ID、名称、用户名或手机号后四位");
    await search.fill(state.alice.phoneNumber);
    const response = view.page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/api/admin/users/search");
    await view.page.getByRole("button", { name: "搜索" }).click();
    const searchResponse = await response;
    expect(searchResponse.status()).toBe(200);
    expect(await searchResponse.text()).not.toContain(state.alice.phoneNumber);
    await expect(view.page.getByText(`${state.alice.phoneNumber.slice(0, 3)}****${state.alice.phoneNumber.slice(-4)}`)).toBeVisible();
    await view.page.getByRole("link", { name: /^查看 /u }).first().click();
    view.page.once("dialog", (dialog) => dialog.accept());
    await view.page.getByLabel("调整金额").fill("7");
    await view.page.getByLabel("原因").fill("Step 8 生产候选验收调整");
    await view.page.getByRole("button", { name: "复核并提交" }).click();
    await expect(view.page.getByText("积分调整已提交并写入审计日志")).toBeVisible();
  } finally {
    await view.context.close();
  }
});

test("administrator sees valid point fees and the adjustment AuditLog", async ({ browser }) => {
  if (!adminPhone || !adminPassword) throw new Error("production-like admin credentials are missing");
  const view = await newPage(browser);
  try {
    await login(view.page, adminPhone, adminPassword);
    await view.page.goto("/admin/point-actions");
    await expect(view.page.getByRole("heading", { name: "积分行为审计" })).toBeVisible();
    await expect(view.page.getByText("VALID", { exact: true }).first()).toBeVisible();
    await view.page.goto("/admin/audit-logs");
    await expect(view.page.getByRole("heading", { name: "AuditLog" })).toBeVisible();
    await expect(view.page.getByText("ADMIN_WALLET_ADJUSTMENT", { exact: true }).first()).toBeVisible();
  } finally {
    await view.context.close();
  }
});
