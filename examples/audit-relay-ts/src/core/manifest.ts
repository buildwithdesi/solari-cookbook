import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeTargetUrl, targetHost } from "./run-id.js";
import {
  MANIFEST_SCHEMA_VERSION,
  RUN_REL_PATHS,
  relativeRunPath,
  runDir,
  runsIndexPath,
} from "./paths.js";
import type { AuditDepth, AuditOptions, RunManifest, RunPhaseId, RunStatus } from "../types.js";

function initialPhases(): RunManifest["phases"] {
  return [
    { id: "observe.sandbox", status: "pending" },
    { id: "observe.browser", status: "pending" },
    { id: "interpret", status: "pending" },
    { id: "score", status: "pending" },
    { id: "render", status: "pending" },
  ];
}

export function resolveDepth(options: AuditOptions): AuditDepth {
  if (options.depth) return options.depth;
  return "standard";
}

export async function createRunManifest(
  projectRoot: string,
  runId: string,
  targetUrl: string,
  options: AuditOptions,
): Promise<RunManifest> {
  const normalized = normalizeTargetUrl(targetUrl);
  const dir = runDir(projectRoot, runId);
  await mkdir(path.join(dir, "observations"), { recursive: true });
  await mkdir(path.join(dir, "artifacts/render"), { recursive: true });
  await mkdir(path.join(dir, "artifacts/screenshots"), { recursive: true });
  await mkdir(path.join(dir, "artifacts/browser"), { recursive: true });

  const manifest: RunManifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    run_id: runId,
    target_url: normalized,
    target_host: targetHost(normalized),
    status: "running",
    depth: resolveDepth(options),
    options: {
      skip_replay: Boolean(options.skipReplay),
      max_extra_pages: options.maxExtraPages ?? 2,
    },
    created_at: new Date().toISOString(),
    phases: initialPhases(),
    agent_read_order: [
      RUN_REL_PATHS.summary,
      RUN_REL_PATHS.findings,
      RUN_REL_PATHS.sandboxObservation,
      RUN_REL_PATHS.browserObservation,
      RUN_REL_PATHS.htmlReport,
    ],
    resume: null,
  };

  await writeManifest(projectRoot, manifest);
  return manifest;
}

export async function writeManifest(projectRoot: string, manifest: RunManifest): Promise<string> {
  const dir = runDir(projectRoot, manifest.run_id);
  const manifestPath = path.join(dir, RUN_REL_PATHS.manifest);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifestPath;
}

export async function updateManifest(
  projectRoot: string,
  manifest: RunManifest,
  patch: Partial<RunManifest>,
): Promise<RunManifest> {
  const next = { ...manifest, ...patch };
  await writeManifest(projectRoot, next);
  return next;
}

export async function startPhase(
  projectRoot: string,
  manifest: RunManifest,
  phaseId: RunPhaseId,
): Promise<RunManifest> {
  const phases = manifest.phases.map((phase) =>
    phase.id === phaseId ? { ...phase, status: "running" as const, started_at: new Date().toISOString() } : phase,
  );
  return updateManifest(projectRoot, manifest, { phases, status: "running" });
}

export async function completePhase(
  projectRoot: string,
  manifest: RunManifest,
  phaseId: RunPhaseId,
  fields: {
    duration_ms?: number;
    observation?: string;
    output?: string;
    artifact?: string;
  },
): Promise<RunManifest> {
  const phases = manifest.phases.map((phase) => {
    if (phase.id !== phaseId) return phase;
    return {
      ...phase,
      status: "completed" as const,
      completed_at: new Date().toISOString(),
      duration_ms: fields.duration_ms,
      observation: fields.observation,
      output: fields.output,
      artifact: fields.artifact,
    };
  });
  return updateManifest(projectRoot, manifest, { phases });
}

export async function failPhase(
  projectRoot: string,
  manifest: RunManifest,
  phaseId: RunPhaseId,
  error: string,
): Promise<RunManifest> {
  const phases = manifest.phases.map((phase) => {
    if (phase.id !== phaseId) return phase;
    return {
      ...phase,
      status: "failed" as const,
      completed_at: new Date().toISOString(),
      error,
    };
  });
  const resume = { from_phase: phaseId, reason: error };
  return updateManifest(projectRoot, manifest, {
    phases,
    status: "partial",
    resume,
  });
}

export async function skipPhase(
  projectRoot: string,
  manifest: RunManifest,
  phaseId: RunPhaseId,
): Promise<RunManifest> {
  const phases = manifest.phases.map((phase) =>
    phase.id === phaseId ? { ...phase, status: "skipped" as const } : phase,
  );
  return updateManifest(projectRoot, manifest, { phases });
}

export async function finalizeRun(
  projectRoot: string,
  manifest: RunManifest,
  status: RunStatus,
  durationMs: number,
  cost: RunManifest["cost"],
): Promise<RunManifest> {
  return updateManifest(projectRoot, manifest, {
    status,
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
    cost,
    resume: status === "completed" ? null : manifest.resume,
  });
}

export interface IndexEntry {
  run_id: string;
  target_host: string;
  target_url: string;
  at: string;
  score: number;
  status: RunStatus;
  depth: AuditDepth;
  manifest: string;
}

export async function appendRunIndex(
  projectRoot: string,
  entry: IndexEntry,
): Promise<void> {
  const indexPath = runsIndexPath(projectRoot);
  await mkdir(path.dirname(indexPath), { recursive: true });
  await appendFile(indexPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export function manifestRelativePath(runId: string): string {
  return relativeRunPath(runId, RUN_REL_PATHS.manifest);
}
