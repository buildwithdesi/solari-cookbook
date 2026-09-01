# AuditRelay System Design

**Agent-first client audit on Solari.**

This document defines AuditRelay as a **coherent synthetic system**, not a bag of scripts. Every layer exists so an autonomous agent can understand state accurately, control execution precisely, and accumulate knowledge across runs with minimal resource waste.

Human HTML is one render target. The **canonical truth** is structured, versioned, run-scoped data.

---

## 1. Design thesis

An agent driving AuditRelay needs three guarantees:

| Guarantee | Meaning |
|-----------|---------|
| **Legibility** | One file (`manifest.json`) tells the agent where the run is, what finished, what failed, and what to read next. |
| **Control** | Depth, cost, and scope are explicit knobs. The agent never guesses which flags to combine. |
| **Accretion** | Each run appends to history. The agent can diff, trend, and reuse cached observations without re-probing Solari. |

**Resource discipline:** Solari browser and sandbox minutes cost money and latency. Pure interpretation (scoring, findings, HTML) is free and must be **replayable from cache** without touching the API.

---

## 2. Abstraction tower

Read bottom-up. Each layer references only the layer below by stable IDs and paths.

```
┌─────────────────────────────────────────────────────────────┐
│ L4  MISSION    "Produce client-ready audit for URL X"       │
├─────────────────────────────────────────────────────────────┤
│ L3  RUN        manifest.json — orchestration envelope       │
├─────────────────────────────────────────────────────────────┤
│ L2  PHASE      observe → interpret → score → render         │
├─────────────────────────────────────────────────────────────┤
│ L1  OBSERVATION raw facts (headers, DOM stats, timings)     │
├─────────────────────────────────────────────────────────────┤
│ L0  ARTIFACT   png, curl stdout, replay URL, html             │
└─────────────────────────────────────────────────────────────┘
```

### L0 — Artifacts

Immutable blobs produced by probes or renders.

- `artifacts/screenshots/page-{n}.png`
- `artifacts/sandbox/curl-https.txt`
- `artifacts/sandbox/curl-http.txt`
- `artifacts/browser/replay.url` (text file, not embedded in JSON)
- `artifacts/render/report.html` (optional human surface)

**Rule:** Large binaries never inline in JSON. JSON holds paths and byte sizes only.

### L1 — Observations

Structured facts extracted from artifacts. No severity, no recommendations.

- `observations/sandbox.json` — header map, TLS redirect bool, server banner, curl exit codes
- `observations/browser.json` — per-page DOM stats, HTTP status, script hosts, timings

Observations are **append-only within a run**. If a phase retries, write `observations/sandbox.v2.json` and point manifest at latest.

### L2 — Phases

Four phases. Each emits a phase record in manifest.

| Phase | Input | Output | Solari cost |
|-------|-------|--------|-------------|
| **observe.sandbox** | target URL | L1 sandbox obs + L0 curl files | sandbox VM |
| **observe.browser** | target URL + crawl policy | L1 browser obs + L0 screenshots | browser session |
| **interpret** | L1 observations | `findings.json` | none |
| **score** | findings | `summary.json` (score, verdict, counts) | none |
| **render** | summary + findings + obs | L0 HTML (optional) | none |

**interpret** and **score** are pure functions. Same observations always produce same findings (given registry version).

### L3 — Run envelope

Directory: `runs/{run_id}/`

`run_id` format: `{YYYYMMDDTHHmmssZ}-{host-slug}-{short-hash}`  
Example: `20260901T060000Z-digitalalchemy-dev-a3f2`

**`manifest.json`** is the single entry point an agent reads first.

```json
{
  "schema_version": "1.0",
  "run_id": "20260901T060000Z-digitalalchemy-dev-a3f2",
  "target_url": "https://digitalalchemy.dev",
  "status": "completed",
  "depth": "standard",
  "created_at": "2026-09-01T06:00:00.000Z",
  "completed_at": "2026-09-01T06:00:59.000Z",
  "duration_ms": 59000,
  "cost": {
    "solari_browser_ms": 59000,
    "solari_sandbox_ms": 8000,
    "replay_polled": false
  },
  "phases": [
    { "id": "observe.sandbox", "status": "completed", "duration_ms": 8000, "observation": "observations/sandbox.json" },
    { "id": "observe.browser", "status": "completed", "duration_ms": 59000, "observation": "observations/browser.json" },
    { "id": "interpret", "status": "completed", "duration_ms": 12, "output": "findings.json" },
    { "id": "score", "status": "completed", "duration_ms": 3, "output": "summary.json" },
    { "id": "render", "status": "completed", "duration_ms": 45, "artifact": "artifacts/render/report.html" }
  ],
  "agent_read_order": [
    "summary.json",
    "findings.json",
    "observations/sandbox.json",
    "observations/browser.json",
    "artifacts/render/report.html"
  ],
  "resume": null
}
```

Partial failure example: browser dies, sandbox succeeds → `status: "partial"`, `resume: { "from_phase": "observe.browser" }`.

### L4 — Mission

External intent, not stored in repo. Examples:

- Solari hiring demo (standard depth, render on)
- Client pre-call triage (quick depth, no render)
- Regression watch (standard depth, diff against last run)

Mission maps to **depth profile** + **render policy**.

---

## 3. Depth profiles (control surface)

Replace flag soup with three profiles. Agent picks one.

| Profile | observe.sandbox | observe.browser | replay poll | extra pages | render |
|---------|-----------------|-----------------|-------------|-------------|--------|
| **quick** | yes | no | no | 0 | optional |
| **standard** | yes | yes | yes | 2 | yes |
| **deep** | yes | yes | yes | 5 | yes + future probes |

**Env mapping (transitional):**

- `AUDIT_DEPTH=quick|standard|deep` (primary)
- Legacy: `AUDIT_SKIP_REPLAY=1` → standard without replay poll
- Legacy: `AUDIT_LANDING_ONLY=1` → standard with 0 extra pages

**Budget caps (future):**

```json
{ "max_duration_ms": 120000, "max_pages": 3, "allow_replay_poll": true }
```

Run aborts cleanly and writes partial manifest when cap hit.

---

## 4. Finding model (interpret layer)

Findings are **interpretations** of observations via a versioned **check registry**.

```json
{
  "check_id": "header.strict-transport-security",
  "severity": "high",
  "status": "fail",
  "title": "strict-transport-security is missing",
  "detail": "Response did not include this security header.",
  "recommendation": "Add strict-transport-security at the edge or in your app middleware.",
  "evidence": [
    { "observation": "observations/sandbox.json", "path": "$.headers['strict-transport-security']" }
  ],
  "scope": { "url": "https://digitalalchemy.dev" }
}
```

**Stable `check_id`** enables accretion: diff run N vs N-1 by check, not by generated UUID.

Registry lives in `docs/CHECK-REGISTRY.md` and eventually `registry/checks.json`.

Severity is assigned by registry rules, not ad hoc in phase code.

---

## 5. Accretion (cross-run memory)

Each completed run appends one line to `runs/index.jsonl`:

```json
{"run_id":"...","target_host":"digitalalchemy.dev","at":"...","score":98,"depth":"standard","manifest":"runs/.../manifest.json"}
```

**Agent workflows enabled:**

- `last run for host` → read index, open latest manifest
- `score trend` → scan index lines for same `target_host`
- `what regressed` → diff `findings.json` check_ids between two run_ids
- `re-score only` → load cached observations, run interpret+score+render (zero Solari)

**Never overwrite** a run directory. `output/` at project root becomes a symlink or copy of **latest** run for human convenience only.

---

## 6. Event stream (optional, phase 2)

For long runs, phases append NDJSON to `runs/{run_id}/events.ndjson`:

```json
{"ts":"...","event":"phase.start","phase":"observe.browser"}
{"ts":"...","event":"page.captured","url":"...","index":1}
{"ts":"...","event":"phase.end","phase":"observe.browser","duration_ms":59000}
```

Agents tail this file instead of parsing stdout. Stdout becomes human-readable mirror only.

---

## 7. Module boundaries (cohesion)

```
src/
  core/
    run-id.ts          # generate run_id, paths
    manifest.ts        # read/write/validate manifest
    config.ts          # depth profiles, env, config file merge
  observe/
    sandbox.ts         # L0+L1 sandbox only
    browser.ts         # L0+L1 browser only
  interpret/
    registry.ts        # check definitions
    engine.ts          # observations → findings
  score/
    compute.ts         # findings → summary
  render/
    html.ts            # summary → HTML
  accrete/
    index.ts           # append index.jsonl, query last run
  cli/
    main.ts            # argv → run pipeline
  api/
    run-audit.ts       # programmatic entry for agents
```

**Dependency rule:** `observe/*` may import Solari SDK. `interpret/*` and below must not.

---

## 8. Agent read path (default)

Minimize tokens. Default agent session:

1. Read `runs/index.jsonl` tail for host (or accept explicit run_id)
2. Read `runs/{run_id}/manifest.json` (< 2 KB)
3. Read `runs/{run_id}/summary.json` (< 1 KB)
4. Only if needed: `findings.json`, then observations, then screenshots (vision)

Do **not** read HTML unless rendering for a human or visual check.

---

## 9. Coherence rules (non-negotiable)

1. **One run, one directory.** No shared mutable `output/` as source of truth.
2. **Observations before opinions.** Findings never embed raw curl or base64.
3. **Checks are stable.** `check_id` survives URL and run changes.
4. **Pure interpret/score.** Re-run without Solari when observations exist.
5. **Manifest is complete.** If a file exists on disk, manifest lists it.
6. **Fail partial, resume explicit.** Never silent empty output on error.
7. **Schema version in manifest.** Agents detect breaking changes.

---

## 10. Relationship to Solari cookbook

AuditRelay is the **reference agent-native example** in this fork:

- Cookbook examples = single-primitive demos (L0 tutorials)
- AuditRelay = full L4 system showing browser + sandbox orchestration with accretion

Future cookbook contribution: link here from root README as "production-shaped agent workflow."

---

## 11. Current vs target

| Capability | v0 (shipped) | v1 (plan) |
|------------|--------------|-----------|
| Run envelope | flat `output/` | `runs/{run_id}/` + manifest |
| Observations split | merged in report JSON | separate L1 files |
| Check IDs | generated per URL | stable registry IDs |
| Depth control | env flags | `AUDIT_DEPTH` profiles |
| Accretion | none | `index.jsonl` + diff |
| Re-score cache | no | interpret from cached obs |
| Agent entry | README | AGENTS.md decision tree |
| Event stream | stdout only | events.ndjson |

See `PLAN.md` for implementation sequence.
