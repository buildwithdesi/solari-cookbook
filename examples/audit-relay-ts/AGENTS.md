# AuditRelay — Agent Operating Contract

**You are driving a client site audit system.** Read this before touching code or Solari.

Canonical architecture: `DESIGN.md`  
Implementation roadmap: `PLAN.md`  
Check taxonomy: `docs/CHECK-REGISTRY.md`

---

## What you are controlling

AuditRelay probes a URL through Solari (sandbox + browser), interprets observations into findings, scores them, and optionally renders HTML for humans.

**Your job:** pick depth, run or resume, read structured outputs, decide next action.  
**Not your job:** parse screenshots unless you need visual confirmation.

---

## Decision tree (start here)

```
User gave a URL?
├─ NO → ask for URL or read runs/index.jsonl for last target
└─ YES
   ├─ Need fastest signal, no browser cost? → depth=quick
   ├─ Normal audit / demo? → depth=standard
   ├─ Full crawl / regression? → depth=deep
   └─ Prior run exists for same host?
      ├─ Only re-score or re-render? → use cached run (no Solari)
      └─ Fresh probe? → new run_id
```

---

## How to run (v0 today, v1 soon)

### v0 (current CLI)

```bash
cd examples/audit-relay-ts
npm test                                    # zero API cost — verify interpret layer
npm run audit -- https://example.com        # full run → output/
```

PowerShell fast iteration:

```powershell
$env:AUDIT_SKIP_REPLAY='1'; npm run audit -- https://example.com
$env:AUDIT_LANDING_ONLY='1'; npm run audit -- https://example.com
```

### v1 (re-interpret cached runs — available now)

```powershell
npm run audit -- --from-run runs/20260901T070508Z-example-com-3f25 --phases interpret,score,render
$env:AUDIT_DEPTH='quick'; npm run audit -- https://example.com
$env:AUDIT_DEPTH='standard'; npm run audit -- https://digitalalchemy.dev
```

```bash
npm run diff -- runs/run-a runs/run-b                               # check_id regression (Phase 4)
```

---

## What to read after a run

**v0 (today):**

| Order | File | Why |
|-------|------|-----|
| 1 | `runs/{run_id}/manifest.json` | status, phases, paths, resume |
| 2 | `runs/{run_id}/summary.json` | score, verdict, counts |
| 3 | `runs/{run_id}/findings.json` | full finding list |
| 4 | observations / screenshots | only if needed |
| 5 | `output/audit-report.html` | human mirror of latest run |

**v1 (target):**

| Order | File | Why |
|-------|------|-----|
| 1 | `runs/{run_id}/manifest.json` | status, paths, resume hint |
| 2 | `runs/{run_id}/summary.json` | score, verdict, counts |
| 3 | `runs/{run_id}/findings.json` | full finding list with evidence refs |
| 4 | observations | only if finding unclear |
| 5 | screenshots | vision only |

**Token rule:** Never load base64 or full HTML into context unless required.

---

## Depth profiles (when to spend Solari credits)

| Depth | Use when | Solari cost |
|-------|----------|-------------|
| **quick** | Triage, CI header check, "is this site naked?" | sandbox only (~8s) |
| **standard** | Client audit demo, hiring submission, handoff | sandbox + browser (~30–60s) |
| **deep** | Full site sample, regression, vibeaudit in sandbox | highest |

If user says "test it" → `quick` first, then `standard` if headers pass.  
If user says "ship demo" → `standard` on their best site (e.g. digitalalchemy.dev).

---

## Interpreting scores

Score starts at 100. Deductions:

| Severity | Points |
|----------|--------|
| critical | −25 |
| high | −12 |
| medium | −6 |
| low | −2 |
| pass | 0 |

| Score | Verdict | Agent action |
|-------|---------|--------------|
| 85+ | Strong posture | Ship report; optional polish on low items |
| 70–84 | Solid | Fix high findings before client send |
| 50–69 | Needs work | Do not hand off; list top 3 fixes |
| <50 | High risk | Treat as pre-production; sandbox-only re-check after fixes |

Score is **heuristic**, not certification. Always cite specific `check_id` / finding titles when explaining to user.

---

## Accretion rules

1. **Do not delete run directories** unless user explicitly cleans disk.
2. Before a new probe, check if last run for host is recent and user only asked "what changed" → diff instead of re-run.
3. When reporting to user, mention **run timestamp** and **depth** so results are reproducible.
4. Append learnings to project memory only after verified run (manifest status completed).

---

## Failure handling

| Symptom | Likely cause | Agent action |
|---------|--------------|--------------|
| Missing SOLARI_API_KEY | no .env | point to console.getsolari.com, never commit key |
| Browser hangs after output | forgot solari.close() | already handled in code; if regresses, check browser-phase |
| replay 404 forever | recording not enabled at launch | verify recording:true at create |
| sandbox curl empty | target blocked or bad URL | read curl artifact, try https URL normalize |
| npm ate --flags | npm quirk | use AUDIT_* env vars or `node_modules/.bin/tsx index.ts` |

Three failed fixes on same bug → stop, summarize attempts, propose different layer (see DESIGN.md phase split).

---

## Security (mandatory)

- Never commit `slr_live_*` keys.
- Never put API keys in HTML reports or manifests.
- Sandbox runs untrusted curl against user-supplied URL only (expected).
- Do not run vibeaudit on client repos in v0; planned for deep profile in sandbox.

---

## Extension points (agent-safe edits)

| Want to… | Edit |
|----------|------|
| Add a new check | `docs/CHECK-REGISTRY.md` + `interpret/engine.ts` |
| Change scoring weights | `score/compute.ts` |
| Add probe (e.g. lighthouse) | new `observe/*` phase, register in manifest |
| Change human report | `render/html.ts` only |
| Add Solari primitive | `observe/*` only |

Do **not** mix observation and severity in the same function.

---

## Hiring demo checklist (Solari challenge)

1. Run `standard` on a strong site (digitalalchemy.dev scored 98).
2. Open HTML report + confirm screenshots + replay link.
3. Public repo fork with `examples/audit-relay-ts/` README.
4. Post: problem → depth used → score → replay link → repo URL.
5. Tag `@harrychow_` `@getsolari`.

---

## Related skills (Desi stack)

- Client audit arc → same shape as `/client-audit-deliverable`
- Security checks → future `vibeaudit` in sandbox (deep profile)
- Ship human HTML → `ship-gate` + `design-taste-digital-alchemy`
