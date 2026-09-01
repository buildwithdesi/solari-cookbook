import type { Finding, HeaderCheck, PageSnapshot, Severity } from "./types.js";

const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
] as const;

export function severityRank(severity: Severity): number {
  switch (severity) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    case "pass":
      return 4;
    default: {
      const _exhaustive: never = severity;
      return _exhaustive;
    }
  }
}

export function findingsFromHeaders(headers: HeaderCheck[]): Finding[] {
  const findings: Finding[] = [];

  for (const header of headers) {
    if (header.present) {
      findings.push({
        id: `header-pass-${header.name}`,
        severity: "pass",
        category: "Headers",
        title: `${header.name} is set`,
        detail: header.value ?? "Present",
        recommendation: "Keep this header on every response.",
      });
      continue;
    }

    const severity: Severity =
      header.name === "strict-transport-security" ||
      header.name === "content-security-policy"
        ? "high"
        : "medium";

    findings.push({
      id: `header-missing-${header.name}`,
      severity,
      category: "Headers",
      title: `${header.name} is missing`,
      detail: "Response did not include this security header.",
      recommendation: `Add ${header.name} at the edge or in your app middleware.`,
    });
  }

  return findings;
}

export function findingsFromPage(page: PageSnapshot, isHttps: boolean): Finding[] {
  const findings: Finding[] = [];

  if (page.passwordFieldCount > 0 && !isHttps) {
    findings.push({
      id: `page-password-http-${page.url}`,
      severity: "critical",
      category: "Transport",
      title: "Password field on non-HTTPS page",
      detail: `${page.passwordFieldCount} password field(s) on ${page.url}.`,
      recommendation: "Force HTTPS before any credential input.",
    });
  }

  if (page.scriptCount > 15) {
    findings.push({
      id: `page-script-heavy-${page.url}`,
      severity: "medium",
      category: "Surface",
      title: "Heavy third-party script load",
      detail: `${page.scriptCount} script tags detected.`,
      recommendation: "Audit third-party scripts and defer non-critical loads.",
    });
  }

  if (!page.metaDescription) {
    findings.push({
      id: `page-meta-${page.url}`,
      severity: "low",
      category: "SEO",
      title: "Missing meta description",
      detail: "No meta description tag found on this page.",
      recommendation: "Add a concise meta description for search and social previews.",
    });
  }

  if (!page.h1) {
    findings.push({
      id: `page-h1-${page.url}`,
      severity: "low",
      category: "Accessibility",
      title: "Missing H1",
      detail: "No H1 heading found on the page.",
      recommendation: "Add one clear H1 that states the page purpose.",
    });
  }

  return findings;
}

export function findingsFromTlsRedirect(tlsRedirect: boolean, url: string): Finding[] {
  if (tlsRedirect) {
    return [
      {
        id: "tls-redirect-pass",
        severity: "pass",
        category: "Transport",
        title: "HTTP redirects to HTTPS",
        detail: `http://${new URL(url).host} upgrades to HTTPS.`,
        recommendation: "Keep redirect and add HSTS for repeat visitors.",
      },
    ];
  }

  return [
    {
      id: "tls-redirect-fail",
      severity: "high",
      category: "Transport",
      title: "HTTP does not redirect to HTTPS",
      detail: "Plain HTTP did not upgrade to TLS.",
      recommendation: "Add a permanent redirect from HTTP to HTTPS.",
    },
  ];
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const unique: Finding[] = [];
  for (const finding of findings) {
    if (seen.has(finding.id)) continue;
    seen.add(finding.id);
    unique.push(finding);
  }
  return unique;
}

export function computeScore(findings: Finding[]): number {
  let score = 100;
  for (const finding of findings) {
    switch (finding.severity) {
      case "critical":
        score -= 25;
        break;
      case "high":
        score -= 12;
        break;
      case "medium":
        score -= 6;
        break;
      case "low":
        score -= 2;
        break;
      case "pass":
        break;
      default: {
        const _exhaustive: never = finding.severity;
        void _exhaustive;
      }
    }
  }
  return Math.max(0, Math.min(100, score));
}

export function scoreVerdict(score: number): string {
  if (score >= 85) return "Strong posture. Ship with minor polish.";
  if (score >= 70) return "Solid base. Fix high items before client handoff.";
  if (score >= 50) return "Needs work. Address transport and header gaps first.";
  return "High risk. Treat as pre-production.";
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );
}

export function requiredHeaders(): readonly string[] {
  return SECURITY_HEADERS;
}
