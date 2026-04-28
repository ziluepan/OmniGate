/**
 * generic-page skill
 *
 * 通用页面 skill — 保留原有 AI 驱动的提取流程。
 * 这是 fallback skill，当没有其他 skill 匹配时使用。
 *
 * 行为等同于当前 workflow 的默认处理：
 * 1. AI 分析页面结构 → 选择提取策略
 * 2. 按选择器收集区块
 * 3. AI 提取结构化数据
 */

import {
  EXTRACTION_MODES,
  OUTPUT_SHAPES,
  WAIT_TYPES,
  PRE_ACTIONS
} from "../types.js";

export const genericPageSkill = {
  name: "generic-page",
  description:
    "通用页面提取 — AI 分析页面结构后自动选择合适的提取策略",

  /**
   * 通用 skill 匹配所有未被其他 skill 覆盖的请求
   */
  matchIntent(_userQuery, _snapshot) {
    return { match: true };
  },

  /**
   * 等待策略：等待页面完全加载
   */
  waitStrategy: {
    type: WAIT_TYPES.LOAD,
    timeout: 10000
  },

  /**
   * 预处理动作：只关掉遮罩
   */
  preActions: [PRE_ACTIONS.DISMISS_OVERLAYS],

  /**
   * 提取策略：由 AI 分析页面结构决定
   */
  extractStrategy: {
    selectors: [],
    mode: EXTRACTION_MODES.FULL_TEXT,
    outputShape: OUTPUT_SHAPES.OBJECT
  },

  /**
   * 无需后处理
   */
  postProcess(rawText) {
    return rawText;
  }
};
