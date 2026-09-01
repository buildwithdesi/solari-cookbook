# AuditRelay Implementation Plan

**Goal:** Evolve v0 (working demo) into an agent-native audit system per `DESIGN.md`.

Priority order optimizes **agent legibility and accretion** before feature sprawl.

---

## Phase 0 — Documentation baseline ✅

**Status:** Done (this commit)

Deliverables:

- [x] `DESIGN.md` — abstraction tower, run envelope, depth profiles
- [x] `AGENTS.md` — agent decision tree and read order
- [x] `docs/CHECK-REGISTRY.md` — stable check IDs
- [x] `PLAN.md` — this file
- [x] README pointer to agent docs

**Exit criteria:** An agent with zero codebase context can drive the system from docs alone.

---

## Phase 1 — Run envelope (highest leverage)

**Problem:** `output/` overwrites every run. Agents lose history and cannot diff.

**Work:**

1. Add `src/core/run-id.ts` — generate `run_id`, create `runs/{run_id}/`
2. Add `src/core/manifest.ts` — write/update manifest through phase lifecycle
3. Redirect all artifacts into run directory:
   - `observations/sandbox.json`
   - `observations/browser.json`
   - `findings.json`
   - `summary.json`
   - `artifacts/screenshots/`
   - `artifacts/render/report.html`
4. Keep `output/` as copy or symlink to **latest** run (human ergonomics)
5. Append `runs/index.jsonl` on completion

**CLI:**

```bash
npm run audit -- https://example.com
# prints: run_id, manifest path, summary score
```

**Exit criteria:**

- Two consecutive runs on same URL produce two directories
- Agent reads only `manifest.json` + `summary.json` to understand outcome
- Partial browser failure still writes sandbox observations + manifest status partial

**Estimated touch:** `index.ts`, `report.ts`, `browser-phase.ts`, `sandbox-phase.ts`, new `core/*`

---

## Phase 2 — Observation / interpret split

**Problem:** Findings and raw facts live in one blob. Cannot re-score without re-probing Solari.

**Work:**

1. Refactor `sandbox-phase.ts` → emit L1 `SandboxObservation` only
2. Refactor `browser-phase.ts` → emit L1 `BrowserObservation` only
3. Move all finding logic to `interpret/engine.ts` driven by `registry/checks.ts`
4. Map existing findings to stable `check_id` from CHECK-REGISTRY
5. Add `evidence` refs on each finding

**CLI:**

```bash
npm run audit -- --from-run runs/{run_id} --phases interpret,score,render
```

**Exit criteria:**

- `npm test` covers interpret engine with fixture observations (no Solari)
- Re-run interpret+score on cached run produces identical findings

---

## Phase 3 — Depth profiles

**Problem:** Env flag combinations are agent-hostile.

**Work:**

1. Add `src/core/config.ts` with profiles `quick | standard | deep`
2. `AUDIT_DEPTH` env + `--depth` flag + optional `audit-relay.config.json`
3. Deprecate document-only mapping from legacy env vars
4. Manifest records `depth` and enabled phases

**Profile specs:**

| Phase | quick | standard | deep |
|-------|-------|----------|------|
| observe.sandbox | ✓ | ✓ | ✓ |
| observe.browser | ✗ | ✓ | ✓ |
| extra pages | 0 | 2 | 5 |
| replay poll | ✗ | ✓ | ✓ |
| render html | optional | ✓ | ✓ |

**Exit criteria:**

- `AUDIT_DEPTH=quick` never launches browser
- Agent doc tree in AGENTS.md matches behavior

---

## Phase 4 — Accretion tools

**Problem:** Agent cannot ask "what changed since last week?" without manual diff.

**Work:**

1. `src/accrete/index.ts` — read/query `runs/index.jsonl`
2. CLI: `npm run last -- digitalalchemy.dev` → prints latest run_id + score
3. CLI: `npm run diff -- run-a run-b` → check_id delta (regressions, fixes)
4. Optional: score trend one-liner for agent stdout

**Exit criteria:**

- Diff output is JSON: `{ "regressed": [], "fixed": [], "unchanged": [] }`
- No Solari calls in accrete commands

---

## Phase 5 — Event stream + budget caps

**Problem:** Long browser crawls are opaque; agent parses stdout.

**Work:**

1. Append `events.ndjson` per phase/step
2. Optional `--max-duration-ms` / `--max-pages` in config
3. Clean abort writes partial manifest + resume hint

**Exit criteria:**

- Agent can `tail events.ndjson` for progress
- Budget exceeded → status `partial`, not throw without manifest

---

## Phase 6 — Deep probes (value add)

**Problem:** Header + DOM checks are table stakes. Client audits need more.

**Work (ordered by ROI):**

1. **robots.txt + sitemap** fetch in sandbox (cheap)
2. **Mixed content** scan from browser observation
3. **vibeaudit** on fetched HTML bundle in sandbox (deep only, supply-chain gate)
4. **Lighthouse subset** (perf/a11y) if budget allows

Each probe = new observe submodule + registry checks. No probe skips L1 layer.

---

## Phase 7 — Programmatic API + schema validation

**Work:**

1. Export `runAudit(url, options): Promise<RunResult>` from `src/api/run-audit.ts`
2. JSON Schema for manifest, summary, findings in `schemas/`
3. Validate manifest on write (Zod strict)

**Exit criteria:**

- Another agent script can import and run without CLI
- Schema version bump documented in DESIGN.md

---

## Phase 8 — Human render polish (parallel track)

Not blocking agent work. Run through ship-gate when touched.

- Report: check_id links, regression badge if prior run exists
- Embed "compared to run X" when accretion data available
- Mobile QA on report.html

---

## Implementation order (recommended)

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
                └─ Phase 8 anytime after Phase 1
```

**Do not** start Phase 6 before Phase 2. New probes without interpret split recreate the monolith.

---

## Success metrics

| Metric | Target |
|--------|--------|
| Agent context to understand run | ≤ 2 files, ≤ 3 KB |
| Re-score without Solari | supported after Phase 2 |
| Run history | append-only after Phase 1 |
| Zero API cost unit tests | interpret + score coverage ≥ 90% checks |
| Standard audit latency | ≤ 60s on digitalalchemy.dev |
| Quick triage latency | ≤ 15s |

---

## Out of scope (for now)

- Multi-tenant dashboard
- Hosted SaaS deployment
- Auth / user accounts
- Real-time streaming UI for humans

These are missions built **on top of** run envelopes, not replacements for them.
