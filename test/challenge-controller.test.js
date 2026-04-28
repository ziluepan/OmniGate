import test from "node:test";
import assert from "node:assert";
import { chromium } from "playwright";

import { ChallengeAwareController } from "../src/challenge-controller.js";
import { createMockChallengeServer } from "../test-support/mock-challenge-server.js";

async function detectBrowserSupport() {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return {
      supported: true,
      reason: ""
    };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

const browserSupport = await detectBrowserSupport();

if (!browserSupport.supported) {
  test(
    "ChallengeAwareController - manual intervention workflow",
    {
      skip: `Playwright browser could not launch in this environment: ${browserSupport.reason}`
    },
    () => {}
  );
} else {
  test("ChallengeAwareController - manual intervention workflow", async () => {
    // 1. Start Mock Server
    const server = await createMockChallengeServer();

    // 2. Start Headless Browser
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // 3. Navigate to target url (currently presenting a challenge)
      await page.goto(server.url);
      await page.waitForLoadState("networkidle");

      // 4. Instantiate Controller
      const controller = new ChallengeAwareController({
        pollIntervalMs: 500, // Speed up polling for tests
        manualResolutionTimeoutMs: 15000,
      });

      assert.strictEqual(controller.getState(), "running");

      // 5. Detect Challenge
      const event = await controller.detectChallenge(page);
      assert.ok(event, "Challenge should be detected initially");
      assert.strictEqual(controller.getState(), "challenge_blocked");
      assert.ok(event.htmlSnippet.includes("Verify you are human"));

      // 6. Handle Challenge Lifecycle
      let notifyCalled = false;
      const handled = await controller.handleChallenge(page, event, async (e) => {
        notifyCalled = true;
      });

      assert.ok(notifyCalled, "Notifier should have been triggered");
      assert.strictEqual(handled.status, "blocked");

      // 7. Fire off the manual wait (this blocks until operator intervenes)
      // We don't await immediately, because we need to trigger the mock intervention concurrently
      const manualSolvePromise = handled.applySolution("mock-ticket-ID-12345");

      // 8. Simulate an external operator or extension solving the challenge visually on the browser
      // Let's delay roughly 1.5 seconds, then post to the mock server to simulate a local solve.
      setTimeout(async () => {
        await fetch(`${server.url}/api/solve`, { method: "POST" }).catch(() => {});
      }, 1500);

      // 9. Now we await the controller's resolution
      const resolution = await manualSolvePromise;

      // 10. Assert lifecycle completed successfully
      assert.strictEqual(resolution.status, "running");
      assert.strictEqual(resolution.manualReference, "mock-ticket-ID-12345");
      assert.strictEqual(controller.getState(), "running");

      // Double check the page is actually on the content now
      const content = await page.locator("body").innerText();
      assert.ok(content.includes("Welcome to Mock Target"), "Page should have dynamically updated");

    } finally {
      // Cleanup
      await context.close();
      await browser.close();
      await server.close();
    }
  });
}
