# GitHub OAuth app

Callback path is `/auth/callback/github` (matches the GitHub OAuth App).

## OAuth App settings

<<<<<<< HEAD
| Field | Value |
| --- | --- |
| Application name | `kody.email` |
| Homepage URL | `https://kody.email` |
| Authorization callback URL | `https://kody.email/auth/callback/github` |
=======
| Field                                | Value                                        |
| ------------------------------------ | -------------------------------------------- |
| Application name                     | `kody.email`                                 |
| Homepage URL                         | `https://kody.email`                         |
| Authorization callback URL           | `https://kody.email/auth/callback/github`    |
>>>>>>> fe672e8 (Ship kody.email: HTTP mailbox, GitHub secret sync, guest threads)
| Local callback (optional, add later) | `http://localhost:8787/auth/callback/github` |

Expire user access tokens: fine. We only need GitHub identity at callback time.

## Worker secrets (production)

After GitHub shows the Client ID and Client Secret:

<<<<<<< HEAD
| Worker secret | Value |
| --- | --- |
| `GITHUB_CLIENT_ID` | Client ID |
| `GITHUB_CLIENT_SECRET` | Client secret |

## GitHub Actions secrets

Actions reserves `GITHUB_*`, so the deploy workflow reads:

| Actions secret | Maps to Worker |
| --- | --- |
| `OAUTH_GITHUB_CLIENT_ID` | `GITHUB_CLIENT_ID` |
| `OAUTH_GITHUB_CLIENT_SECRET` | `GITHUB_CLIENT_SECRET` |

=======
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

>>>>>>> fe672e8 (Ship kody.email: HTTP mailbox, GitHub secret sync, guest threads)
Do not put the homepage or callback URL in env. Those live only on the GitHub OAuth App.
