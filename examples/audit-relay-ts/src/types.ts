export type Severity = "critical" | "high" | "medium" | "low" | "pass";

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
  targetUrl: string;
  auditedAt: string;
  durationMs: number;
  sandboxMs: number;
  browserMs: number;
  browser: BrowserAuditResult;
  sandbox: SandboxAuditResult;
  findings: Finding[];
  score: number;
  verdict: string;
}

export interface AuditOptions {
  skipReplay?: boolean;
  maxExtraPages?: number;
}
