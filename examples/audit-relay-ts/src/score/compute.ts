import type { Severity } from "../types.js";

export function severityRank(severity: Severity): number {
  switch (severity) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    case "pass":
      return 4;
    default: {
      const _exhaustive: never = severity;
      return _exhaustive;
    }
  }
}

export function dedupeFindings<T extends { id: string }>(findings: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const finding of findings) {
    if (seen.has(finding.id)) continue;
    seen.add(finding.id);
    unique.push(finding);
  }
  return unique;
}

export function computeScore(findings: Array<{ severity: Severity }>): number {
  let score = 100;
  for (const finding of findings) {
    switch (finding.severity) {
      case "critical":
        score -= 25;
        break;
      case "high":
        score -= 12;
        break;
      case "medium":
        score -= 6;
        break;
      case "low":
        score -= 2;
        break;
      case "pass":
        break;
      default: {
        const _exhaustive: never = finding.severity;
        void _exhaustive;
      }
    }
  }
  return Math.max(0, Math.min(100, score));
}

export function scoreVerdict(score: number): string {
  if (score >= 85) return "Strong posture. Ship with minor polish.";
  if (score >= 70) return "Solid base. Fix high items before client handoff.";
  if (score >= 50) return "Needs work. Address transport and header gaps first.";
  return "High risk. Treat as pre-production.";
}

export function sortFindings<T extends { severity: Severity }>(findings: T[]): T[] {
  return [...findings].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );
}
