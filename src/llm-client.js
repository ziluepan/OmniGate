function extractMessageText(payload) {
  const firstChoice = payload?.choices?.[0]?.message?.content;

  if (typeof firstChoice === "string") {
    return firstChoice;
  }

  if (Array.isArray(firstChoice)) {
    return firstChoice
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part?.type === "text" && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("\n");
  }

  return "";
}

function extractJsonText(modelText) {
  const fencedJsonMatch = modelText.match(/```json\s*([\s\S]+?)```/iu);

  if (fencedJsonMatch) {
    return fencedJsonMatch[1].trim();
  }

  const firstBraceIndex = modelText.indexOf("{");
  const lastBraceIndex = modelText.lastIndexOf("}");

  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return modelText.slice(firstBraceIndex, lastBraceIndex + 1);
  }

  throw new Error("Model response did not contain a JSON object.");
}

function truncateText(rawText, maxLength) {
  return rawText.length <= maxLength ? rawText : `${rawText.slice(0, maxLength)}…`;
}

function buildSnapshotSummary(snapshot) {
  return JSON.stringify(
    {
      url: snapshot?.url ?? "",
      title: snapshot?.title ?? "",
      metaDescription: snapshot?.metaDescription ?? "",
      headings: snapshot?.headings ?? [],
      buttonTexts: snapshot?.buttonTexts ?? [],
      sectionCandidates: snapshot?.sectionCandidates ?? [],
      linkSamples: snapshot?.linkSamples ?? [],
      visibleText: truncateText(snapshot?.visibleText ?? "", 12000)
    },
    null,
    2
  );
}

function buildStructurePrompts({ userQuery, snapshot, skillExtractStrategy }) {
  const systemLines = [
    "你是网页结构分析器。",
    "只基于给定的页面摘要判断哪些区域最可能包含用户要的信息。",
    "不要假设你能绕过登录、验证码或任何安全校验。",
    "只输出 JSON，格式为：",
    '{"targetSectionSelectors":["css selector"],"extractionMode":"sections|full_text","outputShape":"object|array|text","reason":"简短说明"}'
  ];

  // 注入 skill 的提取策略作为强提示
  if (skillExtractStrategy) {
    const hints = [];
    if (
      Array.isArray(skillExtractStrategy.selectors) &&
      skillExtractStrategy.selectors.length > 0
    ) {
      hints.push(
        `优先尝试这些选择器：${JSON.stringify(skillExtractStrategy.selectors.slice(0, 8))}`
      );
    }

    if (
      skillExtractStrategy.mode &&
      skillExtractStrategy.outputShape
    ) {
      hints.push(
        `建议：extractionMode=${skillExtractStrategy.mode}, outputShape=${skillExtractStrategy.outputShape}`
      );
    }

    if (hints.length > 0) {
      systemLines.push("", "--- 场景特定建议 ---", ...hints);
    }
  }

  return {
    systemPrompt: systemLines.join("\n"),
    userPrompt: [
      `用户目标：${userQuery}`,
      "页面摘要：",
      buildSnapshotSummary(snapshot)
    ].join("\n\n")
  };
}

function buildExtractionPrompts({
  userQuery,
  snapshot,
  sections,
  plan,
  extractionPrompt
}) {
  const fullBodyText = snapshot?.fullVisibleText ?? "";

  // 对于 full_text 模式的 text 输出（如小说章节），发送完整正文
  const isFullTextMode =
    plan?.extractionMode === "full_text" && plan?.outputShape === "text";

  // 分段发送策略：每段最多 30K 字符，LLM 自行拼接
  const maxChunkSize = isFullTextMode ? 120000 : 60000;
  const bodyTextSnippet =
    fullBodyText.length > maxChunkSize
      ? `${fullBodyText.slice(0, maxChunkSize)}…`
      : fullBodyText;

  const systemPromptLines = [
    "你是网页信息抽取器。",
    "根据用户目标，从提供的网页正文中完整提取结果，不要省略或截断任何内容。",
    "如果用户要小说内容，就把章节正文原样返回，不要总结、不要省略。",
    "如果内容不足，就尽量返回能确认的字段，不要编造。",
    '只输出 JSON，格式为：{"answer": 数据提取结果, "confidence": 0.95, "notes": ["可选说明"]}',
    '注意：answer 字段的数据类型必须与 extraction plan 中的 outputShape 匹配。如果是 text，answer 就是一个长字符串；如果是 array，就是数组；否则是对象。',
    "对于 text 类型的 answer，请返回完整的原文内容，不要截断。"
  ];

  // 注入 skill 特定的提取提示
  if (typeof extractionPrompt === "string" && extractionPrompt.length > 0) {
    systemPromptLines.push("", "--- 场景特定指引 ---", extractionPrompt);
  }

  const systemPrompt = systemPromptLines.join("\n");

  return {
    systemPrompt,
    userPrompt: [
      `用户目标：${userQuery}`,
      `抽取策略：${JSON.stringify(plan, null, 2)}`,
      "页面信息：",
      JSON.stringify(
        {
          url: snapshot?.url ?? "",
          title: snapshot?.title ?? "",
          headings: snapshot?.headings ?? []
        },
        null,
        2
      ),
      "已选区块（聚焦内容）：",
      JSON.stringify(sections ?? [], null, 2),
      "页面全文（可能包含导航/广告等噪声）：",
      bodyTextSnippet
    ].join("\n\n")
  };
}

function buildIntentPrompts({ userQuery, snapshot, skillDescriptions }) {
  return {
    systemPrompt: [
      "你是意图分析器。",
      "根据用户查询和页面信息，判断用户想做什么类型的抓取，匹配合适的 skill。",
      "只输出 JSON，格式为：",
      '{"skill": "skill名称", "confidence": 0.0-1.0, "params": {}, "reason": "简短说明"}',
      "可用的 skill 列表：",
      ...skillDescriptions.map(
        (s) => `- ${s.name}: ${s.description}`
      )
    ].join("\n"),
    userPrompt: [
      `用户查询：${userQuery}`,
      "页面信息：",
      JSON.stringify(
        {
          url: snapshot?.url ?? "",
          title: snapshot?.title ?? "",
          headings: (snapshot?.headings ?? []).slice(0, 5)
        },
        null,
        2
      )
    ].join("\n\n")
  };
}

function buildCrawlSynthesisPrompts({ startUrl, userQuery, pages }) {
  return {
    systemPrompt: [
      "你是站点级抓取结果汇总器。",
      "输入是多个页面的抽取结果，请按用户目标去重、归并并保留关键差异。",
      "如果信息不足，只返回能够确认的内容，不要编造。",
      '只输出 JSON，格式为：{"answer": 数据汇总结果, "confidence": 0.9, "notes": ["可选说明"]}'
    ].join("\n"),
    userPrompt: [
      `起始地址：${startUrl}`,
      `用户目标：${userQuery}`,
      "页面结果：",
      JSON.stringify(
        pages.map((page) => ({
          url: page.url,
          title: page.title,
          status: page.status,
          depth: page.depth,
          contentSource: page.contentSource,
          data: page.data,
          confidence: page.confidence
        })),
        null,
        2
      )
    ].join("\n\n")
  };
}

export class OpenAiCompatibleAiClient {
  constructor(config, fetchImplementation = globalThis.fetch) {
    if (typeof fetchImplementation !== "function") {
      throw new Error("A fetch implementation is required.");
    }

    this.config = config;
    this.fetchImplementation = fetchImplementation;
  }

  async analyzeStructure({ userQuery, snapshot, skillExtractStrategy }) {
    const prompts = buildStructurePrompts({
      userQuery,
      snapshot,
      skillExtractStrategy
    });

    return this.#requestJson(prompts);
  }

  async extractContent({ userQuery, snapshot, plan, sections, extractionPrompt }) {
    const prompts = buildExtractionPrompts({
      userQuery,
      snapshot,
      plan,
      sections,
      extractionPrompt
    });

    return this.#requestJson(prompts);
  }

  async analyzeUserIntent({ userQuery, snapshot, skillDescriptions }) {
    const prompts = buildIntentPrompts({
      userQuery,
      snapshot,
      skillDescriptions
    });

    return this.#requestJson(prompts);
  }

  async synthesizeCrawlResults({ startUrl, userQuery, pages }) {
    const prompts = buildCrawlSynthesisPrompts({
      startUrl,
      userQuery,
      pages
    });

    return this.#requestJson(prompts);
  }

  async #requestJson({ systemPrompt, userPrompt }) {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, this.config.aiTimeoutMs);

    try {
      const response = await this.fetchImplementation(this.config.aiApiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.aiApiKey}`
        },
        body: JSON.stringify({
          model: this.config.aiModel,
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: userPrompt
            }
          ]
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const responseText = await response.text();

        throw new Error(
          `AI API request failed with HTTP ${response.status}: ${truncateText(
            responseText,
            400
          )}`
        );
      }

      const payload = await response.json();
      const modelText = extractMessageText(payload);
      const jsonText = extractJsonText(modelText);

      return JSON.parse(jsonText);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
