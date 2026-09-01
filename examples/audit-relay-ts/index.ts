import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runBrowserAudit } from "./src/browser-phase.js";
import { finalizeReport, writeReportArtifacts } from "./src/report.js";
import { runSandboxAudit } from "./src/sandbox-phase.js";
import type { AuditOptions } from "./src/types.js";

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
  npm run audit -- example.com
  npm run audit -- https://example.com --skip-replay
  npm run audit -- https://example.com --landing-only

Flags:
  --skip-replay    Skip replay polling (faster iteration)
  --landing-only   Audit only the landing page

Requires:
  SOLARI_API_KEY=slr_live_...
`);
  process.exit(1);
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
  console.log(`\nAuditRelay starting for ${target}`);
  if (options.skipReplay) console.log("mode: skip replay polling");
  if (options.maxExtraPages === 0) console.log("mode: landing page only");
  console.log("");

  console.log("Running sandbox + browser in parallel...");
  const [sandbox, browser] = await Promise.all([
    runSandboxAudit(target),
    runBrowserAudit(target, options),
  ]);

  const report = finalizeReport(target, startedAt, browser, sandbox);
  const outputDir = path.join(__dirname, "output");
  const { htmlPath, jsonPath } = await writeReportArtifacts(report, outputDir);

  const actionable = report.findings.filter((f) => f.severity !== "pass").length;

  console.log("\nAuditRelay complete");
  console.log(`  score      : ${report.score}/100`);
  console.log(`  verdict    : ${report.verdict}`);
  console.log(`  findings   : ${actionable} actionable, ${report.findings.length - actionable} passed`);
  console.log(`  timing     : sandbox ${Math.round(sandbox.durationMs / 1000)}s, browser ${Math.round(browser.durationMs / 1000)}s, total ${Math.round(report.durationMs / 1000)}s`);
  console.log(`  replay     : ${browser.replayUrl ?? "pending or unavailable"}`);
  console.log(`  html report: ${htmlPath}`);
  console.log(`  json report: ${jsonPath}`);
  console.log(`  screenshots: ${path.join(outputDir, "screenshots")}`);
}

main().catch((error) => {
  console.error("\nAuditRelay failed:", error);
  process.exit(1);
});
