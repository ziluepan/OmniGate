import test from "node:test";
import assert from "node:assert/strict";

import {
  capturePageSnapshot,
  collectSectionsBySelectors
} from "../src/page-snapshot.js";

test("capturePageSnapshot evaluates without passing extra arguments", async () => {
  const page = {
    async evaluate(pageFunction) {
      assert.equal(arguments.length, 1);
      assert.equal(typeof pageFunction, "function");
      return {
        title: "Example"
      };
    }
  };

  const result = await capturePageSnapshot(page);

  assert.deepEqual(result, {
    title: "Example"
  });
});

test("collectSectionsBySelectors passes selectors and options as a single serialized argument", async () => {
  const page = {
    async evaluate(pageFunction, payload) {
      assert.equal(arguments.length, 2);
      assert.equal(typeof pageFunction, "function");
      assert.deepEqual(payload, {
        selectors: ["article", ".chapter"],
        options: {
          maxMatches: 40,
          maxTextLength: 120000,
          mergeMatches: true,
          preserveFormatting: true
        }
      });

      return [
        {
          selector: "article",
          text: "content"
        }
      ];
    }
  };

  const result = await collectSectionsBySelectors(
    page,
    ["article", ".chapter"],
    {
      maxMatches: 40,
      maxTextLength: 120000,
      mergeMatches: true,
      preserveFormatting: true
    }
  );

  assert.deepEqual(result, [
    {
      selector: "article",
      text: "content"
    }
  ]);
});
