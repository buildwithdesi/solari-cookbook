import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  appendRunIndex,
  completePhase,
  createRunManifest,
  failPhase,
  finalizeRun,
  manifestRelativePath,
  skipPhase,
  startPhase,
} from "./src/core/manifest.js";
import { syncLatestRunToOutput } from "./src/core/output-sync.js";
import { generateRunId, normalizeTargetUrl } from "./src/core/run-id.js";
import { runBrowserAudit } from "./src/browser-phase.js";
import { finalizeReport, writeRunArtifacts } from "./src/report.js";
import { runSandboxAudit } from "./src/sandbox-phase.js";
import type { AuditOptions, RunStatus } from "./src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(): void {
  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): { target: string; options: AuditOptions } {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const positional = argv.filter((arg) => !arg.startsWith("--"));

  const options: AuditOptions = {
    skipReplay: flags.has("--skip-replay") || process.env.AUDIT_SKIP_REPLAY === "1",
    maxExtraPages: flags.has("--landing-only") || process.env.AUDIT_LANDING_ONLY === "1" ? 0 : 2,
    depth: process.env.AUDIT_DEPTH === "quick" || process.env.AUDIT_DEPTH === "deep"
      ? process.env.AUDIT_DEPTH
      : "standard",
  };

  return {
    target: positional[0] ?? "",
    options,
  };
}

function usage(): never {
  console.log(`
AuditRelay — client site audit on Solari browser + sandbox

Usage:
  npm run audit -- https://example.com

Agent read order after run:
  runs/{run_id}/manifest.json
  runs/{run_id}/summary.json

Flags / env:
  AUDIT_SKIP_REPLAY=1
  AUDIT_LANDING_ONLY=1
  AUDIT_DEPTH=standard|quick|deep   (quick = sandbox only, phase 3)

Requires:
  SOLARI_API_KEY=slr_live_...
`);
  process.exit(1);
}

function resolveRunStatus(
  sandboxOk: boolean,
  browserOk: boolean,
  browserSkipped: boolean,
): RunStatus {
  if (sandboxOk && (browserOk || browserSkipped)) return "completed";
  if (sandboxOk || browserOk) return "partial";
  return "failed";
}

async function main(): Promise<void> {
  loadEnvFile();

  const { target, options } = parseArgs(process.argv.slice(2));
  if (!target) usage();

  if (!process.env.SOLARI_API_KEY) {
    console.error("Missing SOLARI_API_KEY. Export it or create a .env file.");
    process.exit(1);
  }

  const startedAt = Date.now();
  const normalizedTarget = normalizeTargetUrl(target);
  const runId = generateRunId(normalizedTarget);
  let manifest = await createRunManifest(__dirname, runId, normalizedTarget, options);

  console.log(`\nAuditRelay run ${runId}`);
  console.log(`target: ${normalizedTarget}`);
  console.log(`depth : ${manifest.depth}`);
  if (options.skipReplay) console.log("mode  : skip replay polling");
  if (options.maxExtraPages === 0) console.log("mode  : landing page only");
  console.log("");

  let sandbox = null;
  let browser = null;
  let sandboxError: string | null = null;
  let browserError: string | null = null;

  const runBrowser = options.depth !== "quick";

  if (!runBrowser) {
    manifest = await skipPhase(__dirname, manifest, "observe.browser");
  }

  manifest = await startPhase(__dirname, manifest, "observe.sandbox");
  try {
    console.log("Phase observe.sandbox...");
    sandbox = await runSandboxAudit(normalizedTarget);
    manifest = await completePhase(__dirname, manifest, "observe.sandbox", {
      duration_ms: sandbox.durationMs,
      observation: "observations/sandbox.json",
    });
    console.log(`  sandbox done (${Math.round(sandbox.durationMs / 1000)}s)`);
  } catch (error) {
    sandboxError = error instanceof Error ? error.message : String(error);
    manifest = await failPhase(__dirname, manifest, "observe.sandbox", sandboxError);
    console.error(`  sandbox failed: ${sandboxError}`);
  }

  if (runBrowser) {
    manifest = await startPhase(__dirname, manifest, "observe.browser");
    try {
      console.log("Phase observe.browser...");
      browser = await runBrowserAudit(normalizedTarget, options);
      manifest = await completePhase(__dirname, manifest, "observe.browser", {
        duration_ms: browser.durationMs,
        observation: "observations/browser.json",
      });
      console.log(`  browser done (${Math.round(browser.durationMs / 1000)}s)`);
    } catch (error) {
      browserError = error instanceof Error ? error.message : String(error);
      manifest = await failPhase(__dirname, manifest, "observe.browser", browserError);
      console.error(`  browser failed: ${browserError}`);
    }
  }

  const runStatus = resolveRunStatus(Boolean(sandbox), Boolean(browser), !runBrowser);
  if (runStatus === "failed") {
    manifest = await finalizeRun(__dirname, manifest, "failed", Date.now() - startedAt, {
      solari_browser_ms: browser?.durationMs ?? 0,
      solari_sandbox_ms: sandbox?.durationMs ?? 0,
      replay_polled: Boolean(browser?.replayUrl),
    });
    console.error("\nAuditRelay failed: no observations collected.");
    console.error(`  manifest: runs/${runId}/manifest.json`);
    process.exit(1);
  }

  manifest = await startPhase(__dirname, manifest, "interpret");
  const report = finalizeReport(runId, normalizedTarget, startedAt, browser, sandbox, runStatus);
  manifest = await completePhase(__dirname, manifest, "interpret", {
    duration_ms: 0,
    output: "findings.json",
  });

  manifest = await startPhase(__dirname, manifest, "score");
  manifest = await completePhase(__dirname, manifest, "score", {
    duration_ms: 0,
    output: "summary.json",
  });

  manifest = await startPhase(__dirname, manifest, "render");
  const artifactPaths = await writeRunArtifacts(__dirname, runId, report);
  manifest = await completePhase(__dirname, manifest, "render", {
    duration_ms: 0,
    artifact: artifactPaths.manifestPaths.htmlReport,
  });

  manifest = await finalizeRun(__dirname, manifest, runStatus, report.durationMs, {
    solari_browser_ms: report.browserMs,
    solari_sandbox_ms: report.sandboxMs,
    replay_polled: Boolean(browser?.replayUrl),
  });

  await appendRunIndex(__dirname, {
    run_id: runId,
    target_host: manifest.target_host,
    target_url: manifest.target_url,
    at: manifest.completed_at ?? new Date().toISOString(),
    score: report.score,
    status: runStatus,
    depth: manifest.depth,
    manifest: manifestRelativePath(runId),
  });

  const { outputDir } = await syncLatestRunToOutput(__dirname, runId);
  const actionable = report.findings.filter((f) => f.severity !== "pass").length;

  console.log("\nAuditRelay complete");
  console.log(`  run_id     : ${runId}`);
  console.log(`  status     : ${runStatus}`);
  console.log(`  score      : ${report.score}/100`);
  console.log(`  verdict    : ${report.verdict}`);
  console.log(`  findings   : ${actionable} actionable, ${report.findings.length - actionable} passed`);
  console.log(`  manifest   : runs/${runId}/manifest.json`);
  console.log(`  summary    : runs/${runId}/summary.json`);
  console.log(`  html       : runs/${runId}/artifacts/render/report.html`);
  console.log(`  latest     : output/latest.json`);
  console.log(`  output     : ${outputDir}`);
  if (browser?.replayUrl) console.log(`  replay     : ${browser.replayUrl}`);
  if (sandboxError) console.log(`  sandbox err: ${sandboxError}`);
  if (browserError) console.log(`  browser err: ${browserError}`);
}

main().catch((error) => {
  console.error("\nAuditRelay failed:", error);
  process.exit(1);
});
