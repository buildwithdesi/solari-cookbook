# AuditRelay Check Registry

**Version:** 0.1 (v0 implementation) → 1.0 (stable IDs in interpret engine)

Checks are the atomic unit of accretion. Same `check_id` across runs enables diff and trend.

---

## ID format

```
{domain}.{name}
```

Domains: `header`, `transport`, `page`, `surface`, `fingerprint`, `coverage`, `seo`, `a11y`

---

## Active checks (v0)

### header.*

| check_id | Severity when fail | Source observation |
|----------|-------------------|-------------------|
| `header.strict-transport-security` | high | sandbox.headers |
| `header.content-security-policy` | high | sandbox.headers |
| `header.x-content-type-options` | medium | sandbox.headers |
| `header.x-frame-options` | medium | sandbox.headers |
| `header.referrer-policy` | medium | sandbox.headers |
| `header.permissions-policy` | medium | sandbox.headers |

Pass mirror: same ID with `status: pass` when present.

### transport.*

| check_id | Severity when fail | Source observation |
|----------|-------------------|-------------------|
| `transport.http-to-https-redirect` | high | sandbox.tls_redirect |
| `transport.password-field-on-http` | critical | browser.page.passwordFieldCount + URL scheme |

### page.*

| check_id | Severity when fail | Source observation |
|----------|-------------------|-------------------|
| `page.meta-description` | low | browser.page.metaDescription empty |
| `page.h1-present` | low | browser.page.h1 empty |

### surface.*

| check_id | Severity when fail | Source observation |
|----------|-------------------|-------------------|
| `surface.script-heavy` | medium | browser.page.scriptCount > 15 |

Threshold configurable in v1: `registry/thresholds.json`.

### fingerprint.*

| check_id | Severity when fail | Source observation |
|----------|-------------------|-------------------|
| `fingerprint.server-banner` | low | sandbox.serverBanner non-null |

### coverage.*

| check_id | Severity when fail | Source observation |
|----------|-------------------|-------------------|
| `coverage.secondary-page-error` | low | browser phase catch on extra URL |

---

## Planned checks (v1+)

| check_id | Phase | Notes |
|----------|-------|-------|
| `transport.mixed-content` | 6 | browser resource audit |
| `seo.robots-present` | 6 | sandbox fetch /robots.txt |
| `seo.sitemap-present` | 6 | sandbox fetch /sitemap.xml |
| `security.vibeaudit-critical` | 6 | deep profile only |
| `a11y.image-alt-ratio` | 6 | browser DOM sample |

---

## Scoring weights

Applied in `score/compute.ts`:

| Severity | Deduction |
|----------|-----------|
| critical | 25 |
| high | 12 |
| medium | 6 |
| low | 2 |
| pass | 0 |

Verdict bands: see `AGENTS.md`.

---

## Adding a check (agent procedure)

1. Add row to this file with stable `check_id`
2. Implement observation field if new data needed (`observe/*`)
3. Add rule in `interpret/engine.ts` (or registry-driven rule in v1)
4. Add unit test fixture in `test/fixtures/`
5. Bump registry version in manifest when schema changes

Never assign severity inside observe phases.
