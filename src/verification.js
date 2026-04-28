const VERIFICATION_PATTERNS = [
  {
    label: "captcha",
    pattern: /\bcaptcha\b/iu
  },
  {
    label: "verify you are human",
    pattern: /verify (that )?you are human/iu
  },
  {
    label: "security check",
    pattern: /security check/iu
  },
  {
    label: "cloudflare challenge",
    pattern: /cloudflare|challenge-platform/iu
  },
  {
    label: "access denied",
    pattern: /access denied|request blocked|access is temporarily denied|suspected to be a web crawler|疑似爬虫|访问异常/iu
  },
  {
    label: "人机验证",
    pattern: /人机验证|行为验证|请完成验证|验证您是人类|安全验证/iu
  }
];

function normalizeSnapshotText(snapshot) {
  return [
    snapshot?.title ?? "",
    snapshot?.visibleText ?? "",
    ...(snapshot?.headings ?? []),
    ...(snapshot?.buttonTexts ?? []),
    ...(snapshot?.iframeSources ?? [])
  ]
    .join("\n")
    .toLowerCase();
}

export function detectVerificationSignals(snapshot) {
  const haystack = normalizeSnapshotText(snapshot);
  const signals = VERIFICATION_PATTERNS.filter(({ pattern }) =>
    pattern.test(haystack)
  ).map(({ label }) => label);
  const blocked = signals.length > 0;

  return {
    blocked,
    signals,
    reason: blocked
      ? "Detected verification or anti-bot challenge on the page."
      : ""
  };
}
