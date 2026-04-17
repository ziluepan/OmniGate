import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReadableMirrorUrl,
  parseReadableMirrorResponse,
  ReadableMirrorSnapshotProvider
} from "../src/readable-mirror.js";

test("buildReadableMirrorUrl prefixes http urls with the readable mirror endpoint", () => {
  assert.equal(
    buildReadableMirrorUrl("https://www.69shuba.com/txt/15054/29814105"),
    "https://r.jina.ai/http://www.69shuba.com/txt/15054/29814105"
  );
});

test("parseReadableMirrorResponse extracts title, source url and markdown body", () => {
  const parsed = parseReadableMirrorResponse([
    "Title: 一世之尊-第732章 无耻小孟（求月票）-69书吧",
    "",
    "URL Source: http://www.69shuba.com/txt/15054/29814105",
    "",
    "Markdown Content:",
    "2022-08-09 作者： 爱潜水的乌贼",
    "",
    "第732章 无耻小孟（求月票）",
    "",
    "“刘韵陶被义军阵营轮回者击杀，每人扣除一千善功。”"
  ].join("\n"));

  assert.equal(parsed.title, "一世之尊-第732章 无耻小孟（求月票）-69书吧");
  assert.equal(parsed.sourceUrl, "http://www.69shuba.com/txt/15054/29814105");
  assert.match(parsed.markdown, /第732章 无耻小孟/u);
});

test("ReadableMirrorSnapshotProvider fetches a mirror snapshot for blocked public pages", async () => {
  const provider = new ReadableMirrorSnapshotProvider(
    {
      enabled: true,
      baseUrl: "https://r.jina.ai/http://",
      timeoutMs: 5000
    },
    async (url) => {
      assert.equal(
        url,
        "https://r.jina.ai/http://www.69shuba.com/txt/15054/29814105"
      );

      return {
        ok: true,
        async text() {
          return [
            "Title: 一世之尊-第732章 无耻小孟（求月票）-69书吧",
            "",
            "URL Source: http://www.69shuba.com/txt/15054/29814105",
            "",
            "Markdown Content:",
            "2022-08-09 作者： 爱潜水的乌贼",
            "",
            "第732章 无耻小孟（求月票）",
            "",
            "“刘韵陶被义军阵营轮回者击杀，每人扣除一千善功。”"
          ].join("\n")
        }
      };
    }
  );

  const result = await provider.fetch({
    url: "https://www.69shuba.com/txt/15054/29814105"
  });

  assert.equal(result.source, "readable_mirror");
  assert.equal(result.snapshot.title, "一世之尊-第732章 无耻小孟（求月票）-69书吧");
  assert.match(result.snapshot.visibleText, /爱潜水的乌贼/u);
  assert.equal(result.snapshot.headings[0], "第732章 无耻小孟（求月票）");
});
