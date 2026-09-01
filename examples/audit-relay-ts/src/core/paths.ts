import path from "node:path";

export const MANIFEST_SCHEMA_VERSION = "1.0";

export const RUN_REL_PATHS = {
  manifest: "manifest.json",
  summary: "summary.json",
  findings: "findings.json",
  sandboxObservation: "observations/sandbox.json",
  browserObservation: "observations/browser.json",
  htmlReport: "artifacts/render/report.html",
  screenshotDir: "artifacts/screenshots",
  replayUrl: "artifacts/browser/replay.url",
} as const;

export function runsRoot(projectRoot: string): string {
  return path.join(projectRoot, "runs");
}

export function runDir(projectRoot: string, runId: string): string {
  return path.join(runsRoot(projectRoot), runId);
}

export function runsIndexPath(projectRoot: string): string {
  return path.join(runsRoot(projectRoot), "index.jsonl");
}

export function relativeRunPath(runId: string, innerPath: string): string {
  return `runs/${runId}/${innerPath}`.replace(/\\/g, "/");
}
