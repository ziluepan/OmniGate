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

function buildStructurePrompts({ userQuery, snapshot }) {
  return {
    systemPrompt: [
      "你是网页结构分析器。",
      "只基于给定的页面摘要判断哪些区域最可能包含用户要的信息。",
      "不要假设你能绕过登录、验证码或任何安全校验。",
      "只输出 JSON，格式为：",
      '{"targetSectionSelectors":["css selector"],"extractionMode":"sections|full_text","outputShape":"object|array|text","reason":"简短说明"}'
    ].join("\n"),
    userPrompt: [
      `用户目标：${userQuery}`,
      "页面摘要：",
      buildSnapshotSummary(snapshot)
    ].join("\n\n")
  };
}

function buildExtractionPrompts({ userQuery, snapshot, sections, plan }) {
  return {
    systemPrompt: [
      "你是网页信息抽取器。",
      "根据用户目标，从提供的网页正文和候选区块中提取结果。",
      "如果内容不足，就尽量返回能确认的字段，不要编造。",
      '只输出 JSON，格式为：{"answer": 数据提取结果, "confidence": 0.95, "notes": ["可选说明"]}',
      '注意：answer 字段的数据类型必须与 extraction plan 中的 outputShape 匹配。如果是 text，answer 就是一个字符串；如果是 array，就是数组；否则是对象。'
    ].join("\n"),
    userPrompt: [
      `用户目标：${userQuery}`,
      `抽取策略：${JSON.stringify(plan, null, 2)}`,
      "页面摘要：",
      buildSnapshotSummary(snapshot),
      "已选区块：",
      JSON.stringify(sections ?? [], null, 2)
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

  async analyzeStructure({ userQuery, snapshot }) {
    const prompts = buildStructurePrompts({
      userQuery,
      snapshot
    });

    return this.#requestJson(prompts);
  }

  async extractContent({ userQuery, snapshot, plan, sections }) {
    const prompts = buildExtractionPrompts({
      userQuery,
      snapshot,
      plan,
      sections
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
