import { createHash } from "node:crypto";

export function normalizeTargetUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function slugifyHost(targetUrl: string): string {
  try {
    const hostname = new URL(normalizeTargetUrl(targetUrl)).hostname;
    return hostname.replace(/\./g, "-").toLowerCase();
  } catch {
    return "unknown-host";
  }
}

export function targetHost(targetUrl: string): string {
  try {
    return new URL(normalizeTargetUrl(targetUrl)).hostname;
  } catch {
    return "unknown";
  }
}

export function generateRunId(targetUrl: string, now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const slug = slugifyHost(targetUrl);
  const hash = createHash("sha256")
    .update(`${normalizeTargetUrl(targetUrl)}:${now.getTime()}`)
    .digest("hex")
    .slice(0, 4);
  return `${iso}-${slug}-${hash}`;
}
