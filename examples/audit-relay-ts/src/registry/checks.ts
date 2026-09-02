import type { Severity } from "../types.js";

export const REGISTRY_VERSION = "1.0";

export const SCRIPT_HEAVY_THRESHOLD = 15;

export interface HeaderCheckDef {
  headerName: string;
  checkId: string;
  failSeverity: Severity;
  category: string;
}

export const HEADER_CHECKS: HeaderCheckDef[] = [
  {
    headerName: "strict-transport-security",
    checkId: "header.strict-transport-security",
    failSeverity: "high",
    category: "Headers",
  },
  {
    headerName: "content-security-policy",
    checkId: "header.content-security-policy",
    failSeverity: "high",
    category: "Headers",
  },
  {
    headerName: "x-content-type-options",
    checkId: "header.x-content-type-options",
    failSeverity: "medium",
    category: "Headers",
  },
  {
    headerName: "x-frame-options",
    checkId: "header.x-frame-options",
    failSeverity: "medium",
    category: "Headers",
  },
  {
    headerName: "referrer-policy",
    checkId: "header.referrer-policy",
    failSeverity: "medium",
    category: "Headers",
  },
  {
    headerName: "permissions-policy",
    checkId: "header.permissions-policy",
    failSeverity: "medium",
    category: "Headers",
  },
];

export function requiredHeaderNames(): string[] {
  return HEADER_CHECKS.map((check) => check.headerName);
}
