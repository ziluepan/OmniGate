import test from "node:test";
import assert from "node:assert/strict";

import { OpenAiCompatibleAiClient } from "../src/llm-client.js";

function createJsonResponse(data) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(data)
          }
        }
      ]
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    }
  );
}

function createClientWithCapturedRequests() {
  const requests = [];
  const client = new OpenAiCompatibleAiClient(
    {
      aiApiUrl: "https://example.com/v1/chat/completions",
      aiApiKey: "test-key",
      aiModel: "test-model",
      aiTimeoutMs: 5000
    },
    async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return createJsonResponse({
        answer: {},
        confidence: 0.9,
        notes: []
      });
    }
  );

  return {
    client,
    requests
  };
}

test("analyzeStructure frames skill hints as guidance rather than hard constraints", async () => {
  const { client, requests } = createClientWithCapturedRequests();

  await client.analyzeStructure({
    userQuery: "提取商品标题和价格",
    snapshot: {
      url: "https://example.com/products/widget-1",
      title: "Widget 1",
      visibleText: "Widget 1 售价 99 元"
    },
    skillExtractStrategy: {
      selectors: [".product-detail", "main"],
      mode: "sections",
      outputShape: "object"
    }
  });

  const systemPrompt = requests[0].messages[0].content;

  assert.match(systemPrompt, /这些建议只是提示，不是硬约束/u);
  assert.match(systemPrompt, /可以自主选择 full_text/u);
});

test("extractContent keeps the AI in control when section hints are incomplete", async () => {
  const { client, requests } = createClientWithCapturedRequests();

  await client.extractContent({
    userQuery: "整理这页的所有核心链接",
    snapshot: {
      url: "https://example.com/docs",
      title: "Docs",
      headings: ["Docs"],
      linkSamples: [
        {
          text: "Start",
          href: "https://example.com/docs/start"
        }
      ],
      fullVisibleText: "文档首页。开始使用。API 参考。"
    },
    plan: {
      targetSectionSelectors: ["main"],
      extractionMode: "sections",
      outputShape: "array",
      reason: "main looks relevant"
    },
    sections: [],
    extractionPrompt: "这是一篇文档页。"
  });

  const systemPrompt = requests[0].messages[0].content;
  const userPrompt = requests[0].messages[1].content;

  assert.match(systemPrompt, /已选区块和场景提示只是辅助信息，不是硬约束/u);
  assert.match(systemPrompt, /如果区块不完整、提示不准确、或页面类型与预判不一致，以你的实际判断为准/u);
  assert.match(userPrompt, /linkSamples/u);
});

test("AI client emits progress updates while waiting for a response", async () => {
  const statusMessages = [];
  const client = new OpenAiCompatibleAiClient(
    {
      aiApiUrl: "https://example.com/v1/chat/completions",
      aiApiKey: "test-key",
      aiModel: "test-model",
      aiTimeoutMs: 5000,
      aiProgressIntervalMs: 5,
      onStatus(message) {
        statusMessages.push(message);
      }
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));

      return createJsonResponse({
        targetSectionSelectors: [],
        extractionMode: "full_text",
        outputShape: "object",
        reason: "ok"
      });
    }
  );

  await client.analyzeStructure({
    userQuery: "提取内容",
    snapshot: {
      url: "https://example.com",
      title: "Example",
      visibleText: "Example"
    }
  });

  assert.ok(statusMessages.some((message) => /analyzing page structure/i.test(message)));
  assert.ok(statusMessages.some((message) => /still waiting/i.test(message)));
  assert.ok(statusMessages.some((message) => /completed/i.test(message)));
});
