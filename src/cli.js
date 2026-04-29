import { parseArguments, validateCliArguments } from "./cli-args.js";
import { loadCrawlerConfig } from "./config.js";
import {
  CompositeSnapshotProvider,
  DirectHttpSnapshotProvider
} from "./http-snapshot.js";
import { OpenAiCompatibleAiClient } from "./llm-client.js";
import {
  formatRunResult,
  writeRunResult
} from "./output-writer.js";
import { createPlaywrightSession } from "./playwright-session.js";
import { ReadableMirrorSnapshotProvider } from "./readable-mirror.js";
import { registerBuiltInSkills } from "./skills/bootstrap.js";
import { SkillRegistry } from "./skills/registry.js";
import { normalizeHttpUrl } from "./url-utils.js";
import { runTaskWorkflow } from "./workflow.js";

function printUsage() {
  console.log(`
用法:
  npm start -- --url <页面地址> --query <提取需求> [--tool <auto|extract|full_content|links|crawl>] [--headful] [--manual-auth] [--readable-mirror] [--full-content] [--text]
  npm start -- --url <站点地址> --query <提取需求> --crawl [--max-pages <数量>] [--max-depth <层级>] [--include <模式>] [--exclude <模式>] [--budget <前缀=数量>]

示例:
  npm start -- --url https://example.com --query "提取标题、价格和简介"
  npm start -- --url https://example.com --query "抓正文" --headful --manual-auth
  npm start -- --url https://www.69shuba.com/txt/15054/29814105 --query "这页是什么内容？" --readable-mirror
  npm start -- --url https://www.69shuba.com/txt/15054/29814105 --query "直接返回全部内容" --readable-mirror --full-content --text
  npm start -- --url https://example.com/docs --query "列出这页所有链接" --tool links
  npm start -- --url https://example.com --query "汇总站内产品标题" --crawl --max-pages 20 --max-depth 2 --exclude "*privacy*"
`);
}

async function writeAndReportRunResult({
  result,
  outputMode
}) {
  const filePath = await writeRunResult({
    result,
    outputMode
  });
  console.error(`[aicrawler] Run result saved to ${filePath}`);
}

function printRunResult({
  result,
  outputMode
}) {
  console.log(
    formatRunResult({
      result,
      outputMode
    })
  );
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
  registerBuiltInSkills(registry);

  const normalizedUrl = normalizeHttpUrl(argumentsObject.url);
  const directHttpProvider = new DirectHttpSnapshotProvider({
    timeoutMs: config.navigationTimeoutMs
  });
  const readableMirrorProvider = new ReadableMirrorSnapshotProvider({
    enabled:
      argumentsObject.readableMirror || config.readableMirrorEnabled,
    baseUrl: config.readableMirrorBaseUrl,
    timeoutMs: config.readableMirrorTimeoutMs
  });
  const fallbackSnapshotProvider =
    argumentsObject.readableMirror || config.readableMirrorEnabled
      ? new CompositeSnapshotProvider([
          directHttpProvider,
          readableMirrorProvider
        ])
      : directHttpProvider;
  let session = null;
  let sessionError = null;
  let browserWarningPrinted = false;

  async function getSession() {
    if (session) {
      return session;
    }

    if (sessionError) {
      throw sessionError;
    }

    try {
      session = await createPlaywrightSession({
        navigationTimeoutMs: config.navigationTimeoutMs,
        storageStatePath: config.storageStatePath,
        browserExecutablePath: config.browserExecutablePath,
        headless: !argumentsObject.headful
      });

      return session;
    } catch (error) {
      sessionError =
        error instanceof Error ? error : new Error(String(error));

      if (!browserWarningPrinted) {
        console.warn(
          `[aicrawler] Browser session unavailable, falling back to HTTP snapshots: ${sessionError.message}`
        );
        browserWarningPrinted = true;
      }

      throw sessionError;
    }
  }

  const aiClient = new OpenAiCompatibleAiClient({
    ...config,
    onStatus(message) {
      console.error(`[aicrawler] ${message}`);
    }
  });
  const workflowOptions = {
    allowManualVerification: argumentsObject.manualAuth,
    manualAuthTimeoutMs: config.manualAuthTimeoutMs,
    persistStorageState: argumentsObject.manualAuth,
    returnFullContent: argumentsObject.fullContent
  };
  const result = await runTaskWorkflow({
    session,
    getSession,
    initialSnapshotProvider: directHttpProvider,
    fallbackSnapshotProvider,
    aiClient,
    url: normalizedUrl,
    userQuery: argumentsObject.query,
    explicitTool: argumentsObject.tool,
    crawl: argumentsObject.crawl,
    options: workflowOptions,
    crawlOptions: {
      maxPages: argumentsObject.maxPages,
      maxDepth: argumentsObject.maxDepth,
      sameOriginOnly: argumentsObject.sameOriginOnly,
      includePatterns: argumentsObject.includePatterns,
      excludePatterns: argumentsObject.excludePatterns,
      budgetEntries: argumentsObject.budgetEntries,
      roundRobinDomains: argumentsObject.roundRobinDomains
    },
    registry
  });

  printRunResult({
    result,
    outputMode: argumentsObject.outputMode
  });
  await writeAndReportRunResult({
    result,
    outputMode: argumentsObject.outputMode
  });

  if (result.status === "blocked") {
    process.exitCode = 2;
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);

  try {
    await writeAndReportRunResult({
      result: {
        status: "error",
        url: "",
        title: "",
        mode: "cli_error",
        tool: "cli_error",
        data: {
          message
        },
        confidence: null
      },
      outputMode: "text"
    });
  } catch (writeError) {
    const writeErrorMessage =
      writeError instanceof Error ? writeError.message : String(writeError);
    console.error(`[aicrawler] Failed to save run result: ${writeErrorMessage}`);
  }

  process.exitCode = 1;
});
