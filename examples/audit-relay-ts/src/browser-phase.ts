import { Solari } from "@solarisdk/browser";

import { findingsFromPage } from "./findings.js";
import type { BrowserAuditResult, Finding, PageSnapshot } from "./types.js";

const MAX_EXTRA_PAGES = 2;

function normalizeTargetUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

async function capturePage(page: import("playwright-core").Page, url: string): Promise<PageSnapshot> {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  await page.waitForTimeout(1_500);

  const data = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll("script[src]"));
    const externalHosts = scripts
      .map((node) => {
        try {
          return new URL((node as HTMLScriptElement).src).hostname;
        } catch {
          return null;
        }
      })
      .filter((host): host is string => Boolean(host));

    const meta = document.querySelector('meta[name="description"]');

    return {
      title: document.title,
      metaDescription: meta?.getAttribute("content") ?? null,
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      scriptCount: scripts.length,
      externalScriptHosts: [...new Set(externalHosts)].slice(0, 12),
      formCount: document.querySelectorAll("form").length,
      passwordFieldCount: document.querySelectorAll('input[type="password"]').length,
      linkCount: document.querySelectorAll("a[href]").length,
    };
  });

  const screenshot = await page.screenshot({ fullPage: true, type: "png" });

  return {
    url,
    title: data.title,
    status: response?.status() ?? null,
    screenshotBase64: screenshot.toString("base64"),
    metaDescription: data.metaDescription,
    h1: data.h1,
    scriptCount: data.scriptCount,
    externalScriptHosts: data.externalScriptHosts,
    formCount: data.formCount,
    passwordFieldCount: data.passwordFieldCount,
    linkCount: data.linkCount,
  };
}

async function discoverInternalLinks(
  page: import("playwright-core").Page,
  origin: string,
): Promise<string[]> {
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((node) => (node as HTMLAnchorElement).href)
      .filter(Boolean),
  );

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const href of hrefs) {
    try {
      const parsed = new URL(href);
      if (parsed.origin !== origin) continue;
      const clean = `${parsed.origin}${parsed.pathname}`;
      if (seen.has(clean)) continue;
      seen.add(clean);
      candidates.push(clean);
    } catch {
      continue;
    }
  }

  return candidates.slice(1, 1 + MAX_EXTRA_PAGES);
}

async function pollReplayUrl(
  solari: Solari,
  sessionId: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    try {
      const replay = await solari.sessions.getReplayUrl(sessionId);
      if (replay?.url) {
        return replay.url;
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        console.log(`  replay attempt ${attempt}: not ready yet`);
        continue;
      }
      console.warn("  replay poll error:", error);
      return null;
    }
  }
  return null;
}

export async function runBrowserAudit(rawUrl: string): Promise<BrowserAuditResult> {
  const targetUrl = normalizeTargetUrl(rawUrl);
  const origin = new URL(targetUrl).origin;
  const isHttps = targetUrl.startsWith("https://");

  const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! });
  const browser = await solari.launch({
    stealth: true,
    recording: true,
    proxy: "us",
  });

  const pages: PageSnapshot[] = [];
  const findings: Finding[] = [];

  const sessionId = browser.id;

  try {
    const page = await browser.newPage();
    console.log("browser: capturing landing page");
    const landing = await capturePage(page, targetUrl);
    pages.push(landing);
    findings.push(...findingsFromPage(landing, isHttps));

    const extraUrls = await discoverInternalLinks(page, origin);
    for (const extraUrl of extraUrls) {
      console.log(`browser: capturing ${extraUrl}`);
      try {
        const snapshot = await capturePage(page, extraUrl);
        pages.push(snapshot);
        findings.push(...findingsFromPage(snapshot, extraUrl.startsWith("https://")));
      } catch (error) {
        findings.push({
          id: `page-error-${extraUrl}`,
          severity: "low",
          category: "Coverage",
          title: "Secondary page failed to load",
          detail: `${extraUrl}: ${error instanceof Error ? error.message : String(error)}`,
          recommendation: "Check routing, auth walls, or bot protection on inner pages.",
        });
      }
    }

    await page.waitForTimeout(2_000);
  } finally {
    await browser.close();
  }

  console.log("browser: polling session replay");
  const replayUrl = await pollReplayUrl(solari, sessionId);
  await solari.close();

  return {
    sessionId,
    replayUrl,
    pages,
    findings,
  };
}
