import { afterEach } from "vitest";
import { cleanup } from "@testing-library/vue";

/**
 * @testing-library/vue does not register this automatically the way some
 * other test-runner integrations do — nothing was calling it, so any test
 * file with more than one `render()` call accumulates every previously
 * rendered component in the same jsdom document, and DOM queries like
 * `getByTestId` start matching multiple elements across tests instead of
 * the current one. Registered globally here rather than per test file, so
 * every future test gets this for free instead of needing to remember it.
 */
afterEach(() => {
  cleanup();
});
