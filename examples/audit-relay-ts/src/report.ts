import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { RUN_REL_PATHS, runDir } from "./core/paths.js";
import { writeFindingsFile } from "./core/run-store.js";
import { computeScore, dedupeFindings, scoreVerdict, sortFindings } from "./findings.js";
import type {
  AuditRelayReport,
  BrowserObservation,
  Finding,
  PageSnapshot,
  RunStatus,
  RunSummary,
  SandboxObservation,
  Severity,
} from "./types.js";

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

function countFindings(findings: Finding[]): RunSummary["counts"] {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    pass: 0,
    actionable: 0,
  };
  for (const finding of findings) {
    counts[finding.severity] += 1;
    if (finding.severity !== "pass") counts.actionable += 1;
  }
  return counts;
}

export function buildSummary(report: AuditRelayReport): RunSummary {
  const findings = sortFindings(report.findings);
  return {
    run_id: report.runId,
    target_url: report.targetUrl,
    score: report.score,
    verdict: report.verdict,
    status: report.status,
    counts: countFindings(findings),
    top_findings: findings
      .filter((f) => f.severity !== "pass")
      .slice(0, 5)
      .map((f) => ({
        check_id: f.check_id,
        id: f.id,
        severity: f.severity,
        title: f.title,
      })),
  };
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
          <code class="check-id">${escapeHtml(finding.check_id)}</code>
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

function renderHeaderTable(headers: SandboxObservation["headers"]): string {
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
  const counts = countFindings(findings);
  const tone = scoreTone(report.score);
  const pages = report.browser?.pages ?? [];
  const headers = report.sandbox?.headers ?? [];

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
    }
    h2 { margin: 0 0 14px; font-size: 1.25rem; }
    .grid { display: grid; gap: 16px; }
    .finding { border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
    .finding h3 { margin: 8px 0 6px; font-size: 1rem; }
    .finding-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .check-id { font-size: 0.75rem; color: var(--muted); }
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
    th, td { border-bottom: 1px solid var(--line); padding: 10px 12px; text-align: left; }
    th { color: var(--muted); font-weight: 500; }
    code { font-family: "JetBrains Mono", monospace; font-size: 0.85em; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; background: var(--bad); }
    .status-dot.yes { background: var(--good); }
    .shots { display: grid; gap: 18px; }
    .shot img { width: 100%; border-radius: 12px; border: 1px solid var(--line); display: block; }
    .shot figcaption { margin-top: 8px; display: grid; gap: 4px; color: var(--muted); font-size: 0.9rem; }
    .meta { color: var(--muted); font-size: 0.92rem; margin-top: 12px; }
    .btn {
      display: inline-flex;
      padding: 12px 18px;
      border-radius: 999px;
      text-decoration: none;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .btn-primary { background: var(--accent); color: #041018; }
    .btn-secondary { border-color: var(--line); color: var(--text); }
    .cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 18px; }
    details.passed { border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
    details.passed summary { cursor: pointer; font-weight: 600; color: var(--pass); }
    .empty { color: var(--muted); }
    footer { margin-top: 28px; text-align: center; color: var(--muted); font-size: 0.9rem; }
    @media (max-width: 860px) { .hero { grid-template-columns: 1fr; } .score-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <div>
        <p class="eyebrow">AuditRelay · Run ${escapeHtml(report.runId)} · registry ${escapeHtml(report.registryVersion)}</p>
        <h1>${escapeHtml(report.targetUrl)}</h1>
        <p class="sub">Generated ${escapeHtml(new Date(report.auditedAt).toLocaleString())} · ${Math.round(report.durationMs / 1000)}s total · status ${escapeHtml(report.status)}</p>
        <p class="verdict">${escapeHtml(report.verdict)}</p>
        <div class="score-row">
          <div class="stat"><strong>${counts.critical}</strong><span>Critical</span></div>
          <div class="stat"><strong>${counts.high}</strong><span>High</span></div>
          <div class="stat"><strong>${counts.medium}</strong><span>Medium</span></div>
          <div class="stat"><strong>${counts.low}</strong><span>Low</span></div>
          <div class="stat"><strong>${counts.pass}</strong><span>Passed</span></div>
        </div>
        <div class="cta-row">
          ${report.browser?.replayUrl ? `<a class="btn btn-primary" href="${escapeHtml(report.browser.replayUrl)}" target="_blank" rel="noreferrer">Watch Solari replay</a>` : `<span class="btn btn-secondary">Replay unavailable or skipped</span>`}
          <a class="btn btn-secondary" href="https://digitalalchemy.dev" target="_blank" rel="noreferrer">digitalalchemy.dev</a>
        </div>
      </div>
      <div class="score-card">
        <div class="score-ring"><div><strong>${report.score}</strong><span>/ 100</span></div></div>
        <p class="meta" style="margin-top: 12px;">Health score</p>
      </div>
    </header>

    <section>
      <h2>Priority findings</h2>
      <div class="grid">${renderFindingCards(findings)}</div>
    </section>

    ${pages.length > 0 ? `<section><h2>Page inventory</h2><div class="table-wrap"><table><thead><tr><th>Title</th><th>Path</th><th>Status</th><th>Scripts</th><th>Forms</th><th>Links</th></tr></thead><tbody>${renderPageTable(pages)}</tbody></table></div></section>` : ""}

    ${headers.length > 0 ? `<section><h2>Security headers</h2><div class="table-wrap"><table><thead><tr><th>Header</th><th>Present</th><th>Value</th></tr></thead><tbody>${renderHeaderTable(headers)}</tbody></table></div><p class="meta">TLS redirect: ${report.sandbox?.tlsRedirect ? "Yes" : "No"}</p></section>` : ""}

    ${pages.length > 0 ? `<section><h2>Browser captures</h2><div class="shots">${renderScreenshots(pages)}</div></section>` : ""}

    <section>
      <details class="passed"><summary>${counts.pass} checks passed</summary><ul>${renderPassedChecks(findings)}</ul></details>
    </section>

    <footer>Run ${escapeHtml(report.runId)} · Powered by <a href="https://getsolari.com" style="color: var(--accent);">Solari</a></footer>
  </div>
</body>
</html>`;
}

export async function persistBrowserScreenshots(
  projectRoot: string,
  runId: string,
  browser: BrowserObservation,
): Promise<BrowserObservation> {
  const screenshotDir = path.join(runDir(projectRoot, runId), RUN_REL_PATHS.screenshotDir);
  await mkdir(screenshotDir, { recursive: true });

  const pages: PageSnapshot[] = [];
  for (let index = 0; index < browser.pages.length; index += 1) {
    const page = browser.pages[index];
    if (page.screenshotFile && !page.screenshotBase64) {
      pages.push(page);
      continue;
    }

    const filename = `page-${index + 1}.png`;
    await writeFile(
      path.join(screenshotDir, filename),
      Buffer.from(page.screenshotBase64, "base64"),
    );
    pages.push({
      ...page,
      screenshotFile: `../screenshots/${filename}`,
      screenshotBase64: "",
    });
  }

  return { ...browser, pages };
}

export interface RunArtifactPaths {
  manifestPaths: {
    summary: string;
    findings: string;
    sandboxObservation: string;
    browserObservation: string;
    htmlReport: string;
  };
}

export async function writeRunArtifacts(
  projectRoot: string,
  runId: string,
  report: AuditRelayReport,
): Promise<RunArtifactPaths> {
  const dir = runDir(projectRoot, runId);
  const htmlDir = path.join(dir, "artifacts/render");

  await mkdir(htmlDir, { recursive: true });

  let browser = report.browser;
  if (browser && browser.pages.some((page) => page.screenshotBase64)) {
    browser = await persistBrowserScreenshots(projectRoot, runId, browser);
  }

  const reportForHtml: AuditRelayReport = {
    ...report,
    browser,
  };

  await writeFindingsFile(projectRoot, runId, report.findings, report.registryVersion);

  const summary = buildSummary(report);
  await writeFile(path.join(dir, RUN_REL_PATHS.summary), JSON.stringify(summary, null, 2), "utf8");

  await writeFile(
    path.join(dir, RUN_REL_PATHS.htmlReport),
    buildHtmlReport(reportForHtml),
    "utf8",
  );

  if (browser?.replayUrl) {
    await writeFile(path.join(dir, RUN_REL_PATHS.replayUrl), browser.replayUrl, "utf8");
  }

  return {
    manifestPaths: {
      summary: RUN_REL_PATHS.summary,
      findings: RUN_REL_PATHS.findings,
      sandboxObservation: RUN_REL_PATHS.sandboxObservation,
      browserObservation: RUN_REL_PATHS.browserObservation,
      htmlReport: RUN_REL_PATHS.htmlReport,
    },
  };
}

export function buildReport(
  runId: string,
  targetUrl: string,
  startedAt: number,
  sandbox: SandboxObservation | null,
  browser: BrowserObservation | null,
  findings: Finding[],
  status: RunStatus,
  registryVersion: string,
): AuditRelayReport {
  const sorted = dedupeFindings(sortFindings(findings));
  const score = computeScore(sorted);

  return {
    runId,
    targetUrl,
    auditedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    sandboxMs: sandbox?.durationMs ?? 0,
    browserMs: browser?.durationMs ?? 0,
    status,
    sandbox,
    browser,
    findings: sorted,
    score,
    verdict: scoreVerdict(score),
    registryVersion,
  };
}

/** @deprecated use buildReport */
export function finalizeReport(
  runId: string,
  targetUrl: string,
  startedAt: number,
  browser: BrowserObservation | null,
  sandbox: SandboxObservation | null,
  status: RunStatus,
  findings: Finding[],
  registryVersion: string,
): AuditRelayReport {
  return buildReport(runId, targetUrl, startedAt, sandbox, browser, findings, status, registryVersion);
}
