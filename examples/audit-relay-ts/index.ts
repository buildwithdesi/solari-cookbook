import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runBrowserAudit } from "./src/browser-phase.js";
import { finalizeReport, writeReportArtifacts } from "./src/report.js";
import { runSandboxAudit } from "./src/sandbox-phase.js";

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

function usage(): never {
  console.log(`
AuditRelay — client site audit on Solari browser + sandbox

Usage:
  npm run audit -- https://example.com
  npm run audit -- example.com

Requires:
  SOLARI_API_KEY=slr_live_...
`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadEnvFile();

  const target = process.argv[2];
  if (!target) usage();

  if (!process.env.SOLARI_API_KEY) {
    console.error("Missing SOLARI_API_KEY. Export it or create a .env file.");
    process.exit(1);
  }

  const startedAt = Date.now();
  console.log(`\nAuditRelay starting for ${target}\n`);

  console.log("Phase 1/2 — sandbox header audit");
  const sandbox = await runSandboxAudit(target);

  console.log("\nPhase 2/2 — browser capture + replay");
  const browser = await runBrowserAudit(target);

  const report = finalizeReport(target, startedAt, browser, sandbox);
  const outputDir = path.join(__dirname, "output");
  const { htmlPath, jsonPath } = await writeReportArtifacts(report, outputDir);

  console.log("\nAuditRelay complete");
  console.log(`  score      : ${report.score}/100`);
  console.log(`  findings   : ${report.findings.filter((f) => f.severity !== "pass").length} actionable`);
  console.log(`  replay     : ${browser.replayUrl ?? "pending or unavailable"}`);
  console.log(`  html report: ${htmlPath}`);
  console.log(`  json report: ${jsonPath}`);
}

main().catch((error) => {
  console.error("\nAuditRelay failed:", error);
  process.exit(1);
});
