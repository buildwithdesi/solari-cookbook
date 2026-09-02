import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateRunId, normalizeTargetUrl, slugifyHost } from "./src/core/run-id.js";
import { computeScore, dedupeFindings, scoreVerdict } from "./src/findings.js";
import { getRegistryVersion, interpretObservations } from "./src/interpret/engine.js";
import { buildReport, buildSummary } from "./src/report.js";
import type {
  BrowserObservation,
  Finding,
  ObservationBundle,
  SandboxObservation,
} from "./src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  pass: ${name}`);
  } catch (error) {
    console.error(`  fail: ${name}`);
    throw error;
  }
}

function loadFixture<T>(filename: string): T {
  return JSON.parse(readFileSync(path.join(__dirname, "test/fixtures", filename), "utf8")) as T;
}

function finding(checkId: string, severity: Finding["severity"]): Finding {
  return {
    check_id: checkId,
    id: checkId,
    status: severity === "pass" ? "pass" : "fail",
    severity,
    category: "test",
    title: checkId,
    detail: "detail",
    recommendation: "fix",
    evidence: [{ observation: "observations/sandbox.json", path: "$.test", value: "x" }],
  };
}

console.log("AuditRelay unit tests\n");

test("computeScore penalizes severity tiers", () => {
  const findings: Finding[] = [
    finding("a", "critical"),
    finding("b", "high"),
    finding("c", "pass"),
  ];
  assert.equal(computeScore(findings), 63);
});

test("dedupeFindings keeps first occurrence", () => {
  const findings: Finding[] = [
    { ...finding("dup", "low"), title: "first" },
    { ...finding("dup", "high"), title: "second" },
  ];
  const deduped = dedupeFindings(findings);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].title, "first");
});

test("interpretObservations flags missing CSP as high", () => {
  const sandbox = loadFixture<SandboxObservation>("sandbox-example.json");
  const bundle: ObservationBundle = { targetUrl: sandbox.targetUrl, sandbox, browser: null };
  const findings = interpretObservations(bundle);
  const csp = findings.find((item) => item.check_id === "header.content-security-policy");
  assert.ok(csp);
  assert.equal(csp.severity, "high");
  assert.equal(csp.status, "fail");
  assert.ok(csp.evidence.length > 0);
});

test("interpretObservations passes TLS redirect", () => {
  const sandbox = loadFixture<SandboxObservation>("sandbox-example.json");
  const findings = interpretObservations({ targetUrl: sandbox.targetUrl, sandbox, browser: null });
  const tls = findings.find((item) => item.check_id === "transport.http-to-https-redirect");
  assert.ok(tls);
  assert.equal(tls.severity, "pass");
});

test("interpretObservations detects script-heavy page", () => {
  const browser = loadFixture<BrowserObservation>("browser-example.json");
  const findings = interpretObservations({
    targetUrl: browser.targetUrl,
    sandbox: null,
    browser,
  });
  const heavy = findings.find((item) => item.check_id === "surface.script-heavy");
  assert.ok(heavy);
  assert.equal(heavy.severity, "medium");
  assert.equal(heavy.scope?.url, "https://example.com");
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
  const sandbox = loadFixture<SandboxObservation>("sandbox-example.json");
  const browser = loadFixture<BrowserObservation>("browser-example.json");
  const findings = interpretObservations({
    targetUrl: sandbox.targetUrl,
    sandbox,
    browser,
  });
  const report = buildReport(
    "run-test",
    sandbox.targetUrl,
    Date.now() - 1000,
    sandbox,
    browser,
    findings,
    "completed",
    getRegistryVersion(),
  );
  const summary = buildSummary(report);
  assert.ok(summary.counts.actionable >= 1);
  assert.equal(summary.run_id, "run-test");
  assert.ok(summary.top_findings.every((item) => item.check_id.length > 0));
});

test("getRegistryVersion is semver shaped", () => {
  assert.match(getRegistryVersion(), /^\d+\.\d+$/);
});

console.log("\nAll tests passed.");
