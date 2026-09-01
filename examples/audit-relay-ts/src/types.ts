export type Severity = "critical" | "high" | "medium" | "low" | "pass";

export type AuditDepth = "quick" | "standard" | "deep";

export type RunStatus = "pending" | "running" | "completed" | "partial" | "failed";

export type RunPhaseId =
  | "observe.sandbox"
  | "observe.browser"
  | "interpret"
  | "score"
  | "render";

export type PhaseStatus = "pending" | "running" | "completed" | "skipped" | "failed";

export interface RunPhaseRecord {
  id: RunPhaseId;
  status: PhaseStatus;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  observation?: string;
  output?: string;
  artifact?: string;
  error?: string;
}

export interface RunManifest {
  schema_version: string;
  run_id: string;
  target_url: string;
  target_host: string;
  status: RunStatus;
  depth: AuditDepth;
  options: {
    skip_replay: boolean;
    max_extra_pages: number;
  };
  created_at: string;
  completed_at?: string;
  duration_ms?: number;
  cost?: {
    solari_browser_ms: number;
    solari_sandbox_ms: number;
    replay_polled: boolean;
  };
  phases: RunPhaseRecord[];
  agent_read_order: string[];
  resume: { from_phase: RunPhaseId; reason: string } | null;
}

export interface RunSummary {
  run_id: string;
  target_url: string;
  score: number;
  verdict: string;
  status: RunStatus;
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    pass: number;
    actionable: number;
  };
  top_findings: Array<{
    id: string;
    severity: Severity;
    title: string;
  }>;
}

export interface Finding {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  recommendation: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  status: number | null;
  screenshotBase64: string;
  screenshotFile: string | null;
  metaDescription: string | null;
  h1: string | null;
  scriptCount: number;
  externalScriptHosts: string[];
  formCount: number;
  passwordFieldCount: number;
  linkCount: number;
}

export interface HeaderCheck {
  name: string;
  present: boolean;
  value: string | null;
}

export interface SandboxAuditResult {
  headers: HeaderCheck[];
  tlsRedirect: boolean;
  serverBanner: string | null;
  findings: Finding[];
  durationMs: number;
}

export interface BrowserAuditResult {
  sessionId: string;
  replayUrl: string | null;
  pages: PageSnapshot[];
  findings: Finding[];
  durationMs: number;
}

export interface AuditRelayReport {
  runId: string;
  targetUrl: string;
  auditedAt: string;
  durationMs: number;
  sandboxMs: number;
  browserMs: number;
  status: RunStatus;
  browser: BrowserAuditResult | null;
  sandbox: SandboxAuditResult | null;
  findings: Finding[];
  score: number;
  verdict: string;
}

export interface AuditOptions {
  skipReplay?: boolean;
  maxExtraPages?: number;
  depth?: AuditDepth;
}
