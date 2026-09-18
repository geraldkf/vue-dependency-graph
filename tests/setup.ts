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

/**
 * jsdom's Blob/File implementation doesn't implement `.text()` (a
 * long-standing jsdom gap - every real target browser supports it, this
 * is purely a test-environment limitation). Rather than avoid a standard,
 * correct Web API in production code, or re-derive this same workaround
 * in every test file that reads a File/Blob, it's polyfilled once here.
 * File extends Blob, so patching Blob's prototype covers both.
 *
 * FileReader, not `new Response(blob).text()`: jsdom's Blob is not an
 * instance of Node's native Blob class, so Node's Response constructor
 * doesn't recognise it as binary body content and silently stringifies
 * it instead (producing the literal text "[object File]"). FileReader is
 * jsdom's own implementation operating on jsdom's own Blob, so it reads
 * the actual content correctly.
 */
if (typeof Blob !== "undefined" && !Blob.prototype.text) {
  Blob.prototype.text = function (this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
