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
  await page.getByRole("button", { name: "Start new job", exact: true }).click();
  await page
    .getByTestId("polling-operation")
    .filter({ hasText: /^operation-2$/ })
    .waitFor();
  await page
    .getByTestId("polling-business-state")
    .filter({ hasText: /^running$/ })
    .waitFor();
  await page.getByTestId("polling-timer-count").filter({ hasText: /^1$/ }).waitFor();
  const requestsBeforePoll = Number(await page.getByTestId("polling-request-count").textContent());
  await page.getByRole("button", { name: "Advance one poll", exact: true }).click();
  await page
    .getByTestId("polling-request-count")
    .filter({ hasText: new RegExp(`^${requestsBeforePoll + 1}$`) })
    .waitFor();
  await page.getByRole("button", { name: "Fail", exact: true }).click();
  await page
    .getByTestId("polling-business-state")
    .filter({ hasText: /^failed$/ })
    .waitFor();
  await page.getByTestId("polling-timer-count").filter({ hasText: /^0$/ }).waitFor();
  await page.getByRole("button", { name: "Start new job", exact: true }).click();
  await page
    .getByTestId("polling-operation")
    .filter({ hasText: /^operation-3$/ })
    .waitFor();
  await page.getByTestId("polling-timer-count").filter({ hasText: /^1$/ }).waitFor();
  await page.getByRole("button", { name: "Unmount consumer", exact: true }).click();
  await page.getByTestId("polling-timer-count").filter({ hasText: /^0$/ }).waitFor();

  const openOwnership = async () => {
    await page.getByRole("button", { name: "Runtime Ownership", exact: true }).click();
    await page
      .getByTestId("ownership-value")
      .filter({ hasText: /^Value: 1$/ })
      .waitFor();
    await page
      .getByTestId("ownership-demand")
      .filter({ hasText: /^Demand: 1$/ })
      .waitFor();
  };
  const leaveOwnership = () =>
    page.getByRole("button", { name: "Context Switching", exact: true }).click();
  for (const kind of ["request", "mutation"]) {
    await openOwnership();
    await page.getByRole("button", { name: `Start ${kind}`, exact: true }).click();
    const deliver = page.getByRole("button", { name: `Deliver ${kind} response`, exact: true });
    await deliver.waitFor();
    // Enabled means the remote callback actually started and captured its signal.
    await deliver.click({ trial: true });
    await page.getByRole("button", { name: "End owner lifetime", exact: true }).click();
    await page
      .getByTestId(`ownership-${kind}`)
      .filter({ hasText: new RegExp(`^${kind === "request" ? "Request" : "Mutation"}: shutdown$`) })
      .waitFor();
    await page
      .getByTestId("ownership-demand")
      .filter({ hasText: /^Demand: 0$/ })
      .waitFor();
    await page
      .getByTestId("ownership-aborted")
      .filter({ hasText: /^Aborted: true$/ })
      .waitFor();
    await deliver.click();
    assert.equal(await page.getByTestId("ownership-value").textContent(), "Value: 1");
    assert.equal(
      await page.getByTestId("ownership-successes").textContent(),
      "Success callbacks: 0",
    );
    assert.equal(
      await page.getByTestId("ownership-error").textContent(),
      "Error: GraphRuntimeShutdownError",
    );
    assert.equal(
      await page.getByRole("button", { name: `Start ${kind}`, exact: true }).isDisabled(),
      true,
    );
    await leaveOwnership();
  }
  await openOwnership();
  await page.getByRole("button", { name: "Start mutation", exact: true }).click();
  await page
    .getByRole("button", { name: "Deliver mutation response", exact: true })
    .click({ trial: true });
  await leaveOwnership(); // Unmount shuts down while the mutation is still pending.
  await openOwnership();
  assert.equal(await page.getByTestId("ownership-mutation").textContent(), "Mutation: idle");
  await page.getByRole("button", { name: "Start mutation", exact: true }).click();
  await page.getByRole("button", { name: "Deliver mutation response", exact: true }).click();
  await page
    .getByTestId("ownership-mutation")
    .filter({ hasText: /^Mutation: completed$/ })
    .waitFor();
  await page
    .getByTestId("ownership-value")
    .filter({ hasText: /^Value: 100$/ })
    .waitFor();
  assert.equal(await page.getByTestId("ownership-successes").textContent(), "Success callbacks: 1");
  await leaveOwnership();
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
    `Browser smoke passed: ${labels.length} scenarios, context switching, demand cleanup, polling restart after completion/failure, pending request/mutation shutdown, late responses and navigation during mutation.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
