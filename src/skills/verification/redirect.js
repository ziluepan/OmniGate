/**
 * 重定向检测 skill
 *
 * 检测页面是否发生了非预期的重定向（如跳转到验证页、登录页、404页等）。
 * 当检测到重定向时，返回原始 URL vs 实际 URL 的差异信息。
 */

import { VERIFICATION_TYPES } from "../types.js";

const PRIMARY_INDICATORS = [
  /\b404\b/iu,
  /\bnot found\b/iu,
  /\bpage not found\b/iu,
  // 中文
  /\u9875\u9762\u4e0d\u5b58\u5728/iu,   // 页面不存在
  /\u627e\u4e0d\u5230\u9875\u9762/iu,   // 找不到页面
  /\u767b\u5f55\u9875/iu,                // 登录页
  /\u8bf7\u5148\u767b\u5f55/iu,          // 请先登录
  /\u60a8\u9700\u8981\u767b\u5f55/iu,    // 您需要登录
  /\u767b\u5f55\u540e\u624d\u80fd(?:\u8bbf\u95ee|\u9605\u8bfb|\u67e5\u770b|\u7ee7\u7eed)/iu
];

const LEADING_LOGIN_WALL_INDICATORS = [
  /^\s*\u8bf7\u5148\u767b\u5f55/iu,
  /^\s*\u8bf7\u767b\u5f55/iu,
  /^\s*\u60a8\u9700\u8981\u767b\u5f55/iu,
  /\u767b\u5f55\u540e\u624d\u80fd(?:\u8bbf\u95ee|\u9605\u8bfb|\u67e5\u770b|\u7ee7\u7eed)/iu,
  /^\s*\u9875\u9762\u4e0d\u5b58\u5728/iu,
  /^\s*\u627e\u4e0d\u5230\u9875\u9762/iu,
  /^\s*404\b/iu
];

export const redirectVerificationSkill = {
  name: "redirect",
  description:
    "重定向检测 — 检测页面是否被重定向到验证/登录/404页面",

  /**
   * 检测重定向
   */
  detect(snapshot) {
    const primaryHaystack = [
      snapshot?.title ?? "",
      ...(snapshot?.headings ?? []).slice(0, 5)
    ]
      .join("\n")
      .toLowerCase();
    const bodyText = (
      snapshot?.fullVisibleText ??
      snapshot?.visibleText ??
      ""
    )
      .trim()
      .toLowerCase();
    const leadingBodyText = bodyText.slice(0, 240);
    const bodyLooksThin = bodyText.length > 0 && bodyText.length <= 1200;
    const hasFewSections =
      !Array.isArray(snapshot?.sectionCandidates) ||
      snapshot.sectionCandidates.length <= 1;

    const matched = PRIMARY_INDICATORS.filter((pattern) =>
      pattern.test(primaryHaystack)
    );

    if (matched.length > 0) {
      return {
        blocked: true,
        type: VERIFICATION_TYPES.REDIRECT,
        signals: matched.map((p) => p.source)
      };
    }

    const leadingMatched = LEADING_LOGIN_WALL_INDICATORS.filter((pattern) =>
      pattern.test(leadingBodyText)
    );

    if (leadingMatched.length > 0 && bodyLooksThin && hasFewSections) {
      return {
        blocked: true,
        type: VERIFICATION_TYPES.REDIRECT,
        signals: leadingMatched.map((pattern) => pattern.source)
      };
    }

    return { blocked: false };
  },

  /**
   * 重定向通常无法"解决"，建议使用 readable mirror 或手动处理
   */
  async solve(_context) {
    return {
      solved: false,
      reason: "页面发生了非预期重定向，建议使用 --readable-mirror 或检查 URL"
    };
  }
};
