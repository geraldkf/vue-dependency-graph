import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { chromium } from "playwright";

if (!existsSync(new URL("../dist/playground/index.html", import.meta.url))) {
  throw new Error("Build first: pnpm build");
}
const server = await preview({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  preview: { host: "127.0.0.1", port: 0, open: false },
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const address = server.httpServer.address();
  assert(address && typeof address !== "string");
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByTestId("data").filter({ hasText: "Profile for user #1" }).waitFor();
  await page.getByRole("button", { name: "User 2", exact: true }).click();
  await page.getByRole("button", { name: "User 3", exact: true }).click();
  await page.getByTestId("data").filter({ hasText: "Profile for user #3" }).waitFor();
  await page.getByRole("button", { name: "Unmount Cleanup", exact: true }).click();
  await page.getByTestId("subscriber-count").filter({ hasText: "Subscribers: 1" }).waitFor();
  await page.getByRole("button", { name: "Hide consumer", exact: true }).click();
  await page.getByTestId("subscriber-count").filter({ hasText: "Subscribers: 0" }).waitFor();
  await page.getByRole("button", { name: "Polling Progress", exact: true }).click();
  await page.getByRole("button", { name: "Mount consumer", exact: true }).click();
  await page
    .getByTestId("polling-node-status")
    .filter({ hasText: /^success$/ })
    .waitFor();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await page
    .getByTestId("polling-business-state")
    .filter({ hasText: /^completed$/ })
    .waitFor();
  await page.getByTestId("polling-timer-count").filter({ hasText: /^0$/ }).waitFor();
  await page.getByRole("button", { name: "Unmount consumer", exact: true }).click();
  const labels = await page
    .getByRole("navigation", { name: "Playground scenarios" })
    .getByRole("button")
    .allTextContents();
  for (const label of labels) {
    await page.getByRole("button", { name: label.trim(), exact: true }).click();
    await page.getByRole("heading", { name: label.trim(), exact: true, level: 2 }).waitFor();
  }
  assert.deepEqual(failures, [], "Browser must have no uncaught application errors");
  console.log(
    `Browser smoke passed: ${labels.length} scenarios, rapid context switching, unsubscribe cleanup, polling completion.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
