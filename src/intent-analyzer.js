/**
 * 意图分析器
 *
 * 使用 LLM 分析用户的自然语言查询，判断用户意图并匹配合适的 skill。
 * 这构成了三层决策系统的 Layer 1。
 *
 * 同时提供一个基于规则的快速匹配回退，避免不必要的 LLM 调用。
 */

/**
 * 使用 LLM 分析用户意图
 *
 * @param {Object} params
 * @param {string} params.userQuery - 用户查询
 * @param {Object} params.snapshot - 页面快照（URL、标题等）
 * @param {Array<{name: string, description: string}>} params.skillDescriptions - 可用的 skill 列表
 * @param {Object} params.aiClient - AI 客户端
 * @returns {Promise<{skill: string|null, confidence: number, params: Object, reason: string}>}
 */
export async function analyzeUserIntent({
  userQuery,
  snapshot,
  skillDescriptions,
  aiClient
}) {
  // 如果 AI 客户端不可用，使用规则匹配
  if (!aiClient || typeof aiClient.analyzeUserIntent !== "function") {
    return ruleBasedIntent({ userQuery, snapshot, skillDescriptions });
  }

  try {
    const intent = await aiClient.analyzeUserIntent({
      userQuery,
      snapshot,
      skillDescriptions
    });

    return {
      skill: intent?.skill ?? null,
      confidence:
        typeof intent?.confidence === "number" ? intent.confidence : 0.5,
      params: intent?.params ?? {},
      reason: intent?.reason ?? ""
    };
  } catch {
    return ruleBasedIntent({ userQuery, snapshot, skillDescriptions });
  }
}

/**
 * 基于规则的快速意图匹配（不依赖 LLM）
 *
 * @param {Object} params
 * @param {string} params.userQuery
 * @param {Object} params.snapshot
 * @param {Array<{name: string, description: string}>} params.skillDescriptions
 * @returns {{skill: string|null, confidence: number, params: Object, reason: string}}
 */
function ruleBasedIntent({ userQuery, snapshot, skillDescriptions }) {
  const url = snapshot?.url ?? "";
  const queryLower = userQuery.toLowerCase();

  // 小说特征
  const novelUrlPatterns = [
    /\u0074\u0078\u0074\//i,      // /txt/
    /\u0063\u0068\u0061\u0070\u0074\u0065\u0072/i, // chapter
    /\u0062\u006f\u006f\u006b\//i, // /book/
    /\u0073\u0068\u0075\u0062\u0061/i, // shuba
    /\u0062\u0069\u0071\u0075\u0067\u0065/i // biquge
  ];

  const novelQueryKeywords = [
    "\u5c0f\u8bf4",     // 小说
    "\u7ae0\u8282",     // 章节
    "\u6b63\u6587",     // 正文
    "chapter",
    "novel",
    "\u539f\u6837"      // 原样
  ];

  const isNovelUrl = novelUrlPatterns.some((p) => p.test(url));
  const isNovelQuery = novelQueryKeywords.some((kw) =>
    queryLower.includes(kw)
  );

  if (isNovelUrl && isNovelQuery) {
    return {
      skill: "novel-chapter",
      confidence: 0.85,
      params: {},
      reason: "URL 和查询都匹配小说章节特征"
    };
  }

  if (isNovelUrl) {
    return {
      skill: "novel-chapter",
      confidence: 0.7,
      params: {},
      reason: "URL 匹配小说站点特征"
    };
  }

  // 默认回退到通用 skill
  return {
    skill: "generic-page",
    confidence: 0.5,
    params: {},
    reason: "未找到特定的匹配规则，使用通用 skill"
  };
}
