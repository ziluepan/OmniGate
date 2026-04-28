import {
  normalizeTaskToolName,
  TASK_TOOL_NAMES
} from "./task-router.js";

function readOptionalInteger(rawValue) {
  if (rawValue === undefined) {
    return undefined;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsedValue) ? parsedValue : Number.NaN;
}

export function parseArguments(argv) {
  const parsed = {
    headful: false,
    manualAuth: false,
    readableMirror: false,
    fullContent: false,
    outputMode: "json",
    crawl: false,
    sameOriginOnly: true,
    includePatterns: [],
    excludePatterns: [],
    budgetEntries: [],
    roundRobinDomains: false
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

    if (currentValue === "--crawl") {
      parsed.crawl = true;
      continue;
    }

    if (currentValue === "--tool") {
      parsed.tool = argv[index + 1];
      index += 1;
      continue;
    }

    if (currentValue === "--max-pages") {
      parsed.maxPages = readOptionalInteger(argv[index + 1]);
      index += 1;
      continue;
    }

    if (currentValue === "--max-depth") {
      parsed.maxDepth = readOptionalInteger(argv[index + 1]);
      index += 1;
      continue;
    }

    if (currentValue === "--include") {
      parsed.includePatterns = [
        ...parsed.includePatterns,
        argv[index + 1]
      ];
      index += 1;
      continue;
    }

    if (currentValue === "--exclude") {
      parsed.excludePatterns = [
        ...parsed.excludePatterns,
        argv[index + 1]
      ];
      index += 1;
      continue;
    }

    if (currentValue === "--budget") {
      parsed.budgetEntries = [
        ...parsed.budgetEntries,
        argv[index + 1]
      ];
      index += 1;
      continue;
    }

    if (currentValue === "--allow-external") {
      parsed.sameOriginOnly = false;
      continue;
    }

    if (currentValue === "--round-robin-domains") {
      parsed.roundRobinDomains = true;
      continue;
    }

    if (currentValue === "--help" || currentValue === "-h") {
      parsed.help = true;
    }
  }

  return parsed;
}

export function validateCliArguments(argumentsObject) {
  if (
    argumentsObject.tool !== undefined &&
    normalizeTaskToolName(argumentsObject.tool) === null
  ) {
    throw new Error(
      `--tool must be one of: ${Object.values(TASK_TOOL_NAMES).join(", ")}`
    );
  }

  if (argumentsObject.manualAuth && !argumentsObject.headful) {
    throw new Error("--manual-auth requires --headful so you can complete verification.");
  }

  if (
    argumentsObject.maxPages !== undefined &&
    (!Number.isInteger(argumentsObject.maxPages) || argumentsObject.maxPages <= 0)
  ) {
    throw new Error("--max-pages must be a positive integer.");
  }

  if (
    argumentsObject.maxDepth !== undefined &&
    (!Number.isInteger(argumentsObject.maxDepth) || argumentsObject.maxDepth < 0)
  ) {
    throw new Error("--max-depth must be a non-negative integer.");
  }
}
