import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, registerUser, withTestDatabase } from "./helpers.js";

test("admin gate, masked phone search, adjustment and audit log work in the existing responsive app", async ({ browser }) => {
  const administrator = await registerUser(browser, "admin-e2e", { height: 844, width: 390 });
  try {
    await administrator.page.goto("/admin");
    await expect(administrator.page.getByRole("heading", { name: "无管理员权限" })).toBeVisible();

    const userId = await withTestDatabase(async (database) => {
      const user = await database.user.update({
        data: { role: "ADMIN" },
        where: { phoneNumber: administrator.phoneNumber },
      });
      return user.id;
    });
    await administrator.page.reload();
    await expect(administrator.page.getByRole("heading", { name: "管理概览" })).toBeVisible();
    await expect(administrator.page.getByText("用户总数")).toBeVisible();
    await expectNoHorizontalOverflow(administrator.page);

    await administrator.page.getByRole("link", { name: "用户", exact: true }).click();
    const search = administrator.page.getByPlaceholder("ID、名称、用户名或手机号后四位");
    await search.fill(administrator.phoneNumber);
    const responsePromise = administrator.page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/users/search",
    );
    await administrator.page.getByRole("button", { name: "搜索" }).click();
    const searchResponse = await responsePromise;
    expect(searchResponse.ok()).toBe(true);
    expect(await searchResponse.text()).not.toContain(administrator.phoneNumber);
    await expect(administrator.page.getByText(`${administrator.phoneNumber.slice(0, 3)}****${administrator.phoneNumber.slice(-4)}`)).toBeVisible();
    await administrator.page.getByRole("link", { name: `查看 ${userId}` }).click();

    administrator.page.once("dialog", (dialog) => dialog.accept());
    await administrator.page.getByLabel("调整金额").fill("25");
    await administrator.page.getByLabel("原因").fill("浏览器管理员调整验收");
    await administrator.page.getByRole("button", { name: "复核并提交" }).click();
    await expect(administrator.page.getByText("积分调整已提交并写入审计日志")).toBeVisible();
    await expect.poll(async () => withTestDatabase(async (database) =>
      (await database.wallet.findUniqueOrThrow({ where: { userId } })).balance,
    )).toBe(10_025);

    await administrator.page.getByRole("link", { name: "审计日志" }).click();
    await expect(administrator.page.getByText("ADMIN_WALLET_ADJUSTMENT").first()).toBeVisible();
    await expectNoHorizontalOverflow(administrator.page);
  } finally {
    await administrator.context.close();
  }
});
