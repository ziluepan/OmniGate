import { loadCrawlerConfig } from "./config.js";
import { OpenAiCompatibleAiClient } from "./llm-client.js";
import { createPlaywrightSession } from "./playwright-session.js";
import { ReadableMirrorSnapshotProvider } from "./readable-mirror.js";
import { normalizeHttpUrl } from "./url-utils.js";
import { runCrawlerWorkflow } from "./workflow.js";

function printUsage() {
  console.log(`
用法:
  npm start -- --url <页面地址> --query <提取需求> [--headful] [--manual-auth] [--readable-mirror] [--full-content] [--text]

示例:
  npm start -- --url https://example.com --query "提取标题、价格和简介"
  npm start -- --url https://example.com --query "抓正文" --headful --manual-auth
  npm start -- --url https://www.69shuba.com/txt/15054/29814105 --query "这页是什么内容？" --readable-mirror
  npm start -- --url https://www.69shuba.com/txt/15054/29814105 --query "直接返回全部内容" --readable-mirror --full-content --text
`);
}

function parseArguments(argv) {
  const parsed = {
    headful: false,
    manualAuth: false,
    readableMirror: false,
    fullContent: false,
    outputMode: "json"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const currentValue = argv[index];

    if (currentValue === "--url") {
      parsed.url = argv[index + 1];
      index += 1;
      continue;
    }

    if (currentValue === "--query") {
      parsed.query = argv[index + 1];
      index += 1;
      continue;
    }

    if (currentValue === "--headful") {
      parsed.headful = true;
      continue;
    }

    if (currentValue === "--manual-auth") {
      parsed.manualAuth = true;
      continue;
    }

    if (currentValue === "--readable-mirror") {
      parsed.readableMirror = true;
      continue;
    }

    if (currentValue === "--full-content") {
      parsed.fullContent = true;
      continue;
    }

    if (currentValue === "--text") {
      parsed.outputMode = "text";
      continue;
    }

    if (currentValue === "--help" || currentValue === "-h") {
      parsed.help = true;
    }
  }

  return parsed;
}

function printTextResult(result) {
  console.log(`状态: ${result.status}`);
  console.log(`页面: ${result.title || result.url}`);

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

  if (argumentsObject.manualAuth && !argumentsObject.headful) {
    throw new Error("--manual-auth requires --headful so you can complete verification.");
  }

  const config = loadCrawlerConfig();
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
  const result = await runCrawlerWorkflow({
    session,
    fallbackSnapshotProvider: readableMirrorProvider,
    aiClient,
    url: normalizedUrl,
    userQuery: argumentsObject.query,
    options: {
      allowManualVerification: argumentsObject.manualAuth,
      manualAuthTimeoutMs: config.manualAuthTimeoutMs,
      persistStorageState: argumentsObject.manualAuth,
      returnFullContent: argumentsObject.fullContent
    }
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
