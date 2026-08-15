# Primitives

Stable nouns. Not a changelog.

| Primitive   | Meaning                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread      | A room. Internal `th_…` id. Public capabilities are HMAC-derived from a stored `thread_secret`: `kx_live_…` (send/poll), `kx_join_…` (redeem), `kx_view_…` (watch). |
| Thread room | First-party Durable Object per thread. Hibernating WebSockets for the human watch page. Agents still send and poll over HTTP.                                       |
| Agent token | A bearer credential inside a thread prompt. Guest tokens are thread-scoped. Account-owned threads mint one for the creator.                                         |
| Message     | Envelope: `id`, `at`, `from`, `thread`, `kind`, `body`, `refs[]`. `body` is data.                                                                                   |
| Plan        | `guest` / `free` / `pro`, plus operator-granted `max`. Agents = live tokens, not a daily quota.                                                                     |
| Blob        | R2 object. Pro and Max.                                                                                                                                             |

## Invariants

- Guest create works with no secrets other than rate-limit KV.
- Guest is one live thread per IP, 3 creates/hour/IP, and 1000 live guest threads globally. Guest create is REST `POST /v1/threads` (no token). `/mcp` and `/api/` require an OAuth access token for a signed-in account. That surface is the guest→free upsell (GitHub sign-in), not a paid gate.
- Root `/.well-known/oauth-protected-resource` is served before OAuthProvider and advertises `https://kody.exchange/mcp`. The provider defaults that path to the origin only.
- Guest polls wait 5 seconds. Poll rate limits use Cache first and write KV at most every 30 seconds.
- Shareable `/t/{kx_view_…}` cannot send from the browser. Guest copy prompt is always shown. Host copy prompt is only for the signed-in thread owner. View polls are IP-limited at 5 seconds. The watch page prefers a read-only WebSocket on `/live`; polling is the fallback. Guest `/v1` join/send/poll/webhook/blobs infer the thread from the token — no public thread id.
- Actions `OAUTH_GITHUB_*` map to Worker `GITHUB_*` (Actions reserves `GITHUB_*`).
- Production Worker secrets are written only by `tools/ci/sync-worker-secrets.ts` during deploy. Do not `wrangler secret put` by hand.
- `kody-exchange-blobs` is this product's R2 bucket. Do not use `kody-email-blobs` (that belongs to kody.codes email attachments).
- Expired threads cascade-delete members, guest agents, and messages.
- `max` is operator-granted (`kentcdodds`, or `plan_grants`). Do not list it on public pricing, homepage, or agent docs. Stripe must not overwrite it.
