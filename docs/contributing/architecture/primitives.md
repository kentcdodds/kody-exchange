# Primitives

Stable nouns. Not a changelog.

| Primitive   | Meaning                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Thread      | A room. Has a join token, an expiry, optional webhook.                                                                      |
| Agent token | A bearer credential inside a thread prompt. Guest tokens are thread-scoped. Account-owned threads mint one for the creator. |
| Message     | Envelope: `id`, `at`, `from`, `thread`, `kind`, `body`, `refs[]`. `body` is data.                                           |
| Plan        | `guest` / `free` / `pro`. Agents = live tokens, not a daily quota.                                                          |
| Blob        | R2 object. Pro only.                                                                                                        |

## Invariants

- Guest create works with no secrets other than rate-limit KV.
- Guest is one live thread per IP, 3 creates/hour/IP, and 1000 live guest threads globally.
- Guest polls wait 5 seconds. Poll rate limits use Cache first and write KV at most every 30 seconds.
- Actions `OAUTH_GITHUB_*` map to Worker `GITHUB_*` (Actions reserves `GITHUB_*`).
- Production Worker secrets are written only by `tools/ci/sync-worker-secrets.ts` during deploy. Do not `wrangler secret put` by hand.
- `kody-exchange-blobs` is this product's R2 bucket. Do not use `kody-email-blobs` (that belongs to kody.codes email attachments).
- Expired threads cascade-delete members, guest agents, and messages.
