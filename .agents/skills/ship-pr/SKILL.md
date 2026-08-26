---
name: ship-pr
description: >
  Babysit a PR: iterate with AI reviewers and CI until green, get it ready,
  optionally squash-merge as Kent and watch the deploy, then send a Discord
  summary. Medium risk waits for AI reviewer(s) and addresses valid feedback.
  Use when a pull request needs to be shepherded to done.
---

# Ship PR

From [Kody](https://github.com/kentcdodds/kody/blob/main/.agents/skills/ship-pr/SKILL.md),
adapted for kody.exchange.

## Risk → merge authority

Self-assess; user policy overrides.

**Kent's standing policy (2026-08-08):** auto-ship (squash-merge + verify deploy)
once AI reviewer feedback is addressed and CI is green, unless **high** risk.
High risk still parks ready-for-review unless merge authority was granted
explicitly.

- **Low** — green CI; nits ignorable; squash-merge when policy allows.
- **Medium** — wait for AI reviewer(s); address **valid** feedback (ignore
  insignificant nits / already-fixed / wrong); then merge when policy allows.
- **High** — leave ready-for-review unless the user granted merge authority.

## AI reviewers

Prefer **Cursor Bugbot** (`Cursor Bugbot` check / `cursor[bot]` review comments).
Trigger with `bugbot run` or `@cursor review` on the PR if it has not started.

**CodeRabbit:** if it is rate-limited, errored, or otherwise unavailable, **do not
wait** on it for low/medium risk — proceed with Bugbot + CI. Only wait on
CodeRabbit when the change is **high** risk (or the user explicitly asks).

## Loop

1. Mark ready — `kody:@kentcdodds/github/pr/set-review-status`
   `{ prUrl, status: 'ready', account: 'kent' }` (or owner/repo/prNumber).
2. Wait for CI — `gh pr checks` (or compose `loop-on-ci` / `fix-ci`).
3. Fix failures; for **medium+**, wait on AI reviewer(s) (Bugbot first; see
   above for CodeRabbit) and address valid feedback. Rebase only when actually
   unmergeable.
4. Green + (medium+: valid feedback cleared) → break.
5. Push → repeat.

There are no PR preview deploys here. Do not run a kody.codes-style
`preview:manual-test`.

## Gates ≠ CI

Blocked on soak / parity CHECK / calendar gate → **end the run** and schedule a
wake (Kody `job_schedule` + `createRun`). Don't sleep-poll or code-thrash an
intentional time window.

Batch related expand steps into fewer PRs when risk posture allows.

## Merge / deploy

Merge GitHub mutations as Kent (`account: 'kent'` on `@kentcdodds/github`).
kody-bot does not have admin here.

When policy + risk allow: squash-merge via `kody:@kentcdodds/github/pr/merge`
`{ prUrl, mergeMethod: 'squash', account: 'kent' }`. Useful: `pr/get-checks`,
`request`, `graphql` on the same package.

After merge, watch the production Deploy workflow (it starts after Validate
succeeds on `main` via `workflow_run`). Then `GET https://kody.exchange/health`
until `commit` matches the merge SHA.

## Done → Discord

Always summarize (merged or not) by calling
`kody:@kentcdodds/discord/send-shipped-pr` with structured fields. Do **not**
use raw `post-message` and do **not** compute or guess token cost — the export
fetches the billed Cursor Cloud Agent usage and formats the cost line.

**agentId (required):**

- In a Cursor Cloud Agent VM, read it from the metadata socket:
  curl -fsS --unix-socket "${CURSOR_AGENT_SOCKET:-/run/cursor/api.sock}" http://cursor-agent/v1/meta-data/agent/id
- Otherwise pass the `bc-` id from the agent URL you were launched as
  (https://cursor.com/agents/{id}).

```javascript
import sendShippedPr from 'kody:@kentcdodds/discord/send-shipped-pr'

export default async function main() {
	return sendShippedPr({
		agentId, // bc- id from the metadata socket or launch URL
		title: 'PR title',
		summary: 'What shipped / parked / blocked and why.',
		prUrl: 'https://github.com/owner/repo/pull/1',
		repo: 'owner/repo',
		extras: ['CI green', 'preview verified'],
		status: 'Shipped', // or 'Parked' | 'Blocked'
	})
}
```
