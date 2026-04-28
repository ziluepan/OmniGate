/**
 * 统一验证处理层
 *
 * 替代原有零散的验证处理逻辑，将检测、分类、解决集中到一个模块。
 * 这是三层决策系统的 Layer 3。
 *
 * 流程：
 *   检测 → 分类 → 匹配验证 skill → 尝试解决 → 返回结果
 */

import { VERIFICATION_TYPES } from "./skills/types.js";

/**
 * 处理页面验证
 *
 * @param {Object} params
 * @param {Object} params.page - Playwright page 对象
 * @param {Object} params.snapshot - 当前页面快照
 * @param {import("./skills/registry.js").SkillRegistry} params.registry - SkillRegistry
 * @param {Object} [params.options] - 选项
 * @param {boolean} [params.options.allowManualVerification] - 是否允许手动验证
 * @param {number} [params.options.manualAuthTimeoutMs] - 手动验证超时
 * @param {Object} [params.options.session] - 会话对象（有 autoSolveChallenge、waitForManualVerification 方法）
 * @returns {Promise<{blocked: boolean, type: string, action: string, snapshot: Object|null}>}
 */
export async function handleVerification({
  page,
  snapshot,
  registry,
  options = {}
}) {
  // 先用现有 detection 检查
  const { detectVerificationSignals } = await import("./verification.js");
  const legacyDetection = detectVerificationSignals(snapshot);

  if (!legacyDetection.blocked) {
    return {
      blocked: false,
      type: VERIFICATION_TYPES.NONE,
      action: "none",
      snapshot
    };
  }

  // 用 registry 中的 verification skills 进行更精确的分类
  const verification = registry.detectVerification(snapshot);

  // 如果没有找到匹配的 verification handler，使用 legacy 结果
  if (!verification.blocked || !verification.handler) {
    return {
      blocked: true,
      type: "unknown",
      action: "retry",
      snapshot
    };
  }

  // CF 验证：优先使用 session 已有的 autoSolveChallenge
  if (verification.type === VERIFICATION_TYPES.CLOUDFLARE) {
    if (
      options.session &&
      typeof options.session.autoSolveChallenge === "function"
    ) {
      const unlocked = await options.session.autoSolveChallenge({
        timeoutMs: 20000
      });

      if (unlocked) {
        return {
          blocked: false,
          type: verification.type,
          action: "auto_solve",
          snapshot: unlocked
        };
      }
    }

    // 尝试用 verification handler 解决
    const solved = await verification.handler.solve({
      page,
      timeoutMs: 30000
    });

    if (solved?.solved) {
      return {
        blocked: false,
        type: verification.type,
        action: solved.method ?? "solved",
        snapshot: null // 调用方需要重取快照
      };
    }
  }

  // 需要手动验证
  if (options.allowManualVerification) {
    if (
      options.session &&
      typeof options.session.waitForManualVerification === "function"
    ) {
      const unlocked = await options.session.waitForManualVerification({
        timeoutMs: options.manualAuthTimeoutMs ?? 120000
      });

      if (unlocked) {
        return {
          blocked: false,
          type: verification.type,
          action: "manual_solve",
          snapshot: unlocked
        };
      }
    }
  }

  // 无法解决
  return {
    blocked: true,
    type: verification.type,
    action: "abort",
    snapshot
  };
}

/**
 * 检查快照内容是否足够（用于判断是否需要重试）
 *
 * @param {Object} snapshot - 页面快照
 * @param {number} [minTextLength=100] - 最少文本长度
 * @returns {{ sufficient: boolean, reason: string }}
 */
export function checkContentSufficiency(snapshot, minTextLength = 100) {
  const fullText = snapshot?.fullVisibleText ?? "";
  const visibleText = snapshot?.visibleText ?? "";

  if (fullText.length >= minTextLength) {
    return { sufficient: true, reason: "" };
  }

  if (visibleText.length >= minTextLength) {
    return { sufficient: true, reason: "" };
  }

  return {
    sufficient: false,
    reason: `页面文本不足（${fullText.length} / ${visibleText.length} 字符），可能仍在加载`
  };
}
