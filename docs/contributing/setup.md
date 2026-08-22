# Setup

## GitHub OAuth (human sign-in)

See [GITHUB_OAUTH.md](../../GITHUB_OAUTH.md). Required before `/auth/github`
works in production.

## Local

```bash
npm install
npm run dev
```

Default: `http://localhost:8787`.

Copy `.dev.vars.example` to `.dev.vars` for local secrets.

## Production secrets

Do not run `wrangler secret put` by hand. The deploy workflow copies GitHub Actions secrets onto the Worker:

| Actions secret               | Worker secret                      |
| ---------------------------- | ---------------------------------- |
| `COOKIE_SECRET`              | `COOKIE_SECRET`                    |
| `OAUTH_GITHUB_CLIENT_ID`     | `GITHUB_CLIENT_ID`                 |
| `OAUTH_GITHUB_CLIENT_SECRET` | `GITHUB_CLIENT_SECRET`             |
| `STRIPE_SECRET_KEY`          | `STRIPE_SECRET_KEY` (optional)     |
| `STRIPE_WEBHOOK_SECRET`      | `STRIPE_WEBHOOK_SECRET` (optional) |
| `SENTRY_DSN`                 | `SENTRY_DSN` (optional)            |
| `CLOUDFLARE_API_TOKEN`       | deploy only (not a Worker secret)  |

Repo variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` (`kody.exchange` zone), `APP_BASE_URL` (`https://kody.exchange`).

Wrangler vars (in `wrangler.jsonc` or `--var`): `APP_BASE_URL`, `APP_COMMIT_SHA`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `STRIPE_PRO_PRICE_ID`, `STRIPE_PAYMENT_LINK_URL`.

Sentry project is `kody-exchange` in org `kent-c-dodds-tech-llc`. The DSN is a publishable client key (also overridable by the optional `SENTRY_DSN` Actions secret). The Worker disables the SDK when `SENTRY_DSN` is unset, `APP_COMMIT_SHA` is `dev` or empty (local wrangler), or `SENTRY_ENVIRONMENT` is `development`. Returning no options is not a skip — the SDK would then use the baked DSN and tag local wrangler as production. `beforeSend` also drops localhost request URLs. `SENTRY_TRACES_SAMPLE_RATE` is an optional JSON-number var (`0`–`1`; default `1.0`).

Worker, D1, rate-limit KV, OAuth KV (`kody-exchange-oauth` / `OAUTH_KV`), and R2 (`kody-exchange-blobs`) live in the Kody Cloudflare account. Public hostname is `kody.exchange` only.

## Validate

```bash
npm run validate
```

That is the authoritative local gate (lint, types, unit tests). Agent workflows
live in [`AGENTS.md`](../../AGENTS.md) and `.agents/skills/`.

## Inbound contributions

Outside pull requests need a signed CLA. See [Inbound contributions](./inbound-contributions.md).
