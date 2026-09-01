import assert from "node:assert/strict";

import { generateRunId, normalizeTargetUrl, slugifyHost } from "./src/core/run-id.js";
import {
  computeScore,
  dedupeFindings,
  findingsFromHeaders,
  findingsFromTlsRedirect,
  scoreVerdict,
} from "./src/findings.js";
import { buildSummary, finalizeReport } from "./src/report.js";
import type { Finding } from "./src/types.js";

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  pass: ${name}`);
  } catch (error) {
    console.error(`  fail: ${name}`);
    throw error;
  }
}

console.log("AuditRelay unit tests\n");

test("computeScore penalizes severity tiers", () => {
  const findings: Finding[] = [
    {
      id: "a",
      severity: "critical",
      category: "x",
      title: "t",
      detail: "d",
      recommendation: "r",
    },
    {
      id: "b",
      severity: "high",
      category: "x",
      title: "t",
      detail: "d",
      recommendation: "r",
    },
    {
      id: "c",
      severity: "pass",
      category: "x",
      title: "t",
      detail: "d",
      recommendation: "r",
    },
  ];
  assert.equal(computeScore(findings), 63);
});

test("dedupeFindings keeps first occurrence", () => {
  const findings: Finding[] = [
    {
      id: "dup",
      severity: "low",
      category: "x",
      title: "first",
      detail: "d",
      recommendation: "r",
    },
    {
      id: "dup",
      severity: "high",
      category: "x",
      title: "second",
      detail: "d",
      recommendation: "r",
    },
  ];
  const deduped = dedupeFindings(findings);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].title, "first");
});

test("findingsFromHeaders marks missing CSP as high", () => {
  const findings = findingsFromHeaders([
    { name: "content-security-policy", present: false, value: null },
  ]);
  assert.equal(findings[0].severity, "high");
});

test("findingsFromTlsRedirect passes on redirect", () => {
  const findings = findingsFromTlsRedirect(true, "https://example.com");
  assert.equal(findings[0].severity, "pass");
});

test("scoreVerdict maps score bands", () => {
  assert.match(scoreVerdict(90), /Strong posture/);
  assert.match(scoreVerdict(75), /Solid base/);
  assert.match(scoreVerdict(55), /Needs work/);
  assert.match(scoreVerdict(30), /High risk/);
});

test("generateRunId is stable shaped", () => {
  const id = generateRunId("https://digitalalchemy.dev", new Date("2026-09-01T06:00:00.000Z"));
  assert.match(id, /^20260901T060000Z-digitalalchemy-dev-[a-f0-9]{4}$/);
});

test("normalizeTargetUrl adds https", () => {
  assert.equal(normalizeTargetUrl("example.com"), "https://example.com");
});

test("slugifyHost converts dots", () => {
  assert.equal(slugifyHost("https://digitalalchemy.dev"), "digitalalchemy-dev");
});

test("buildSummary counts actionable findings", () => {
  const report = finalizeReport(
    "run-test",
    "https://example.com",
    Date.now() - 1000,
    null,
    {
      headers: [],
      tlsRedirect: false,
      serverBanner: null,
      findings: [
        {
          id: "header-missing-csp",
          severity: "high",
          category: "Headers",
          title: "csp missing",
          detail: "d",
          recommendation: "r",
        },
      ],
      durationMs: 100,
    },
    "partial",
  );
  const summary = buildSummary(report);
  assert.equal(summary.counts.actionable, 1);
  assert.equal(summary.counts.high, 1);
  assert.equal(summary.run_id, "run-test");
});

console.log("\nAll tests passed.");
