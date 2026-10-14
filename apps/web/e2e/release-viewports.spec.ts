import { expect, test } from "@playwright/test";

const viewports = [
  { height: 390, label: "mobile-landscape", width: 844 },
  { height: 1024, label: "tablet-portrait", width: 768 },
  { height: 768, label: "desktop-1366", width: 1366 },
  { height: 1080, label: "desktop-1920", width: 1920 },
] as const;

test("release viewport matrix keeps the public entry usable without horizontal overflow", async ({ browser }) => {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    try {
      const page = await context.newPage();
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "手机号" })).toBeVisible();
      await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth, viewport.label).toBeLessThanOrEqual(dimensions.clientWidth);
    } finally {
      await context.close();
    }
  }
});
