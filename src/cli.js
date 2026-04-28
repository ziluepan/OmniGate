import { parseArguments, validateCliArguments } from "./cli-args.js";
import { loadCrawlerConfig } from "./config.js";
import { OpenAiCompatibleAiClient } from "./llm-client.js";
import { createPlaywrightSession } from "./playwright-session.js";
import { ReadableMirrorSnapshotProvider } from "./readable-mirror.js";
import { SkillRegistry } from "./skills/registry.js";
import { novelChapterSkill } from "./skills/builtin/novel-chapter.js";
import { genericPageSkill } from "./skills/builtin/generic-page.js";
import { cloudflareVerificationSkill } from "./skills/verification/cloudflare.js";
import { captchaVerificationSkill } from "./skills/verification/captcha.js";
import { redirectVerificationSkill } from "./skills/verification/redirect.js";
import { normalizeHttpUrl } from "./url-utils.js";
import { runCrawlerWorkflow, runSiteCrawlerWorkflow } from "./workflow.js";

function printUsage() {
  console.log(`
用法:
  npm start -- --url <页面地址> --query <提取需求> [--headful] [--manual-auth] [--readable-mirror] [--full-content] [--text]
  npm start -- --url <站点地址> --query <提取需求> --crawl [--max-pages <数量>] [--max-depth <层级>] [--include <模式>] [--exclude <模式>] [--budget <前缀=数量>]

示例:
  npm start -- --url https://example.com --query "提取标题、价格和简介"
  npm start -- --url https://example.com --query "抓正文" --headful --manual-auth
  npm start -- --url https://www.69shuba.com/txt/15054/29814105 --query "这页是什么内容？" --readable-mirror
  npm start -- --url https://www.69shuba.com/txt/15054/29814105 --query "直接返回全部内容" --readable-mirror --full-content --text
  npm start -- --url https://example.com --query "汇总站内产品标题" --crawl --max-pages 20 --max-depth 2 --exclude "*privacy*"
`);
}

function printTextResult(result) {
  console.log(`状态: ${result.status}`);
  console.log(`页面: ${result.title || result.url}`);

  if (result.mode === "crawl") {
    console.log(`抓取页面数: ${result.pageCount}`);

    for (const page of result.pages ?? []) {
      console.log(
        `- [${page.status}] depth=${page.depth} ${page.title || page.url}`
      );
    }

    if (result.data !== undefined) {
      console.log(JSON.stringify(result.data, null, 2));
    }
    return;
  }

  if (result.status === "blocked") {
    console.log(`原因: ${result.reason}`);
    console.log(`信号: ${result.signals.join(", ")}`);
    return;
  }

  if (typeof result.data === "string") {
    console.log(result.data);
    return;
  }

  console.log(JSON.stringify(result.data, null, 2));
}

async function main() {
  const argumentsObject = parseArguments(process.argv.slice(2));

  if (argumentsObject.help || !argumentsObject.url || !argumentsObject.query) {
    printUsage();
    process.exitCode = argumentsObject.help ? 0 : 1;
    return;
  }

  validateCliArguments(argumentsObject);

  const config = loadCrawlerConfig();

  // Initialize skill registry with built-in content skills and verification skills
  const registry = new SkillRegistry();
  registry.register(novelChapterSkill);
  registry.register(genericPageSkill);
  registry.registerVerification(cloudflareVerificationSkill);
  registry.registerVerification(captchaVerificationSkill);
  registry.registerVerification(redirectVerificationSkill);

  const normalizedUrl = normalizeHttpUrl(argumentsObject.url);
  const session = await createPlaywrightSession({
    navigationTimeoutMs: config.navigationTimeoutMs,
    storageStatePath: config.storageStatePath,
    browserExecutablePath: config.browserExecutablePath,
    headless: !argumentsObject.headful
  });
  const aiClient = new OpenAiCompatibleAiClient(config);
  const readableMirrorProvider = new ReadableMirrorSnapshotProvider({
    enabled:
      argumentsObject.readableMirror || config.readableMirrorEnabled,
    baseUrl: config.readableMirrorBaseUrl,
    timeoutMs: config.readableMirrorTimeoutMs
  });
  const workflowOptions = {
    allowManualVerification: argumentsObject.manualAuth,
    manualAuthTimeoutMs: config.manualAuthTimeoutMs,
    persistStorageState: argumentsObject.manualAuth,
    returnFullContent: argumentsObject.fullContent
  };
  const result = argumentsObject.crawl
    ? await runSiteCrawlerWorkflow({
        session,
        fallbackSnapshotProvider: readableMirrorProvider,
        aiClient,
        url: normalizedUrl,
        userQuery: argumentsObject.query,
        options: workflowOptions,
        registry,
        crawlOptions: {
          maxPages: argumentsObject.maxPages,
          maxDepth: argumentsObject.maxDepth,
          sameOriginOnly: argumentsObject.sameOriginOnly,
          includePatterns: argumentsObject.includePatterns,
          excludePatterns: argumentsObject.excludePatterns,
          budgetEntries: argumentsObject.budgetEntries,
          roundRobinDomains: argumentsObject.roundRobinDomains
        }
      })
    : await runCrawlerWorkflow({
        session,
        fallbackSnapshotProvider: readableMirrorProvider,
        aiClient,
        url: normalizedUrl,
        userQuery: argumentsObject.query,
        options: workflowOptions,
        registry
      });

  if (argumentsObject.outputMode === "text") {
    printTextResult(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  if (result.status === "blocked") {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
