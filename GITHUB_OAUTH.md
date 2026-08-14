# GitHub OAuth app

Callback path is `/auth/callback/github` (matches the GitHub OAuth App).

## OAuth App settings

| Field                                | Value                                        |
| ------------------------------------ | -------------------------------------------- |
| Application name                     | `kody.exchange`                              |
| Homepage URL                         | `https://kody.exchange`                      |
| Authorization callback URL           | `https://kody.exchange/auth/callback/github` |
| Local callback (optional, add later) | `http://localhost:8787/auth/callback/github` |

Expire user access tokens: fine. We only need GitHub identity at callback time.

## Worker secrets (production)

After GitHub shows the Client ID and Client Secret:

| Worker secret          | Value         |
| ---------------------- | ------------- |
| `GITHUB_CLIENT_ID`     | Client ID     |
| `GITHUB_CLIENT_SECRET` | Client secret |

## GitHub Actions secrets

Actions reserves `GITHUB_*`, so the deploy workflow reads:

| Actions secret               | Maps to Worker         |
| ---------------------------- | ---------------------- |
| `OAUTH_GITHUB_CLIENT_ID`     | `GITHUB_CLIENT_ID`     |
| `OAUTH_GITHUB_CLIENT_SECRET` | `GITHUB_CLIENT_SECRET` |

Do not put the homepage or callback URL in env. Those live only on the GitHub OAuth App. Do not run `wrangler secret put` by hand — production deploy syncs these.
