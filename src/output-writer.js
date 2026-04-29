import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

function sanitizeTimestamp(rawTimestamp) {
  return rawTimestamp.replace(/[-:.]/gu, "").replace(/Z$/u, "Z");
}

export function formatTextResult(result) {
  const lines = [
    `状态: ${result.status}`,
    `页面: ${result.title || result.url}`
  ];

  if (result.status === "blocked") {
    lines.push(`原因: ${result.reason}`);
    lines.push(`信号: ${result.signals.join(", ")}`);
    return lines.join("\n");
  }

  if (result.mode === "crawl") {
    lines.push(`抓取页面数: ${result.pageCount}`);

    for (const page of result.pages ?? []) {
      lines.push(`- [${page.status}] depth=${page.depth} ${page.title || page.url}`);
    }

    if (result.data !== undefined) {
      lines.push(JSON.stringify(result.data, null, 2));
    }

    return lines.join("\n");
  }

  if (result.mode === "links") {
    lines.push(`链接数量: ${result.data?.count ?? 0}`);
    lines.push(JSON.stringify(result.data?.links ?? [], null, 2));
    return lines.join("\n");
  }

  if (typeof result.data === "string") {
    lines.push(result.data);
    return lines.join("\n");
  }

  lines.push(JSON.stringify(result.data, null, 2));
  return lines.join("\n");
}

function indentText(rawText, prefix = "  ") {
  return rawText
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function formatStructuredText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const renderedEntry = formatStructuredText(entry);

        if (!renderedEntry) {
          return "-";
        }

        if (
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean"
        ) {
          return `- ${renderedEntry}`;
        }

        return `-\n${indentText(renderedEntry)}`;
      })
      .join("\n");
  }

  return Object.entries(value)
    .map(([key, entryValue]) => {
      const renderedEntry = formatStructuredText(entryValue);

      if (
        typeof entryValue === "string" ||
        typeof entryValue === "number" ||
        typeof entryValue === "boolean"
      ) {
        return `${key}: ${renderedEntry}`;
      }

      if (!renderedEntry) {
        return `${key}:`;
      }

      return `${key}:\n${indentText(renderedEntry)}`;
    })
    .join("\n");
}

export function formatSavedTextResult(result) {
  if (result.status === "blocked") {
    return [
      `状态: ${result.status}`,
      `页面: ${result.title || result.url}`,
      `原因: ${result.reason}`,
      `信号: ${result.signals.join(", ")}`
    ].join("\n");
  }

  if (typeof result.data === "string" && result.data.trim().length > 0) {
    return result.data;
  }

  if (result.mode === "links") {
    return (result.data?.links ?? []).join("\n");
  }

  if (result.mode === "crawl" && Array.isArray(result.pages)) {
    const synthesizedData = formatStructuredText(result.data);
    const pagesSummary = result.pages
      .map((page) => `- [${page.status}] depth=${page.depth} ${page.title || page.url}`)
      .join("\n");

    return [
      result.title || result.url,
      "",
      "页面列表：",
      pagesSummary,
      synthesizedData ? `\n汇总结果：\n${synthesizedData}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  const structuredData = formatStructuredText(result.data);

  if (!structuredData) {
    return [
      `状态: ${result.status}`,
      `页面: ${result.title || result.url}`
    ].join("\n");
  }

  return structuredData;
}

export function formatRunResult({
  result,
  outputMode = "json"
}) {
  if (outputMode === "text") {
    return formatTextResult(result);
  }

  return JSON.stringify(result, null, 2);
}

export function createOutputFileName({
  now = new Date(),
  processId = process.pid,
  hrtimeNs = process.hrtime.bigint(),
  uuid = randomUUID()
} = {}) {
  const timestamp = sanitizeTimestamp(now.toISOString());
  const normalizedHrtime = String(hrtimeNs).padStart(20, "0");

  return `run-${timestamp}-p${processId}-t${normalizedHrtime}-${uuid}.txt`;
}

export async function writeRunResult({
  result,
  outputMode = "json",
  cwd = process.cwd(),
  outputDirName = "output",
  createFileName = createOutputFileName,
  mkdirImplementation = mkdir,
  writeFileImplementation = writeFile
}) {
  const outputDirectoryPath = resolve(cwd, outputDirName);
  const renderedResult = formatSavedTextResult(result);

  await mkdirImplementation(outputDirectoryPath, {
    recursive: true
  });

  for (;;) {
    const fileName = createFileName();
    const filePath = join(outputDirectoryPath, fileName);

    try {
      await writeFileImplementation(filePath, renderedResult, {
        encoding: "utf8",
        flag: "wx"
      });
      return filePath;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") {
        continue;
      }

      throw error;
    }
  }
}
