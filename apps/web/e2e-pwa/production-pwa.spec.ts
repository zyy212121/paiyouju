import { expect, test } from "@playwright/test";

test("production PWA installs static assets without caching private traffic", async ({ context, page, request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json() as {
    readonly display: string;
    readonly icons: readonly { readonly purpose?: string; readonly src: string }[];
    readonly start_url: string;
  };
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/" });
  const maskable = manifest.icons.find((icon) => icon.purpose === "maskable");
  expect(maskable).toBeDefined();
  expect((await request.get(maskable!.src)).ok()).toBe(true);
  expect((await request.get("/sw.js")).ok()).toBe(true);

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.evaluate(async () => {
    await Promise.allSettled([
      fetch("/api/hands/00000000-0000-4000-8000-000000000001", { cache: "no-store", credentials: "include" }),
      fetch("/api/wallet", { cache: "no-store", credentials: "include" }),
      fetch("/api/hands/00000000-0000-4000-8000-000000000001/paid-reveals", {
        body: JSON.stringify({ operationId: "00000000-0000-4000-8000-000000000002", targetUserId: "private-target" }),
        cache: "no-store",
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      fetch("/socket.io/?EIO=4&transport=polling", { cache: "no-store" }),
    ]);
  });

  const cacheSnapshot = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      urls.push(...(await cache.keys()).map((entry) => entry.url));
    }
    return { names, urls };
  });
  expect(cacheSnapshot.names.length).toBeGreaterThan(0);
  expect(cacheSnapshot.urls.some((url) => /\/api(?:\/|$)|\/socket\.io(?:\/|$)|\/(?:health|ready)(?:\?|$)/u.test(new URL(url).pathname))).toBe(false);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
  });
  await expect(page.getByText(/当前离线/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "离线时不可提交" })).toBeDisabled();
  await context.setOffline(false);
});
