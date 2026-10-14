import { expect, test, type Page } from "@playwright/test";

const seed = Number(process.env.WEPOKER_RESTORE_SEED ?? "2026082620");
const accountPassword = process.env.WEPOKER_RESTORE_ACCOUNT_PASSWORD ?? "Rc-system-2026";
const adminPhone = process.env.WEPOKER_PROD_ADMIN_PHONE;
const adminPassword = process.env.WEPOKER_PROD_ADMIN_PASSWORD;

function deterministicPhone(index: number): string {
  const namespace = Math.abs(seed % 10_000);
  const suffix = (namespace * 10_000 + index) % 100_000_000;
  return `186${String(suffix).padStart(8, "0")}`;
}

async function login(page: Page, phoneNumber: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("手机号").fill(phoneNumber);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "你的私人牌局" })).toBeVisible();
}

test("restored users retain Wallet, history, replay, fee entitlements and administrator audit", async ({ browser }) => {
  test.setTimeout(120_000);
  const paidButtons: number[] = [];
  for (const index of [0, 1]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await login(page, deterministicPhone(index), accountPassword);
      await page.goto("/hands");
      const restoredHand = page.getByRole("link", { name: /RC feature protocols/u }).first();
      await expect(restoredHand).toBeVisible();
      await restoredHand.click();
      await expect(page.getByRole("heading", { name: /第 1 手/u })).toBeVisible();
      await expect(page.getByLabel("发发看公共牌").locator("[data-card-code]")).toHaveCount(5);
      await expect(page.getByTestId("hypothetical-runout")).toContainText("已保存");
      paidButtons.push(await page.getByRole("button", { name: /^偷偷看 /u }).count());
      await page.getByRole("link", { name: "回放" }).click();
      await expect(page.getByText(/步骤 0 \/ /u)).toBeVisible();
      await page.getByRole("button", { name: "下一步" }).click();
      await expect(page.getByText(/步骤 1 \/ /u)).toBeVisible();
      await page.goto("/wallet");
      await expect(page.getByRole("heading", { name: /分$/u })).toBeVisible();
      await expect(page.getByRole("cell", { name: "发发看", exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  }
  expect(paidButtons.sort()).toEqual([0, 1]);

  if (!adminPhone || !adminPassword) throw new Error("restored-data administrator credentials are required");
  const admin = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await admin.newPage();
  try {
    await login(page, adminPhone, adminPassword);
    await page.goto("/admin/point-actions");
    await expect(page.getByText("VALID", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("MISSING_HAND", { exact: true })).toHaveCount(0);
    await page.goto("/admin/audit-logs");
    await expect(page.getByText("ADMIN_WALLET_ADJUSTMENT", { exact: true }).first()).toBeVisible();
  } finally {
    await admin.close();
  }
});
