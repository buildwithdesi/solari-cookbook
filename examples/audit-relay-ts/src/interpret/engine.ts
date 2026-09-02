import {
  HEADER_CHECKS,
  REGISTRY_VERSION,
  SCRIPT_HEAVY_THRESHOLD,
} from "../registry/checks.js";
import type {
  BrowserObservation,
  Finding,
  FindingEvidence,
  ObservationBundle,
  PageSnapshot,
  SandboxObservation,
  Severity,
} from "../types.js";
import { dedupeFindings, sortFindings } from "../score/compute.js";

const SANDBOX_OBS = "observations/sandbox.json";
const BROWSER_OBS = "observations/browser.json";

function scopedId(checkId: string, url?: string): string {
  if (!url) return checkId;
  return `${checkId}@${url}`;
}

function makeFinding(input: {
  check_id: string;
  status: Finding["status"];
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  recommendation: string;
  evidence: FindingEvidence[];
  scope?: { url?: string };
}): Finding {
  return {
    check_id: input.check_id,
    id: scopedId(input.check_id, input.scope?.url),
    status: input.status,
    severity: input.severity,
    category: input.category,
    title: input.title,
    detail: input.detail,
    recommendation: input.recommendation,
    evidence: input.evidence,
    scope: input.scope,
  };
}

function interpretSandbox(obs: SandboxObservation): Finding[] {
  const findings: Finding[] = [];

  for (const def of HEADER_CHECKS) {
    const header = obs.headers.find((item) => item.name === def.headerName);
    const present = header?.present ?? false;
    if (present) {
      findings.push(
        makeFinding({
          check_id: def.checkId,
          status: "pass",
          severity: "pass",
          category: def.category,
          title: `${def.headerName} is set`,
          detail: header?.value ?? "Present",
          recommendation: "Keep this header on every response.",
          evidence: [
            {
              observation: SANDBOX_OBS,
              path: `$.headers[?(@.name=="${def.headerName}")].present`,
              value: "true",
            },
          ],
        }),
      );
      continue;
    }

    findings.push(
      makeFinding({
        check_id: def.checkId,
        status: "fail",
        severity: def.failSeverity,
        category: def.category,
        title: `${def.headerName} is missing`,
        detail: "Response did not include this security header.",
        recommendation: `Add ${def.headerName} at the edge or in your app middleware.`,
        evidence: [
          {
            observation: SANDBOX_OBS,
            path: `$.headers[?(@.name=="${def.headerName}")].present`,
            value: "false",
          },
        ],
      }),
    );
  }

  if (obs.tlsRedirect) {
    findings.push(
      makeFinding({
        check_id: "transport.http-to-https-redirect",
        status: "pass",
        severity: "pass",
        category: "Transport",
        title: "HTTP redirects to HTTPS",
        detail: `http://${new URL(obs.targetUrl).host} upgrades to HTTPS.`,
        recommendation: "Keep redirect and add HSTS for repeat visitors.",
        evidence: [
          { observation: SANDBOX_OBS, path: "$.tlsRedirect", value: "true" },
        ],
      }),
    );
  } else {
    findings.push(
      makeFinding({
        check_id: "transport.http-to-https-redirect",
        status: "fail",
        severity: "high",
        category: "Transport",
        title: "HTTP does not redirect to HTTPS",
        detail: "Plain HTTP did not upgrade to TLS.",
        recommendation: "Add a permanent redirect from HTTP to HTTPS.",
        evidence: [
          { observation: SANDBOX_OBS, path: "$.tlsRedirect", value: "false" },
        ],
      }),
    );
  }

  if (obs.serverBanner) {
    findings.push(
      makeFinding({
        check_id: "fingerprint.server-banner",
        status: "fail",
        severity: "low",
        category: "Fingerprint",
        title: "Server banner exposed",
        detail: obs.serverBanner,
        recommendation: "Strip or genericize the Server header at the edge.",
        evidence: [
          {
            observation: SANDBOX_OBS,
            path: "$.serverBanner",
            value: obs.serverBanner,
          },
        ],
      }),
    );
  }

  return findings;
}

function interpretPage(page: PageSnapshot, isHttps: boolean): Finding[] {
  const findings: Finding[] = [];
  const scope = { url: page.url };

  if (page.passwordFieldCount > 0 && !isHttps) {
    findings.push(
      makeFinding({
        check_id: "transport.password-field-on-http",
        status: "fail",
        severity: "critical",
        category: "Transport",
        title: "Password field on non-HTTPS page",
        detail: `${page.passwordFieldCount} password field(s) on ${page.url}.`,
        recommendation: "Force HTTPS before any credential input.",
        evidence: [
          {
            observation: BROWSER_OBS,
            path: `$.pages[?(@.url=="${page.url}")].passwordFieldCount`,
            value: String(page.passwordFieldCount),
          },
        ],
        scope,
      }),
    );
  }

  if (page.scriptCount > SCRIPT_HEAVY_THRESHOLD) {
    findings.push(
      makeFinding({
        check_id: "surface.script-heavy",
        status: "fail",
        severity: "medium",
        category: "Surface",
        title: "Heavy third-party script load",
        detail: `${page.scriptCount} script tags detected.`,
        recommendation: "Audit third-party scripts and defer non-critical loads.",
        evidence: [
          {
            observation: BROWSER_OBS,
            path: `$.pages[?(@.url=="${page.url}")].scriptCount`,
            value: String(page.scriptCount),
          },
        ],
        scope,
      }),
    );
  }

  if (!page.metaDescription) {
    findings.push(
      makeFinding({
        check_id: "page.meta-description",
        status: "fail",
        severity: "low",
        category: "SEO",
        title: "Missing meta description",
        detail: "No meta description tag found on this page.",
        recommendation: "Add a concise meta description for search and social previews.",
        evidence: [
          {
            observation: BROWSER_OBS,
            path: `$.pages[?(@.url=="${page.url}")].metaDescription`,
            value: "null",
          },
        ],
        scope,
      }),
    );
  }

  if (!page.h1) {
    findings.push(
      makeFinding({
        check_id: "page.h1-present",
        status: "fail",
        severity: "low",
        category: "Accessibility",
        title: "Missing H1",
        detail: "No H1 heading found on the page.",
        recommendation: "Add one clear H1 that states the page purpose.",
        evidence: [
          {
            observation: BROWSER_OBS,
            path: `$.pages[?(@.url=="${page.url}")].h1`,
            value: "null",
          },
        ],
        scope,
      }),
    );
  }

  return findings;
}

function interpretBrowser(obs: BrowserObservation): Finding[] {
  const findings: Finding[] = [];

  for (const page of obs.pages) {
    findings.push(...interpretPage(page, page.url.startsWith("https://")));
  }

  for (const error of obs.pageErrors) {
    findings.push(
      makeFinding({
        check_id: "coverage.secondary-page-error",
        status: "fail",
        severity: "low",
        category: "Coverage",
        title: "Secondary page failed to load",
        detail: `${error.url}: ${error.message}`,
        recommendation: "Check routing, auth walls, or bot protection on inner pages.",
        evidence: [
          {
            observation: BROWSER_OBS,
            path: `$.pageErrors[?(@.url=="${error.url}")].message`,
            value: error.message,
          },
        ],
        scope: { url: error.url },
      }),
    );
  }

  return findings;
}

export function interpretObservations(bundle: ObservationBundle): Finding[] {
  const findings: Finding[] = [];

  if (bundle.sandbox) {
    findings.push(...interpretSandbox(bundle.sandbox));
  }
  if (bundle.browser) {
    findings.push(...interpretBrowser(bundle.browser));
  }

  return sortFindings(dedupeFindings(findings));
}

export function getRegistryVersion(): string {
  return REGISTRY_VERSION;
}
