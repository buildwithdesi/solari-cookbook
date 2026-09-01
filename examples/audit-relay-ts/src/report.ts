import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { computeScore, dedupeFindings, scoreVerdict, sortFindings } from "./findings.js";
import type { AuditRelayReport, Finding, PageSnapshot, Severity } from "./types.js";

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

function scoreTone(score: number): string {
  if (score >= 85) return "good";
  if (score >= 65) return "warn";
  return "bad";
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
          <span class="pill pill-${finding.severity}">${severityLabel(finding.severity)}</span>
          <span class="category">${escapeHtml(finding.category)}</span>
        </div>
        <h3>${escapeHtml(finding.title)}</h3>
        <p>${escapeHtml(finding.detail)}</p>
        <p class="rec"><strong>Fix:</strong> ${escapeHtml(finding.recommendation)}</p>
      </article>`,
    )
    .join("\n");
}

function renderPassedChecks(findings: Finding[]): string {
  const passed = sortFindings(findings).filter((f) => f.severity === "pass");
  if (passed.length === 0) {
    return `<p class="empty">No passing checks recorded.</p>`;
  }

  return passed
    .map(
      (finding) => `
      <li>
        <strong>${escapeHtml(finding.title)}</strong>
        <span>${escapeHtml(finding.detail)}</span>
      </li>`,
    )
    .join("\n");
}

function renderHeaderTable(headers: AuditRelayReport["sandbox"]["headers"]): string {
  return headers
    .map((header) => {
      const status = header.present ? "yes" : "no";
      return `
      <tr class="${status}">
        <td><code>${escapeHtml(header.name)}</code></td>
        <td><span class="status-dot ${status}"></span>${header.present ? "Yes" : "No"}</td>
        <td>${header.value ? escapeHtml(header.value) : "—"}</td>
      </tr>`;
    })
    .join("\n");
}

function renderPageTable(pages: PageSnapshot[]): string {
  return pages
    .map(
      (page) => `
      <tr>
        <td>${escapeHtml(page.title || "Untitled")}</td>
        <td><code>${escapeHtml(new URL(page.url).pathname || "/")}</code></td>
        <td>${page.status ?? "—"}</td>
        <td>${page.scriptCount}</td>
        <td>${page.formCount}</td>
        <td>${page.linkCount}</td>
      </tr>`,
    )
    .join("\n");
}

function renderScreenshots(pages: PageSnapshot[]): string {
  return pages
    .map((page, index) => {
      const src = page.screenshotFile ?? `data:image/png;base64,${page.screenshotBase64}`;
      return `
      <figure class="shot">
        <img src="${escapeHtml(src)}" alt="Screenshot ${index + 1}" loading="lazy" />
        <figcaption>
          <strong>${escapeHtml(page.title || "Untitled")}</strong>
          <span>${escapeHtml(page.url)}</span>
          <span class="shot-meta">${page.scriptCount} scripts · ${page.linkCount} links · HTTP ${page.status ?? "?"}</span>
        </figcaption>
      </figure>`;
    })
    .join("\n");
}

export function buildHtmlReport(report: AuditRelayReport): string {
  const findings = sortFindings(report.findings);
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const mediumCount = findings.filter((f) => f.severity === "medium").length;
  const lowCount = findings.filter((f) => f.severity === "low").length;
  const passCount = findings.filter((f) => f.severity === "pass").length;
  const tone = scoreTone(report.score);

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
      --good: #40FF78;
      --warn: #FFD166;
      --bad: #FF5A5A;
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
      display: grid;
      grid-template-columns: 1.4fr 0.8fr;
      gap: 20px;
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
    h1 { margin: 8px 0 6px; font-size: clamp(1.8rem, 4vw, 2.6rem); word-break: break-word; }
    .sub, .verdict { color: var(--muted); margin: 0; }
    .verdict { margin-top: 10px; font-size: 1.02rem; }
    .score-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
      display: grid;
      place-items: center;
      text-align: center;
      align-self: start;
    }
    .score-ring {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      border: 6px solid color-mix(in srgb, var(--${tone}) 70%, var(--line));
      background: radial-gradient(circle, rgba(255,255,255,0.03), transparent 70%);
    }
    .score-ring strong { font-size: 2rem; line-height: 1; }
    .score-ring span { color: var(--muted); font-size: 0.85rem; }
    .score-row {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
      margin-top: 18px;
    }
    .stat {
      background: rgba(0,0,0,0.18);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      text-align: center;
    }
    .stat strong { display: block; font-size: 1.35rem; }
    .stat span { color: var(--muted); font-size: 0.82rem; }
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
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; min-width: 640px; }
    th, td { border-bottom: 1px solid var(--line); padding: 10px 12px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 500; background: rgba(255,255,255,0.02); }
    tr:last-child td { border-bottom: 0; }
    tr.no td:first-child { color: var(--high); }
    code { font-family: "JetBrains Mono", monospace; font-size: 0.85em; }
    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 8px;
      background: var(--bad);
    }
    .status-dot.yes { background: var(--good); }
    .shots { display: grid; gap: 18px; }
    .shot img {
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--line);
      display: block;
      background: #000;
    }
    .shot figcaption { margin-top: 8px; display: grid; gap: 4px; color: var(--muted); font-size: 0.9rem; }
    .shot-meta { font-family: "JetBrains Mono", monospace; font-size: 0.78rem; }
    .meta { color: var(--muted); font-size: 0.92rem; margin-top: 12px; }
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
    details.passed {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
      background: rgba(255,255,255,0.02);
    }
    details.passed summary {
      cursor: pointer;
      font-weight: 600;
      color: var(--pass);
    }
    details.passed ul {
      margin: 12px 0 0;
      padding-left: 18px;
      color: var(--muted);
    }
    details.passed li { margin-bottom: 10px; }
    details.passed li strong { display: block; color: var(--text); }
    footer {
      margin-top: 28px;
      text-align: center;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .empty { color: var(--muted); }
    @media (max-width: 860px) {
      .hero { grid-template-columns: 1fr; }
      .score-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .wrap { padding: 20px 14px 48px; }
      section, .hero { padding: 18px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <div>
        <p class="eyebrow">AuditRelay · Solari Browser + Sandbox</p>
        <h1>${escapeHtml(report.targetUrl)}</h1>
        <p class="sub">Generated ${escapeHtml(new Date(report.auditedAt).toLocaleString())} · ${Math.round(report.durationMs / 1000)}s total (sandbox ${Math.round(report.sandboxMs / 1000)}s, browser ${Math.round(report.browserMs / 1000)}s)</p>
        <p class="verdict">${escapeHtml(report.verdict)}</p>
        <div class="score-row">
          <div class="stat"><strong>${criticalCount}</strong><span>Critical</span></div>
          <div class="stat"><strong>${highCount}</strong><span>High</span></div>
          <div class="stat"><strong>${mediumCount}</strong><span>Medium</span></div>
          <div class="stat"><strong>${lowCount}</strong><span>Low</span></div>
          <div class="stat"><strong>${passCount}</strong><span>Passed</span></div>
        </div>
        <div class="cta-row">
          ${report.browser.replayUrl ? `<a class="btn btn-primary" href="${escapeHtml(report.browser.replayUrl)}" target="_blank" rel="noreferrer">Watch Solari replay</a>` : `<span class="btn btn-secondary">Replay unavailable or skipped</span>`}
          <a class="btn btn-secondary" href="https://digitalalchemy.dev" target="_blank" rel="noreferrer">digitalalchemy.dev</a>
          <a class="btn btn-secondary" href="https://beacons.ai/dbcreations" target="_blank" rel="noreferrer">Work with Desi</a>
        </div>
        ${report.browser.replayUrl ? `<p class="meta">Replay links expire. Open soon after the audit run.</p>` : ""}
      </div>
      <div class="score-card">
        <div class="score-ring">
          <div>
            <strong>${report.score}</strong>
            <span>/ 100</span>
          </div>
        </div>
        <p class="meta" style="margin-top: 12px;">Health score</p>
      </div>
    </header>

    <section>
      <h2>Priority findings</h2>
      <div class="grid">${renderFindingCards(findings)}</div>
    </section>

    <section>
      <h2>Page inventory</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Path</th><th>Status</th><th>Scripts</th><th>Forms</th><th>Links</th></tr></thead>
          <tbody>${renderPageTable(report.browser.pages)}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Security headers</h2>
      <p class="meta" style="margin-top: 0;">Probed from Solari sandbox via curl against HTTPS and HTTP.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Header</th><th>Present</th><th>Value</th></tr></thead>
          <tbody>${renderHeaderTable(report.sandbox.headers)}</tbody>
        </table>
      </div>
      <p class="meta">TLS redirect: ${report.sandbox.tlsRedirect ? "Yes" : "No"}${report.sandbox.serverBanner ? ` · Server: ${escapeHtml(report.sandbox.serverBanner)}` : ""}</p>
    </section>

    <section>
      <h2>Browser captures</h2>
      <p class="meta" style="margin-top: 0;">Session ${escapeHtml(report.browser.sessionId)} · ${report.browser.pages.length} page(s) with stealth browser + recording.</p>
      <div class="shots">${renderScreenshots(report.browser.pages)}</div>
    </section>

    <section>
      <details class="passed">
        <summary>${passCount} checks passed</summary>
        <ul>${renderPassedChecks(findings)}</ul>
      </details>
    </section>

    <footer>
      Built by <a href="https://github.com/buildwithdesi/solari-cookbook" style="color: var(--accent);">Desi Baker</a> for the Solari hiring challenge · Powered by <a href="https://getsolari.com" style="color: var(--accent);">Solari</a>
    </footer>
  </div>
</body>
</html>`;
}

async function writeScreenshots(
  pages: PageSnapshot[],
  outputDir: string,
): Promise<PageSnapshot[]> {
  const screenshotDir = path.join(outputDir, "screenshots");
  await mkdir(screenshotDir, { recursive: true });

  const updated: PageSnapshot[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const filename = `page-${index + 1}.png`;
    const filePath = path.join(screenshotDir, filename);
    await writeFile(filePath, Buffer.from(page.screenshotBase64, "base64"));
    updated.push({
      ...page,
      screenshotFile: `./screenshots/${filename}`,
    });
  }
  return updated;
}

export async function writeReportArtifacts(
  report: AuditRelayReport,
  outputDir: string,
): Promise<{ htmlPath: string; jsonPath: string }> {
  await mkdir(outputDir, { recursive: true });

  const pagesWithFiles = await writeScreenshots(report.browser.pages, outputDir);
  const reportForHtml: AuditRelayReport = {
    ...report,
    browser: {
      ...report.browser,
      pages: pagesWithFiles,
    },
  };

  const htmlPath = path.join(outputDir, "audit-report.html");
  const jsonPath = path.join(outputDir, "audit-report.json");

  const jsonSafe = {
    ...reportForHtml,
    browser: {
      ...reportForHtml.browser,
      pages: reportForHtml.browser.pages.map((page) => ({
        ...page,
        screenshotBase64: `[${page.screenshotBase64.length} chars omitted]`,
        screenshotFile: page.screenshotFile,
      })),
    },
  };

  await writeFile(htmlPath, buildHtmlReport(reportForHtml), "utf8");
  await writeFile(jsonPath, JSON.stringify(jsonSafe, null, 2), "utf8");

  return { htmlPath, jsonPath };
}

export function finalizeReport(
  targetUrl: string,
  startedAt: number,
  browser: AuditRelayReport["browser"],
  sandbox: AuditRelayReport["sandbox"],
): AuditRelayReport {
  const findings = dedupeFindings(sortFindings([...browser.findings, ...sandbox.findings]));
  const score = computeScore(findings);
  return {
    targetUrl,
    auditedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    sandboxMs: sandbox.durationMs,
    browserMs: browser.durationMs,
    browser,
    sandbox,
    findings,
    score,
    verdict: scoreVerdict(score),
  };
}
