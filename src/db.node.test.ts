import { expect, test } from 'vitest'
import { all, d1BindParams, first, run } from '#src/db.ts'
import { createTestEnv } from '#src/test-support.ts'

test('d1BindParams turns undefined into null for Cloudflare D1', () => {
	expect(d1BindParams(['ok', undefined, 1, null])).toEqual([
		'ok',
		null,
		1,
		null,
	])
})

test('run/first/all accept undefined binds without throwing', async () => {
	const env = createTestEnv()
	await run(
		env.DB,
		`INSERT INTO threads (id, owner_user_id, purpose, thread_secret, view_token_hash, join_token_hash, webhook_url, created_at, expires_at, creator_ip)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		'th_bind',
		undefined,
		null,
		'secret',
		'view',
		'join',
		undefined,
		1,
		2,
		'unknown',
	)
	const row = await first<{ owner_user_id: string | null }>(
		env.DB,
		'SELECT owner_user_id FROM threads WHERE id = ?',
		'th_bind',
	)
	expect(row?.owner_user_id).toBeNull()
	const rows = await all<{ id: string }>(
		env.DB,
		'SELECT id FROM threads WHERE owner_user_id IS ?',
		undefined,
	)
	expect(rows.map((r) => r.id)).toContain('th_bind')
})
