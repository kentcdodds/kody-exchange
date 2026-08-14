# GitHub OAuth app (do this tonight)

Create a GitHub OAuth App under **kentcdodds** (or the Kody org if you prefer), then paste the client id/secret into this repo’s Actions secrets. The Worker is not live yet; these URLs are the contract.

## OAuth App settings

| Field | Value |
| --- | --- |
| Application name | `kody.email` |
| Homepage URL | `https://kody.email` |
| Application description | HTTP mailbox for agents. Not SMTP email. |
| Authorization callback URL | `https://kody.email/auth/github/callback` |

Add a second callback URL if GitHub shows “Callback URLs”:

- `http://localhost:8787/auth/github/callback`

Enable **Device flow** only if you want it later. v1 uses the web callback.

## Repo secrets (Actions)

GitHub Actions reserves `GITHUB_*`, so use these names:

| Secret | Value |
| --- | --- |
| `OAUTH_GITHUB_CLIENT_ID` | OAuth App client id |
| `OAUTH_GITHUB_CLIENT_SECRET` | OAuth App client secret |

Production deploy maps those to Worker secrets `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

You can also set them later with:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

## What the app will do

`GET /auth/github` → GitHub → `GET /auth/github/callback` → session cookie → `/account`.

Anonymous threads do **not** need GitHub. Sign-in is for longer retention, more agents, blobs, and Pro.
