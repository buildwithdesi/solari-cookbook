import { SolariClient } from "@solarisdk/sdk";

import { requiredHeaderNames } from "./registry/checks.js";
import type { HeaderCheck, SandboxObservation } from "../types.js";

function parseHeaders(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("HTTP/")) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    map.set(name, value);
  }
  return map;
}

function headerChecks(raw: string): HeaderCheck[] {
  const parsed = parseHeaders(raw);
  return requiredHeaderNames().map((name) => ({
    name,
    present: parsed.has(name),
    value: parsed.get(name) ?? null,
  }));
}

export async function observeSandbox(targetUrl: string): Promise<SandboxObservation> {
  const startedAt = Date.now();
  const normalized = /^https?:\/\//i.test(targetUrl)
    ? targetUrl
    : `https://${targetUrl}`;
  const parsed = new URL(normalized);
  const httpsUrl = `https://${parsed.host}${parsed.pathname}`;
  const httpUrl = `http://${parsed.host}${parsed.pathname}`;

  const client = new SolariClient({ apiKey: process.env.SOLARI_API_KEY! });
  const sandbox = await client.sandboxes.create({
    template: "base",
    timeoutMs: 5 * 60_000,
  });

  console.log("sandbox:", sandbox.sandboxId);

  try {
    await sandbox.connect();

    const httpsHeaders = await sandbox.commands.run("curl", {
      args: ["-sSI", "--max-time", "20", httpsUrl],
    });

    const httpHeaders = await sandbox.commands.run("curl", {
      args: ["-sSI", "--max-time", "20", httpUrl],
    });

    const headerList = headerChecks(httpsHeaders.stdout);
    const tlsRedirect =
      httpHeaders.stdout.includes("301") ||
      httpHeaders.stdout.includes("302") ||
      httpHeaders.stdout.includes("307") ||
      httpHeaders.stdout.includes("308") ||
      httpHeaders.stdout.toLowerCase().includes("location: https://");

    const serverLine = httpsHeaders.stdout
      .split(/\r?\n/)
      .find((line) => line.toLowerCase().startsWith("server:"));

    const serverBanner = serverLine ? serverLine.split(":").slice(1).join(":").trim() : null;

    return {
      targetUrl: normalized,
      headers: headerList,
      tlsRedirect,
      serverBanner,
      durationMs: Date.now() - startedAt,
      probedAt: new Date().toISOString(),
    };
  } finally {
    await sandbox.kill();
  }
}

/** @deprecated use observeSandbox */
export const runSandboxAudit = observeSandbox;
