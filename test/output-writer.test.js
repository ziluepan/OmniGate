import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createOutputFileName,
  formatRunResult,
  formatSavedTextResult,
  writeRunResult
} from "../src/output-writer.js";

test("createOutputFileName includes timestamp, pid, hrtime and uuid", () => {
  const fileName = createOutputFileName({
    now: new Date("2026-04-29T10:11:12.345Z"),
    processId: 4321,
    hrtimeNs: 9876543210123456789n,
    uuid: "123e4567-e89b-12d3-a456-426614174000"
  });

  assert.equal(
    fileName,
    "run-20260429T101112345Z-p4321-t09876543210123456789-123e4567-e89b-12d3-a456-426614174000.txt"
  );
});

test("formatRunResult renders text output for text mode", () => {
  const rendered = formatRunResult({
    outputMode: "text",
    result: {
      status: "ok",
      url: "https://example.com/page",
      title: "示例页面",
      mode: "extract",
      data: "提取结果"
    }
  });

  assert.equal(
    rendered,
    [
      "状态: ok",
      "页面: 示例页面",
      "提取结果"
    ].join("\n")
  );
});

test("formatSavedTextResult prefers raw article text over run metadata", () => {
  const rendered = formatSavedTextResult({
    status: "ok",
    url: "https://example.com/article",
    title: "示例文章",
    mode: "extract",
    tool: "extract",
    data: "文章标题\n\n第一段。\n\n第二段。"
  });

  assert.equal(
    rendered,
    "文章标题\n\n第一段。\n\n第二段。"
  );
});

test("writeRunResult writes txt files into the output directory and retries on collisions", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "aicrawler-output-"));

  try {
    const outputDirectory = join(tempDirectory, "output");
    const duplicateFilePath = join(outputDirectory, "duplicate.txt");

    mkdirSync(outputDirectory, {
      recursive: true
    });
    writeFileSync(duplicateFilePath, "existing", "utf8");

    let callCount = 0;
    const writtenPath = await writeRunResult({
      cwd: tempDirectory,
      outputMode: "json",
      result: {
        status: "ok",
        url: "https://example.com/page",
        title: "Example",
        mode: "extract",
        tool: "extract",
        data: "Widget 标题\n\nWidget 正文",
        confidence: 0.9
      },
      createFileName() {
        callCount += 1;

        if (callCount < 3) {
          return "duplicate.txt";
        }

        return "unique.txt";
      }
    });

    assert.equal(writtenPath, join(outputDirectory, "unique.txt"));
    assert.equal(callCount, 3);
    assert.equal(
      readFileSync(writtenPath, "utf8"),
      "Widget 标题\n\nWidget 正文"
    );
  } finally {
    rmSync(tempDirectory, {
      recursive: true,
      force: true
    });
  }
});
