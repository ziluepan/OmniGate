async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const DEFAULT_OPTIONS = {
  pollIntervalMs: 1500,
  manualResolutionTimeoutMs: 2 * 60 * 1000,
  maxSnippetLength: 2000,
};

export class ChallengeAwareController {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.state = "running";
  }

  getState() {
    return this.state;
  }

  async detectChallenge(page) {
    const title = await safe(() => page.title(), "");
    const html = await safe(() => page.content(), "");
    const bodyText = await safe(() => page.locator("body").innerText(), "");

    const matchedText =
      /captcha|challenge|verify you are human|access denied|security check/i.test(
        [title, bodyText.slice(0, 4000)].join("\n"),
      );

    const matchedUi = await this.hasChallengeUi(page);

    if (!matchedText && !matchedUi) {
      return null;
    }

    await this.setState("challenge_blocked");

    return {
      url: page.url(),
      title,
      detectedAt: new Date().toISOString(),
      htmlSnippet: html.slice(0, this.options.maxSnippetLength),
    };
  }

  async handleChallenge(page, event, notify) {
    await this.setState("challenge_blocked");
    await notify(event);

    return {
      status: "blocked",
      reason: "challenge_detected",
      retryable: false,
      applySolution: async (token) => {
        if (this.state !== "challenge_blocked") {
          return {
            status: this.state === "running" ? "running" : "challenge_blocked",
            manualReference: token,
            message: "No active challenge.",
          };
        }

        return this.waitForManualResolution(page, token);
      },
    };
  }

  async waitForManualResolution(page, manualReference) {
    const deadline = Date.now() + this.options.manualResolutionTimeoutMs;

    while (Date.now() < deadline) {
      const stillBlocked = await this.isChallengePresent(page);

      if (!stillBlocked) {
        await this.setState("running");
        return {
          status: "running",
          manualReference,
          message: "Manual verification detected; crawler resumed.",
        };
      }

      await page.waitForTimeout(this.options.pollIntervalMs);
    }

    return {
      status: "challenge_blocked",
      manualReference,
      message: "Timed out waiting for manual verification.",
    };
  }

  async isChallengePresent(page) {
    const textMatch = await this.hasChallengeText(page);
    const uiMatch = await this.hasChallengeUi(page);
    return textMatch || uiMatch;
  }

  async hasChallengeText(page) {
    const title = await safe(() => page.title(), "");
    const bodyText = await safe(() => page.locator("body").innerText(), "");

    return /captcha|challenge|verify you are human|access denied|security check|请完成验证/i.test(
      [title, bodyText.slice(0, 4000)].join("\n")
    );
  }

  async hasChallengeUi(page) {
    const selectors = [
      'iframe[src*="captcha"]',
      'iframe[src*="challenge"]',
      '[data-sitekey]',
      'form[action*="captcha"]',
      'input[name*="captcha"]',
      '#challenge-stage'
    ];

    for (const selector of selectors) {
      const count = await safe(() => page.locator(selector).count(), 0);
      if (count > 0) {
        return true;
      }
    }

    return false;
  }

  async setState(next) {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    if (typeof this.options.onStateChange === "function") {
      await this.options.onStateChange(next, prev);
    }
  }
}
