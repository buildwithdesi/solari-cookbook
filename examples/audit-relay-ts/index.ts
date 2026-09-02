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
  updateManifest,
} from "./src/core/manifest.js";
import { syncLatestRunToOutput } from "./src/core/output-sync.js";
import { generateRunId, normalizeTargetUrl } from "./src/core/run-id.js";
import {
  loadManifest,
  loadObservationBundle,
  normalizeRunId,
  writeBrowserObservation,
  writeSandboxObservation,
} from "./src/core/run-store.js";
import { observeBrowser } from "./src/browser-phase.js";
import { getRegistryVersion, interpretObservations } from "./src/interpret/engine.js";
import { buildReport, persistBrowserScreenshots, writeRunArtifacts } from "./src/report.js";
import { observeSandbox } from "./src/sandbox-phase.js";
import type { AuditOptions, PipelinePhase, RunManifest, RunStatus } from "./src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_REPLAY_PHASES: PipelinePhase[] = ["interpret", "score", "render"];
const ALL_PHASES: PipelinePhase[] = [
  "observe.sandbox",
  "observe.browser",
  "interpret",
  "score",
  "render",
];

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

function parsePhases(raw: string | undefined, fromRun: boolean): PipelinePhase[] {
  if (!raw) {
    return fromRun ? DEFAULT_REPLAY_PHASES : ALL_PHASES;
  }

  const parsed = raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean) as PipelinePhase[];

  for (const phase of parsed) {
    if (!ALL_PHASES.includes(phase)) {
      console.error(`Unknown phase: ${phase}`);
      process.exit(1);
    }
  }

  return parsed;
}

function parseArgs(argv: string[]): { target: string; options: AuditOptions; phases: PipelinePhase[] } {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const positional = argv.filter((arg) => !arg.startsWith("--"));

  let fromRun: string | undefined;
  let phasesRaw: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from-run" && argv[index + 1]) {
      fromRun = argv[++index];
    }
    if (arg === "--phases") {
      const parts: string[] = [];
      while (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
        parts.push(argv[++index]);
      }
      phasesRaw = parts.join(",");
    }
  }

  const options: AuditOptions = {
    skipReplay: flags.has("--skip-replay") || process.env.AUDIT_SKIP_REPLAY === "1",
    maxExtraPages: flags.has("--landing-only") || process.env.AUDIT_LANDING_ONLY === "1" ? 0 : 2,
    depth:
      process.env.AUDIT_DEPTH === "quick" || process.env.AUDIT_DEPTH === "deep"
        ? process.env.AUDIT_DEPTH
        : "standard",
    fromRun: fromRun ? normalizeRunId(fromRun) : undefined,
  };

  const phases = parsePhases(phasesRaw ?? options.phases?.join(","), Boolean(options.fromRun));

  return {
    target: positional[0] ?? "",
    options,
    phases,
  };
}

function usage(): never {
  console.log(`
AuditRelay — client site audit on Solari browser + sandbox

Usage:
  npm run audit -- https://example.com
  npm run audit -- --from-run runs/{run_id} --phases interpret,score,render

Agent read order after run:
  runs/{run_id}/manifest.json
  runs/{run_id}/summary.json

Flags / env:
  --from-run <path>                 Re-run phases on cached observations
  --phases observe.sandbox,...      Phase list (default: all, or interpret,score,render with --from-run)
  --skip-replay
  --landing-only
  AUDIT_SKIP_REPLAY=1
  AUDIT_LANDING_ONLY=1
  AUDIT_DEPTH=standard|quick|deep   (quick = sandbox only)

Requires SOLARI_API_KEY for observe phases only.
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

function wantsPhase(phases: PipelinePhase[], phase: PipelinePhase): boolean {
  return phases.includes(phase);
}

function needsSolari(phases: PipelinePhase[]): boolean {
  return phases.includes("observe.sandbox") || phases.includes("observe.browser");
}

async function main(): Promise<void> {
  loadEnvFile();

  const { target, options, phases } = parseArgs(process.argv.slice(2));
  if (!target && !options.fromRun) usage();

  if (needsSolari(phases) && !process.env.SOLARI_API_KEY) {
    console.error("Missing SOLARI_API_KEY. Export it or create a .env file.");
    process.exit(1);
  }

  const startedAt = Date.now();
  const registryVersion = getRegistryVersion();

  let runId: string;
  let manifest: RunManifest;
  let normalizedTarget: string;

  if (options.fromRun) {
    runId = options.fromRun;
    manifest = await loadManifest(__dirname, runId);
    normalizedTarget = manifest.target_url;
  } else {
    normalizedTarget = normalizeTargetUrl(target);
    runId = generateRunId(normalizedTarget);
    manifest = await createRunManifest(__dirname, runId, normalizedTarget, options);
  }

  console.log(`\nAuditRelay run ${runId}`);
  console.log(`target: ${normalizedTarget}`);
  console.log(`depth : ${manifest.depth}`);
  console.log(`phases: ${phases.join(", ")}`);
  if (options.skipReplay) console.log("mode  : skip replay polling");
  if (options.maxExtraPages === 0) console.log("mode  : landing page only");
  console.log("");

  let sandbox = null;
  let browser = null;
  let sandboxError: string | null = null;
  let browserError: string | null = null;

  const runBrowserObserve =
    wantsPhase(phases, "observe.browser") && manifest.depth !== "quick";

  if (!wantsPhase(phases, "observe.browser") && options.fromRun) {
    // Leave manifest as-is when replaying interpret-only.
  } else if (!runBrowserObserve && wantsPhase(phases, "observe.sandbox")) {
    manifest = await skipPhase(__dirname, manifest, "observe.browser");
  }

  if (wantsPhase(phases, "observe.sandbox")) {
    manifest = await startPhase(__dirname, manifest, "observe.sandbox");
    try {
      console.log("Phase observe.sandbox...");
      sandbox = await observeSandbox(normalizedTarget);
      await writeSandboxObservation(__dirname, runId, sandbox);
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
  } else {
    sandbox = (await loadObservationBundle(__dirname, runId)).sandbox;
  }

  if (runBrowserObserve) {
    manifest = await startPhase(__dirname, manifest, "observe.browser");
    try {
      console.log("Phase observe.browser...");
      browser = await observeBrowser(normalizedTarget, options);
      browser = await persistBrowserScreenshots(__dirname, runId, browser);
      await writeBrowserObservation(__dirname, runId, browser);
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
  } else if (wantsPhase(phases, "interpret") || wantsPhase(phases, "score") || wantsPhase(phases, "render")) {
    browser = (await loadObservationBundle(__dirname, runId)).browser;
  }

  const observeAttempted =
    wantsPhase(phases, "observe.sandbox") || wantsPhase(phases, "observe.browser");
  const runStatus = observeAttempted
    ? resolveRunStatus(Boolean(sandbox), Boolean(browser), !runBrowserObserve)
    : manifest.status;

  if (observeAttempted && runStatus === "failed") {
    manifest = await finalizeRun(__dirname, manifest, "failed", Date.now() - startedAt, {
      solari_browser_ms: browser?.durationMs ?? 0,
      solari_sandbox_ms: sandbox?.durationMs ?? 0,
      replay_polled: Boolean(browser?.replayUrl),
    });
    console.error("\nAuditRelay failed: no observations collected.");
    console.error(`  manifest: runs/${runId}/manifest.json`);
    process.exit(1);
  }

  let findings = null;
  if (wantsPhase(phases, "interpret")) {
    manifest = await startPhase(__dirname, manifest, "interpret");
    const bundle = {
      targetUrl: normalizedTarget,
      sandbox,
      browser,
    };
    findings = interpretObservations(bundle);
    manifest = await updateManifest(__dirname, manifest, { registry_version: registryVersion });
    manifest = await completePhase(__dirname, manifest, "interpret", {
      duration_ms: 0,
      output: "findings.json",
    });
    console.log(`Phase interpret: ${findings.length} findings`);
  }

  const report = buildReport(
    runId,
    normalizedTarget,
    startedAt,
    sandbox,
    browser,
    findings ?? [],
    runStatus,
    registryVersion,
  );

  if (wantsPhase(phases, "score")) {
    manifest = await startPhase(__dirname, manifest, "score");
    manifest = await completePhase(__dirname, manifest, "score", {
      duration_ms: 0,
      output: "summary.json",
    });
    console.log(`Phase score: ${report.score}/100`);
  }

  if (wantsPhase(phases, "render")) {
    manifest = await startPhase(__dirname, manifest, "render");
    const artifactPaths = await writeRunArtifacts(__dirname, runId, report);
    manifest = await completePhase(__dirname, manifest, "render", {
      duration_ms: 0,
      artifact: artifactPaths.manifestPaths.htmlReport,
    });
    console.log("Phase render: report.html written");
  }

  manifest = await finalizeRun(__dirname, manifest, runStatus, report.durationMs, {
    solari_browser_ms: report.browserMs,
    solari_sandbox_ms: report.sandboxMs,
    replay_polled: Boolean(browser?.replayUrl),
  });

  if (wantsPhase(phases, "render")) {
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
}

main().catch((error) => {
  console.error("\nAuditRelay failed:", error);
  process.exit(1);
});
