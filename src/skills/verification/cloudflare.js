/**
 * Cloudflare 验证 skill
 *
 * 检测 Cloudflare 的 JS Challenge / Turnstile / 5-second shield 等。
 * 尝试自动等待验证通过，或通过 human-like 鼠标移动触发验证。
 */

import { VERIFICATION_TYPES } from "../types.js";

const CF_PATTERNS = [
  /\bcloudflare\b/iu,
  /\bchallenge-platform\b/iu,
  /\bturnstile\b/iu,
  /checking your browser/iu,
  /just a moment/iu,
  /ddos protection/iu,
  /ray id/iu,
  /cf-browser-verification/iu
];

export const cloudflareVerificationSkill = {
  name: "cloudflare",
  description:
    "Cloudflare 验证检测与自动等待 — 检测 CF JS Challenge/Turnstile，自动等待验证通过",

  /**
   * 检测 Cloudflare 验证
   */
  detect(snapshot) {
    const haystack = [
      snapshot?.title ?? "",
      snapshot?.visibleText ?? "",
      ...(snapshot?.headings ?? []),
      ...(snapshot?.buttonTexts ?? []),
      ...(snapshot?.iframeSources ?? [])
    ]
      .join("\n")
      .toLowerCase();

    const matched = CF_PATTERNS.filter((p) => p.test(haystack));

    if (matched.length > 0) {
      return {
        blocked: true,
        type: VERIFICATION_TYPES.CLOUDFLARE,
        signals: matched.map((p) => p.source)
      };
    }

    return { blocked: false };
  },

  /**
   * Cloudflare 验证解决策略
   *
   * 1. 等待页面自行通过验证（大多数 CF JS Challenge 会自动通过）
   * 2. 如果检测到 Turnstile iframe，尝试 human-like 鼠标移动+点击
   * 3. 定期检查是否已通过
   */
  async solve({ page, timeoutMs = 30000 }) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        // 检查是否有 Turnstile iframe，尝试交互
        const frames = page.frames();

        for (const frame of frames) {
          const frameUrl = frame.url();

          if (
            frameUrl.includes("turnstile") ||
            frameUrl.includes("challenge") ||
            frameUrl.includes("cloudflare")
          ) {
            const frameElement = await frame.frameElement().catch(() => null);

            if (frameElement) {
              const box = await frameElement.boundingBox().catch(() => null);

              if (box) {
                // Human-like multi-step mouse movement
                await page.mouse.move(
                  box.x + box.width / 2,
                  box.y + box.height / 2,
                  { steps: 10 }
                );
                await page.waitForTimeout(Math.random() * 200 + 100);
                await page.mouse.click(
                  box.x + box.width / 2,
                  box.y + box.height / 2
                );
              }
            }
          }
        }
      } catch {
        // 交互失败，继续等待
      }

      await page.waitForTimeout(2000);

      // 检查是否已通过（标题/正文不再包含 CF 关键词）
      try {
        const cleared = await page.evaluate(() => {
          const body = document.body.innerText.substring(0, 2000).toLowerCase();
          const cfKeywords = [
            "cloudflare",
            "challenge-platform",
            "checking your browser",
            "just a moment",
            "turnstile"
          ];

          return !cfKeywords.some((kw) => body.includes(kw));
        });

        if (cleared) {
          return { solved: true, method: "auto_wait" };
        }
      } catch {
        // 页面可能还在加载
      }
    }

    return { solved: false, reason: "Cloudflare 验证超时未通过" };
  }
};
