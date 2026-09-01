# AuditRelay

**Client site audit powered by Solari browser + sandbox.**

AuditRelay is a real use case for the [Solari hiring challenge](https://github.com/solari-sdk/solari-cookbook): paste a URL, get a production-style audit with browser screenshots, security header checks, and a Solari session replay link.

Built by [Desi Baker](https://github.com/buildwithdesi) with AI-assisted vibe coding (Cursor + agents).

## For agents (read first)

| Doc | Purpose |
|-----|---------|
| [`AGENTS.md`](AGENTS.md) | How to drive runs, read outputs, pick depth |
| [`DESIGN.md`](DESIGN.md) | System architecture and abstraction tower |
| [`PLAN.md`](PLAN.md) | Implementation roadmap v0 → v1 |
| [`docs/CHECK-REGISTRY.md`](docs/CHECK-REGISTRY.md) | Stable check IDs for diff/accretion |
| [`schemas/`](schemas/) | JSON Schema for manifest and summary (v1 target) |

**Agent rule:** Read structured JSON before HTML. Solari costs money; interpret/score should be free on cached runs (v1).

## What it does

1. **Sandbox phase** — spins up a Solari microVM and runs `curl` for TLS redirect + security headers (HSTS, CSP, X-Frame-Options, etc.).
2. **Browser phase** — launches a stealth Solari browser with session recording, captures the landing page plus up to two internal pages, screenshots each view, and polls for the replay URL.
3. **Report** — writes a DA-branded HTML report and JSON summary to `output/` (v1: `runs/{run_id}/` + `manifest.json`).

**v0 today · v1 target:** See `DESIGN.md` for the run envelope and accretion model.

## Quick start

```bash
cd examples/audit-relay-ts
npm install
export SOLARI_API_KEY=slr_live_...   # console.getsolari.com
npm run audit -- https://example.com
```

Open `output/audit-report.html` when it finishes. Screenshots live in `output/screenshots/`.

### Flags

npm sometimes eats `--flags`. Use env vars or the helper scripts:

```bash
# Full audit with replay polling
npm run audit -- https://example.com

# Faster iteration (skip replay poll)
$env:AUDIT_SKIP_REPLAY='1'; npm run audit -- https://example.com

# Landing page only
$env:AUDIT_LANDING_ONLY='1'; npm run audit -- https://example.com

# Local scoring tests (no API key burn)
npm test
```

Direct tsx also works if flags must be explicit:

```bash
node_modules/.bin/tsx index.ts https://example.com --skip-replay
```

## Why this use case

Most agent infra demos stop at "the bot opened Google." AuditRelay maps to a workflow I already run for clients: scan the site, check security signals, capture proof, ship a report. Solari's browser + sandbox split matches that pipeline without running untrusted code on my laptop.

## Stack

- `@solarisdk/browser` — stealth browser, recording, Playwright API
- `@solarisdk/sdk` — isolated sandbox for header probes
- TypeScript + tsx

## Gotchas handled

- `await solari.close()` after browser work (Node exit hang)
- `sandbox.kill()` not `close()` (VM keeps running otherwise)
- Recording is opt-in at session create; replay is polled async
- Sandbox `curl` commands use explicit argv, not shell strings

## License

MIT
