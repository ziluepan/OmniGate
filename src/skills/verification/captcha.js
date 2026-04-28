/**
 * CAPTCHA 验证 skill
 *
 * 检测页面上的 CAPTCHA 验证（reCAPTCHA、hCaptcha、图形验证码等）。
 * CAPTCHA 通常无法自动解决，需要手动介入或使用外部服务。
 */

import { VERIFICATION_TYPES } from "../types.js";

const CAPTCHA_PATTERNS = [
  /\bcaptcha\b/iu,
  /\brecaptcha\b/iu,
  /\bhcaptcha\b/iu,
  /verify (that )?you are human/iu,
  // 中文
  /\u4eba\u006d\u0069\u0061\u006f\u9a8c\u8bc1/iu, // 人机验证
  /\u884ba\u006f\u006e\u0067\u9a8c\u8bc1/iu,       // 行为验证
  /\u8bf7\u5b8c\u6210\u9a8c\u8bc1/iu,               // 请完成验证
  /\u9a8c\u8bc1\u60a8\u662f\u4eba\u7c7b/iu,         // 验证您是人类
  /\u5b89\u5168\u9a8c\u8bc1/iu,                      // 安全验证
  /\u56fe\u7247\u9a8c\u8bc1\u7801/iu                 // 图片验证码
];

const CAPTCHA_UI_SELECTORS = [
  '[data-sitekey]',
  '.g-recaptcha',
  '.h-captcha',
  '#captcha',
  '#recaptcha',
  'iframe[src*="captcha"]',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'input[name="captcha"]',
  'img[src*="captcha"]'
];

export const captchaVerificationSkill = {
  name: "captcha",
  description:
    "CAPTCHA 验证检测 — 检测 reCAPTCHA/hCaptcha/图形验证码，需要手动介入",

  /**
   * 检测 CAPTCHA 验证
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

    const textMatch = CAPTCHA_PATTERNS.filter((p) => p.test(haystack));

    if (textMatch.length > 0) {
      return {
        blocked: true,
        type: VERIFICATION_TYPES.CAPTCHA,
        signals: textMatch.map((p) => p.source)
      };
    }

    // 也检查 iframe sources 中的 CAPTCHA 关键词
    const iframeSources = snapshot?.iframeSources ?? [];

    for (const src of iframeSources) {
      for (const pattern of [
        /\bcaptcha\b/iu,
        /\brecaptcha\b/iu,
        /\bhcaptcha\b/iu
      ]) {
        if (pattern.test(src)) {
          return {
            blocked: true,
            type: VERIFICATION_TYPES.CAPTCHA,
            signals: [`iframe: ${src}`]
          };
        }
      }
    }

    return { blocked: false };
  },

  /**
   * CAPTCHA 无法自动解决
   */
  async solve(_context) {
    return {
      solved: false,
      reason:
        "CAPTCHA 验证不支持自动解决，请使用 --manual-auth 手动处理或使用 --readable-mirror"
    };
  }
};
