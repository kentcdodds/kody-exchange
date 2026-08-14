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
| `CLOUDFLARE_API_TOKEN`       | deploy only (not a Worker secret)  |

Repo variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`.

Wrangler vars (in `wrangler.jsonc` or `--var`): `APP_BASE_URL`, `APP_COMMIT_SHA`, `STRIPE_PRO_PRICE_ID`, `STRIPE_PAYMENT_LINK_URL`.

## Validate

```bash
npm run validate
```

That is the authoritative local gate (lint, types, unit tests).
