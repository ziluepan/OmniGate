import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(stealthPlugin());

import {
  capturePageSnapshot,
  collectSectionsBySelectors,
  dismissNuisanceOverlays
} from "./page-snapshot.js";
import { detectVerificationSignals } from "./verification.js";

export async function createPlaywrightSession({
  navigationTimeoutMs,
  storageStatePath,
  browserExecutablePath,
  headless = true
}) {
  const browser = await chromium.launch({
    headless,
    executablePath: browserExecutablePath,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation']
  });
  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 900
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: "zh-CN",
    storageState: storageStatePath && existsSync(storageStatePath)
      ? storageStatePath
      : undefined
  });
  const page = await context.newPage();

  page.setDefaultNavigationTimeout(navigationTimeoutMs);
  page.setDefaultTimeout(navigationTimeoutMs);

  return {
    async navigate(url) {
      await page.goto(url, {
        waitUntil: "load",
        timeout: navigationTimeoutMs
      });

      await page.waitForLoadState("networkidle", {
        timeout: 10000
      }).catch(() => {});

      // Wait a short moment for late client-side redirects/navigations to settle
      await page.waitForTimeout(1500);

      // Smoke test: verify the execution context is still alive
      try {
        await page.evaluate(() => true);
      } catch {
        // If the context was destroyed by a late navigation, wait for it to
        // settle and confirm stability
        await page.waitForLoadState("networkidle", {
          timeout: 10000
        }).catch(() => {});
        await page.waitForTimeout(2000);
      }
    },
    async dismissNuisanceOverlays() {
      await dismissNuisanceOverlays(page);
    },
    async captureSnapshot() {
      return capturePageSnapshot(page);
    },
    async executePreActions(preActions = []) {
      for (const action of preActions) {
        try {
          switch (action) {
            case "scrollToBottom":
              await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
              });
              await page.waitForTimeout(500);
              break;
            case "dismissOverlays":
              await dismissNuisanceOverlays(page);
              break;
            case "waitForLazyLoad":
              // Scroll down in steps to trigger lazy loading
              await page.evaluate(async () => {
                const distance = window.innerHeight / 2;
                const maxScroll = document.body.scrollHeight;
                let scrolled = 0;

                for (let i = 0; scrolled < maxScroll && i < 10; i++) {
                  window.scrollBy(0, distance);
                  scrolled += distance;
                  await new Promise((r) => setTimeout(r, 300));
                }

                window.scrollTo(0, 0);
              });
              break;
            default:
              // Unknown action, ignore
              break;
          }
        } catch {
          // Pre-actions are best-effort
        }
      }
    },
    async waitForManualVerification({ timeoutMs }) {
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        await page.waitForTimeout(2000);

        const snapshot = await capturePageSnapshot(page);

        if (!detectVerificationSignals(snapshot).blocked) {
          return snapshot;
        }
      }

      return null;
    },
    async autoSolveChallenge({ timeoutMs = 20000 } = {}) {
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        try {
          const frames = page.frames();
          for (const frame of frames) {
            const url = frame.url();
            if (url.includes("turnstile") || url.includes("challenge") || url.includes("cloudflare")) {
              const frameElement = await frame.frameElement();
              if (frameElement) {
                const box = await frameElement.boundingBox();
                if (box) {
                  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
                  await page.waitForTimeout(parseInt(Math.random() * 200) + 100);
                  await page.mouse.down();
                  await page.waitForTimeout(parseInt(Math.random() * 100) + 50);
                  await page.mouse.up();
                }
              }
            }
          }
        } catch (e) {}

        await page.waitForTimeout(2000);

        const snapshot = await capturePageSnapshot(page);

        if (!detectVerificationSignals(snapshot).blocked) {
          return snapshot;
        }
      }

      return null;
    },
    async collectSections(selectors) {
      return collectSectionsBySelectors(page, selectors);
    },
    async saveStorageState() {
      if (!storageStatePath) {
        return;
      }

      mkdirSync(dirname(storageStatePath), {
        recursive: true
      });
      await context.storageState({
        path: storageStatePath
      });
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  };
}
