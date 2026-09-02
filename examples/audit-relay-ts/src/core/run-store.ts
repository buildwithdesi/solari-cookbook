import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { RUN_REL_PATHS, runDir } from "./paths.js";
import type {
  BrowserObservation,
  Finding,
  ObservationBundle,
  PageObservation,
  RunManifest,
  SandboxObservation,
} from "../types.js";

export async function loadManifest(projectRoot: string, runId: string): Promise<RunManifest> {
  const manifestPath = path.join(runDir(projectRoot, runId), RUN_REL_PATHS.manifest);
  return JSON.parse(await readFile(manifestPath, "utf8")) as RunManifest;
}

export function normalizeRunId(input: string): string {
  const trimmed = input.trim().replace(/\\/g, "/");
  const parts = trimmed.split("/");
  return parts[parts.length - 1];
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

interface LegacySandboxObservation {
  headers: SandboxObservation["headers"];
  tlsRedirect: boolean;
  serverBanner: string | null;
  durationMs?: number;
  targetUrl?: string;
  probedAt?: string;
}

export async function loadSandboxObservation(
  projectRoot: string,
  runId: string,
  fallbackTargetUrl?: string,
): Promise<SandboxObservation | null> {
  const filePath = path.join(runDir(projectRoot, runId), RUN_REL_PATHS.sandboxObservation);
  const raw = await readJson<LegacySandboxObservation>(filePath);
  if (!raw) return null;

  return {
    targetUrl: raw.targetUrl ?? fallbackTargetUrl ?? "",
    headers: raw.headers,
    tlsRedirect: raw.tlsRedirect,
    serverBanner: raw.serverBanner,
    durationMs: raw.durationMs ?? 0,
    probedAt: raw.probedAt ?? new Date(0).toISOString(),
  };
}

interface LegacyBrowserObservation {
  targetUrl?: string;
  sessionId?: string;
  replayUrl?: string | null;
  durationMs?: number;
  probedAt?: string;
  pageErrors?: BrowserObservation["pageErrors"];
  pages: PageObservation[];
}

export async function loadBrowserObservation(
  projectRoot: string,
  runId: string,
  fallbackTargetUrl?: string,
): Promise<BrowserObservation | null> {
  const filePath = path.join(runDir(projectRoot, runId), RUN_REL_PATHS.browserObservation);
  const stored = await readJson<LegacyBrowserObservation>(filePath);

  if (!stored) return null;

  return {
    targetUrl: stored.targetUrl ?? fallbackTargetUrl ?? "",
    sessionId: stored.sessionId ?? "",
    replayUrl: stored.replayUrl ?? null,
    durationMs: stored.durationMs ?? 0,
    probedAt: stored.probedAt ?? new Date(0).toISOString(),
    pageErrors: stored.pageErrors ?? [],
    pages: stored.pages.map((page) => ({
      url: page.url,
      title: page.title,
      status: page.status,
      metaDescription: page.metaDescription,
      h1: page.h1,
      scriptCount: page.scriptCount,
      externalScriptHosts: page.externalScriptHosts,
      formCount: page.formCount,
      passwordFieldCount: page.passwordFieldCount,
      linkCount: page.linkCount,
      screenshotBase64: "",
      screenshotFile: page.screenshotFile ?? null,
    })),
  };
}

export async function loadObservationBundle(
  projectRoot: string,
  runId: string,
): Promise<ObservationBundle> {
  const manifest = await loadManifest(projectRoot, runId);
  const sandbox = await loadSandboxObservation(projectRoot, runId, manifest.target_url);
  const browser = await loadBrowserObservation(projectRoot, runId, manifest.target_url);

  return {
    targetUrl: manifest.target_url,
    sandbox,
    browser,
  };
}

function stripPageForDisk(page: PageObservation | { screenshotBase64?: string } & PageObservation) {
  return {
    url: page.url,
    title: page.title,
    status: page.status,
    metaDescription: page.metaDescription,
    h1: page.h1,
    scriptCount: page.scriptCount,
    externalScriptHosts: page.externalScriptHosts,
    formCount: page.formCount,
    passwordFieldCount: page.passwordFieldCount,
    linkCount: page.linkCount,
    screenshotFile: page.screenshotFile ?? null,
  };
}

export async function writeSandboxObservation(
  projectRoot: string,
  runId: string,
  observation: SandboxObservation,
): Promise<void> {
  const filePath = path.join(runDir(projectRoot, runId), RUN_REL_PATHS.sandboxObservation);
  await writeFile(filePath, JSON.stringify(observation, null, 2), "utf8");
}

export async function writeBrowserObservation(
  projectRoot: string,
  runId: string,
  observation: BrowserObservation,
): Promise<void> {
  const filePath = path.join(runDir(projectRoot, runId), RUN_REL_PATHS.browserObservation);
  const disk = {
    targetUrl: observation.targetUrl,
    sessionId: observation.sessionId,
    replayUrl: observation.replayUrl,
    durationMs: observation.durationMs,
    probedAt: observation.probedAt,
    pageErrors: observation.pageErrors,
    pages: observation.pages.map((page) => ({
      ...stripPageForDisk(page),
      screenshotFile: page.screenshotFile,
    })),
  };
  await writeFile(filePath, JSON.stringify(disk, null, 2), "utf8");
}

export async function writeFindingsFile(
  projectRoot: string,
  runId: string,
  findings: Finding[],
  registryVersion: string,
): Promise<void> {
  const filePath = path.join(runDir(projectRoot, runId), RUN_REL_PATHS.findings);
  await writeFile(
    filePath,
    JSON.stringify({ registry_version: registryVersion, findings }, null, 2),
    "utf8",
  );
}

export async function loadFindingsFile(
  projectRoot: string,
  runId: string,
): Promise<Finding[]> {
  const filePath = path.join(runDir(projectRoot, runId), RUN_REL_PATHS.findings);
  const parsed = await readJson<{ findings: Finding[] } | Finding[]>(filePath);
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  return parsed.findings;
}
