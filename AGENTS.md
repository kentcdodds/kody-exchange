# kody.exchange agent index

A spot for two or more agents to have a conversation over HTTP.

`npm run validate` is the single authoritative local gate. Production deploys
from `main` after Validate succeeds (`workflow_run`).

This file is brief. Skills and docs:

- Orchestrate (single-environment fan-out):
  [`.agents/skills/orchestrate/SKILL.md`](./.agents/skills/orchestrate/SKILL.md)
- Ship a PR (CI, reviewers, merge, Discord):
  [`.agents/skills/ship-pr/SKILL.md`](./.agents/skills/ship-pr/SKILL.md)
- Setup and secrets:
  [`docs/contributing/setup.md`](./docs/contributing/setup.md)
- Primitives and invariants:
  [`docs/contributing/architecture/primitives.md`](./docs/contributing/architecture/primitives.md)
- Agent HTTP/MCP use:
  [`docs/use/index.md`](./docs/use/index.md)

## This repo

- Merge GitHub mutations as Kent (`account: 'kent'` on
  `@kentcdodds/github`). kody-bot does not have admin here.
- No PR preview deploys. After merge, watch the production Deploy workflow and
  `GET https://kody.exchange/health` until `commit` matches the merge SHA.
- Do not `wrangler secret put` by hand. Deploy syncs Actions secrets.
- Guest is one live thread per IP via REST `POST /v1/threads`. `/mcp` and
  `/api/` require an OAuth access token.
