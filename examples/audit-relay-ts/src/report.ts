import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { computeScore, sortFindings } from "./findings.js";
import type { AuditRelayReport, Finding, Severity } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function severityLabel(severity: Severity): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    case "pass":
      return "Pass";
    default: {
      const _exhaustive: never = severity;
      return _exhaustive;
    }
  }
}

function severityClass(severity: Severity): string {
  return `pill pill-${severity}`;
}

function renderFindingCards(findings: Finding[]): string {
  const actionable = sortFindings(findings).filter((f) => f.severity !== "pass");
  if (actionable.length === 0) {
    return `<p class="empty">No blocking issues detected in this pass.</p>`;
  }

  return actionable
    .map(
      (finding) => `
      <article class="finding ${finding.severity}">
        <div class="finding-top">
          <span class="${severityClass(finding.severity)}">${severityLabel(finding.severity)}</span>
          <span class="category">${escapeHtml(finding.category)}</span>
        </div>
        <h3>${escapeHtml(finding.title)}</h3>
        <p>${escapeHtml(finding.detail)}</p>
        <p class="rec"><strong>Fix:</strong> ${escapeHtml(finding.recommendation)}</p>
      </article>`,
    )
    .join("\n");
}

function renderHeaderTable(headers: AuditRelayReport["sandbox"]["headers"]): string {
  return headers
    .map(
      (header) => `
      <tr>
        <td><code>${escapeHtml(header.name)}</code></td>
        <td>${header.present ? "Yes" : "No"}</td>
        <td>${header.value ? escapeHtml(header.value) : "—"}</td>
      </tr>`,
    )
    .join("\n");
}

function renderScreenshots(pages: AuditRelayReport["browser"]["pages"]): string {
  return pages
    .map(
      (page, index) => `
      <figure class="shot">
        <img src="data:image/png;base64,${page.screenshotBase64}" alt="Screenshot ${index + 1}" loading="lazy" />
        <figcaption>
          <strong>${escapeHtml(page.title || "Untitled")}</strong>
          <span>${escapeHtml(page.url)}</span>
        </figcaption>
      </figure>`,
    )
    .join("\n");
}

export function buildHtmlReport(report: AuditRelayReport): string {
  const findings = sortFindings(report.findings);
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const passCount = findings.filter((f) => f.severity === "pass").length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AuditRelay — ${escapeHtml(report.targetUrl)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0A0B0D;
      --card: #12131A;
      --line: #242633;
      --text: #E8EAF0;
      --muted: #9AA3B2;
      --accent: #00C8FF;
      --accent-2: #40FF78;
      --critical: #FF5A5A;
      --high: #FF9F43;
      --medium: #FFD166;
      --low: #8E9AAF;
      --pass: #40FF78;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Space Grotesk", system-ui, sans-serif;
      background: radial-gradient(circle at top, #151826 0%, var(--bg) 45%);
      color: var(--text);
      line-height: 1.5;
    }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 32px 20px 64px; }
    .hero {
      background: linear-gradient(135deg, rgba(0,200,255,0.08), rgba(64,255,120,0.05));
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 28px;
      animation: rise 0.6s ease both;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .eyebrow {
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
    }
    h1 { margin: 8px 0 6px; font-size: clamp(1.8rem, 4vw, 2.6rem); }
    .sub { color: var(--muted); margin: 0 0 18px; }
    .score-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-top: 18px;
    }
    .stat {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
    }
    .stat strong { display: block; font-size: 1.6rem; }
    .stat span { color: var(--muted); font-size: 0.92rem; }
    section {
      margin-top: 28px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 22px;
      animation: rise 0.7s ease both;
    }
    h2 { margin: 0 0 14px; font-size: 1.25rem; }
    .grid { display: grid; gap: 16px; }
    .finding {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      background: rgba(255,255,255,0.02);
    }
    .finding h3 { margin: 8px 0 6px; font-size: 1rem; }
    .finding-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .pill {
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 999px;
      text-transform: uppercase;
    }
    .pill-critical { background: rgba(255,90,90,0.15); color: var(--critical); }
    .pill-high { background: rgba(255,159,67,0.15); color: var(--high); }
    .pill-medium { background: rgba(255,209,102,0.15); color: var(--medium); }
    .pill-low { background: rgba(142,154,175,0.15); color: var(--low); }
    .pill-pass { background: rgba(64,255,120,0.12); color: var(--pass); }
    .category { color: var(--muted); font-size: 0.85rem; }
    .rec { color: var(--muted); margin-bottom: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    th, td { border-bottom: 1px solid var(--line); padding: 10px 8px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 500; }
    code { font-family: "JetBrains Mono", monospace; font-size: 0.85em; }
    .shots { display: grid; gap: 18px; }
    .shot img {
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--line);
      display: block;
    }
    .shot figcaption { margin-top: 8px; display: grid; gap: 4px; color: var(--muted); font-size: 0.9rem; }
    .meta { color: var(--muted); font-size: 0.92rem; }
    .cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 18px; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 18px;
      border-radius: 999px;
      text-decoration: none;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .btn-primary { background: var(--accent); color: #041018; }
    .btn-secondary { border-color: var(--line); color: var(--text); }
    footer {
      margin-top: 28px;
      text-align: center;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .empty { color: var(--muted); }
    @media (max-width: 640px) {
      .wrap { padding: 20px 14px 48px; }
      section, .hero { padding: 18px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <p class="eyebrow">AuditRelay · Solari Browser + Sandbox</p>
      <h1>${escapeHtml(report.targetUrl)}</h1>
      <p class="sub">Automated client audit generated ${escapeHtml(new Date(report.auditedAt).toLocaleString())} in ${Math.round(report.durationMs / 1000)}s.</p>
      <div class="score-row">
        <div class="stat"><strong>${report.score}</strong><span>Health score</span></div>
        <div class="stat"><strong>${criticalCount}</strong><span>Critical</span></div>
        <div class="stat"><strong>${highCount}</strong><span>High</span></div>
        <div class="stat"><strong>${passCount}</strong><span>Checks passed</span></div>
      </div>
      <div class="cta-row">
        ${report.browser.replayUrl ? `<a class="btn btn-primary" href="${escapeHtml(report.browser.replayUrl)}" target="_blank" rel="noreferrer">Watch Solari replay</a>` : ""}
        <a class="btn btn-secondary" href="https://digitalalchemy.dev" target="_blank" rel="noreferrer">digitalalchemy.dev</a>
        <a class="btn btn-secondary" href="https://beacons.ai/dbcreations" target="_blank" rel="noreferrer">Work with Desi</a>
      </div>
    </header>

    <section>
      <h2>Priority findings</h2>
      <div class="grid">${renderFindingCards(findings)}</div>
    </section>

    <section>
      <h2>Security headers (sandbox curl)</h2>
      <table>
        <thead><tr><th>Header</th><th>Present</th><th>Value</th></tr></thead>
        <tbody>${renderHeaderTable(report.sandbox.headers)}</tbody>
      </table>
      <p class="meta">TLS redirect: ${report.sandbox.tlsRedirect ? "Yes" : "No"}${report.sandbox.serverBanner ? ` · Server: ${escapeHtml(report.sandbox.serverBanner)}` : ""}</p>
    </section>

    <section>
      <h2>Browser captures</h2>
      <p class="meta">Session ${escapeHtml(report.browser.sessionId)} · ${report.browser.pages.length} page(s) captured with stealth browser + recording.</p>
      <div class="shots">${renderScreenshots(report.browser.pages)}</div>
    </section>

    <footer>
      Built by <a href="https://github.com/buildwithdesi/solari-cookbook" style="color: var(--accent);">Desi Baker</a> for the Solari hiring challenge · Powered by <a href="https://getsolari.com" style="color: var(--accent);">Solari</a>
    </footer>
  </div>
</body>
</html>`;
}

export async function writeReportArtifacts(
  report: AuditRelayReport,
  outputDir: string,
): Promise<{ htmlPath: string; jsonPath: string }> {
  await mkdir(outputDir, { recursive: true });

  const htmlPath = path.join(outputDir, "audit-report.html");
  const jsonPath = path.join(outputDir, "audit-report.json");

  const jsonSafe = {
    ...report,
    browser: {
      ...report.browser,
      pages: report.browser.pages.map((page) => ({
        ...page,
        screenshotBase64: `[${page.screenshotBase64.length} chars omitted in JSON export]`,
      })),
    },
  };

  await writeFile(htmlPath, buildHtmlReport(report), "utf8");
  await writeFile(jsonPath, JSON.stringify(jsonSafe, null, 2), "utf8");

  return { htmlPath, jsonPath };
}

export function finalizeReport(
  targetUrl: string,
  startedAt: number,
  browser: AuditRelayReport["browser"],
  sandbox: AuditRelayReport["sandbox"],
): AuditRelayReport {
  const findings = sortFindings([...browser.findings, ...sandbox.findings]);
  return {
    targetUrl,
    auditedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    browser,
    sandbox,
    findings,
    score: computeScore(findings),
  };
}
