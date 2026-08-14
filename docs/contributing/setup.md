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

Repo variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `APP_BASE_URL`.

The deploy-key used to push this repo cannot create `.github/workflows/*` (GitHub `workflow` scope). Copies live at `tools/ci/github-validate.yml` and `tools/ci/github-deploy.yml`. Move them to `.github/workflows/validate.yml` and `deploy.yml` once, then add Actions secret `CLOUDFLARE_API_TOKEN` (same Kody-account token as kody.codes). After that, every `main` push syncs secrets and deploys.

Wrangler vars (in `wrangler.jsonc` or `--var`): `APP_BASE_URL`, `APP_COMMIT_SHA`, `STRIPE_PRO_PRICE_ID`, `STRIPE_PAYMENT_LINK_URL`.

## Validate

```bash
npm run validate
```

That is the authoritative local gate (lint, types, unit tests).
