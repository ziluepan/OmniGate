import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCrawlerConfig, parseEnvText } from "../src/config.js";

test("parseEnvText parses comments, quotes and raw values", () => {
  const parsed = parseEnvText(`
# comment
AI_API_URL="https://example.com/v1/chat/completions"
AI_MODEL=gpt-4.1-mini
AI_API_KEY='secret'
AI_TIMEOUT_MS=45000
CRAWLER_ENABLE_READABLE_MIRROR_FALLBACK=yes
`);

  assert.deepEqual(parsed, {
    AI_API_URL: "https://example.com/v1/chat/completions",
    AI_MODEL: "gpt-4.1-mini",
    AI_API_KEY: "secret",
    AI_TIMEOUT_MS: "45000",
    CRAWLER_ENABLE_READABLE_MIRROR_FALLBACK: "yes"
  });
});

test("loadCrawlerConfig reads .env values and normalizes numbers", () => {
  const tempDirectoryPath = mkdtempSync(join(tmpdir(), "aicrawler-config-"));

  try {
    writeFileSync(
      join(tempDirectoryPath, ".env"),
      [
        "AI_API_URL=https://example.com/v1/chat/completions",
        "AI_MODEL=gpt-4.1-mini",
        "AI_API_KEY=test-key",
        "AI_TIMEOUT_MS=15000",
        "CRAWLER_NAVIGATION_TIMEOUT_MS=45000",
        "CRAWLER_MANUAL_AUTH_TIMEOUT_MS=90000",
        "CRAWLER_ENABLE_READABLE_MIRROR_FALLBACK=true",
        "CRAWLER_READABLE_MIRROR_BASE_URL=https://r.jina.ai/http://",
        "CRAWLER_READABLE_MIRROR_TIMEOUT_MS=12000",
        "CRAWLER_STORAGE_STATE_PATH=.state.json",
        "CRAWLER_BROWSER_EXECUTABLE_PATH=/usr/bin/google-chrome"
      ].join("\n"),
      "utf8"
    );

    const config = loadCrawlerConfig({
      cwd: tempDirectoryPath,
      env: {}
    });

    assert.equal(config.aiApiUrl, "https://example.com/v1/chat/completions");
    assert.equal(config.aiModel, "gpt-4.1-mini");
    assert.equal(config.aiApiKey, "test-key");
    assert.equal(config.aiTimeoutMs, 15000);
    assert.equal(config.navigationTimeoutMs, 45000);
    assert.equal(config.manualAuthTimeoutMs, 90000);
    assert.equal(config.readableMirrorEnabled, true);
    assert.equal(config.readableMirrorBaseUrl, "https://r.jina.ai/http://");
    assert.equal(config.readableMirrorTimeoutMs, 12000);
    assert.match(config.storageStatePath, /\.state\.json$/);
    assert.equal(config.browserExecutablePath, "/usr/bin/google-chrome");
  } finally {
    rmSync(tempDirectoryPath, { recursive: true, force: true });
  }
});

test("loadCrawlerConfig throws when required AI settings are missing", () => {
  const tempDirectoryPath = mkdtempSync(join(tmpdir(), "aicrawler-config-missing-"));

  try {
    assert.throws(
      () =>
        loadCrawlerConfig({
          cwd: tempDirectoryPath,
          env: {}
        }),
      /AI_API_URL, AI_MODEL, AI_API_KEY/
    );
  } finally {
    rmSync(tempDirectoryPath, { recursive: true, force: true });
  }
});
