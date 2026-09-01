import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { RUN_REL_PATHS, runDir } from "./paths.js";

export async function syncLatestRunToOutput(
  projectRoot: string,
  runId: string,
): Promise<{ outputDir: string; latestPointerPath: string }> {
  const sourceDir = runDir(projectRoot, runId);
  const outputDir = path.join(projectRoot, "output");
  const screenshotsOut = path.join(outputDir, "screenshots");

  await mkdir(outputDir, { recursive: true });
  await mkdir(screenshotsOut, { recursive: true });

  const copies: Array<{ from: string; to: string }> = [
    {
      from: path.join(sourceDir, RUN_REL_PATHS.manifest),
      to: path.join(outputDir, "manifest.json"),
    },
    {
      from: path.join(sourceDir, RUN_REL_PATHS.summary),
      to: path.join(outputDir, "summary.json"),
    },
    {
      from: path.join(sourceDir, RUN_REL_PATHS.findings),
      to: path.join(outputDir, "findings.json"),
    },
    {
      from: path.join(sourceDir, RUN_REL_PATHS.htmlReport),
      to: path.join(outputDir, "audit-report.html"),
    },
    {
      from: path.join(sourceDir, RUN_REL_PATHS.sandboxObservation),
      to: path.join(outputDir, "sandbox.json"),
    },
    {
      from: path.join(sourceDir, RUN_REL_PATHS.browserObservation),
      to: path.join(outputDir, "browser.json"),
    },
  ];

  for (const copy of copies) {
    try {
      await cp(copy.from, copy.to);
    } catch {
      // Partial runs may omit browser artifacts.
    }
  }

  const screenshotDir = path.join(sourceDir, RUN_REL_PATHS.screenshotDir);
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(screenshotDir);
    for (const file of files) {
      if (!file.endsWith(".png")) continue;
      await cp(path.join(screenshotDir, file), path.join(screenshotsOut, file));
    }
  } catch {
    // No screenshots on failed browser phase.
  }

  const legacyReport = path.join(outputDir, "audit-report.json");
  try {
    const summary = JSON.parse(await readFile(path.join(outputDir, "summary.json"), "utf8"));
    await writeFile(
      legacyReport,
      JSON.stringify({ ...summary, run_id: runId, note: "Legacy mirror. Prefer summary.json + manifest.json." }, null, 2),
      "utf8",
    );
  } catch {
    // summary missing on hard failure
  }

  const latestPointerPath = path.join(outputDir, "latest.json");
  await writeFile(
    latestPointerPath,
    JSON.stringify(
      {
        run_id: runId,
        manifest: `runs/${runId}/${RUN_REL_PATHS.manifest}`,
        summary: `runs/${runId}/${RUN_REL_PATHS.summary}`,
        html: `runs/${runId}/${RUN_REL_PATHS.htmlReport}`,
      },
      null,
      2,
    ),
    "utf8",
  );

  return { outputDir, latestPointerPath };
}
