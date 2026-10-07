import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("private APIs reject a visitor without a session, and another site cannot frame the app", async ({ page }) => {
  for (const route of ["/api/financial-history", "/api/reconciliation", "/api/export/transactions"]) {
    const response = await page.request.get(route);
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  }

  const baseURL = test.info().project.use.baseURL!;
  const response = await page.request.get("/demo");
  expect(response.status()).toBe(200);
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  // A real local server gives the parent page a different origin without
  // triggering Chromium's public-to-local-network protection for mocked pages.
  const parent = createServer((_request, reply) => {
    reply.writeHead(200, { "Content-Type": "text/html" });
    reply.end(`<h1>Another site</h1><iframe title="Embedded finance app" src="${baseURL}/demo"></iframe>`);
  });
  await new Promise<void>(resolve => parent.listen(0, "127.0.0.1", resolve));
  try {
    const refusedFrame = page.waitForEvent("console", {
      predicate: message => /(?:frame-ancestors|X-Frame-Options)/i.test(message.text()),
      timeout: 10000,
    });
    const port = (parent.address() as AddressInfo).port;
    await page.goto(`http://127.0.0.1:${port}/embedding-test`);
    await refusedFrame;
    await expect(page.frameLocator("iframe").getByRole("button", { name: "Start demo", exact: true })).toHaveCount(0);
  } finally {
    await new Promise<void>((resolve, reject) => parent.close(error => error ? reject(error) : resolve()));
  }
  // Opening the same address directly still works.
  await page.goto("/demo");
  await expect(page.getByRole("button", { name: "Start demo", exact: true })).toBeVisible();
});
