import test from "node:test";
import assert from "node:assert/strict";

import {
  CompositeSnapshotProvider,
  DirectHttpSnapshotProvider
} from "../src/http-snapshot.js";

test("DirectHttpSnapshotProvider fetches a public html page and extracts snapshot fields", async () => {
  const provider = new DirectHttpSnapshotProvider(
    {},
    async (url) => {
      assert.equal(
        url,
        "https://blog.evalbug.com/2015/11/05/python_chaos_hello_world/"
      );

      return new Response(
        `<!doctype html>
        <html lang="zh-CN">
          <head>
            <title>Python 里的混沌 Hello World</title>
            <meta name="description" content="一篇关于 Python 混沌 Hello World 的文章。">
          </head>
          <body>
            <main>
              <article>
                <h1>Python 里的混沌 Hello World</h1>
                <p>作者：Evalbug</p>
                <p>这是正文第一段。</p>
                <p>这是正文第二段。</p>
                <a href="/archive">归档</a>
                <a href="https://blog.evalbug.com/about#team">关于</a>
              </article>
            </main>
          </body>
        </html>`,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8"
          }
        }
      );
    }
  );

  const result = await provider.fetch({
    url: "https://blog.evalbug.com/2015/11/05/python_chaos_hello_world/"
  });

  assert.equal(result.source, "http_fetch");
  assert.equal(result.snapshot.title, "Python 里的混沌 Hello World");
  assert.equal(
    result.snapshot.metaDescription,
    "一篇关于 Python 混沌 Hello World 的文章。"
  );
  assert.deepEqual(result.snapshot.headings, [
    "Python 里的混沌 Hello World"
  ]);
  assert.match(result.snapshot.fullVisibleText, /这是正文第一段/u);
  assert.deepEqual(result.snapshot.discoveredLinks, [
    "https://blog.evalbug.com/archive",
    "https://blog.evalbug.com/about"
  ]);
});

test("CompositeSnapshotProvider falls through until a provider returns a snapshot", async () => {
  const provider = new CompositeSnapshotProvider([
    {
      async fetch() {
        return null;
      }
    },
    {
      async fetch({ url, browserError }) {
        assert.equal(url, "https://example.com");
        assert.equal(browserError.message, "browser failed");

        return {
          source: "http_fetch",
          snapshot: {
            url,
            title: "Example",
            visibleText: "Example",
            fullVisibleText: "Example",
            headings: [],
            buttonTexts: [],
            iframeSources: [],
            sectionCandidates: []
          }
        };
      }
    }
  ]);

  const result = await provider.fetch({
    url: "https://example.com",
    browserError: new Error("browser failed")
  });

  assert.equal(result.source, "http_fetch");
  assert.equal(result.snapshot.title, "Example");
});
