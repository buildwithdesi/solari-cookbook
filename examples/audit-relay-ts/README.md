# AuditRelay

**Client site audit powered by Solari browser + sandbox.**

AuditRelay is a real use case for the [Solari hiring challenge](https://github.com/solari-sdk/solari-cookbook): paste a URL, get a production-style audit with browser screenshots, security header checks, and a Solari session replay link.

Built by [Desi Baker](https://github.com/buildwithdesi) with AI-assisted vibe coding (Cursor + agents).

## What it does

1. **Sandbox phase** — spins up a Solari microVM and runs `curl` for TLS redirect + security headers (HSTS, CSP, X-Frame-Options, etc.).
2. **Browser phase** — launches a stealth Solari browser with session recording, captures the landing page plus up to two internal pages, screenshots each view, and polls for the replay URL.
3. **Report** — writes a DA-branded HTML report and JSON summary to `output/`.

## Quick start

```bash
cd examples/audit-relay-ts
npm install
export SOLARI_API_KEY=slr_live_...   # console.getsolari.com
npm run audit -- https://example.com
```

Open `output/audit-report.html` when it finishes.

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
