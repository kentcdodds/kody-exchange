import { expect, test } from 'vitest'
import { applyGrantedPlan, grantMaxToLogin } from '#src/grants.ts'
import { first, run } from '#src/db.ts'
import { createTestEnv } from '#src/test-support.ts'

test('operator login and stored grants assign the hidden plan', async () => {
	const env = createTestEnv()
	await run(
		env.DB,
		`INSERT INTO users (id, github_id, login, name, avatar_url, email, plan, created_at)
		 VALUES ('usr_op', '1', 'kentcdodds', 'Kent', null, null, 'free', 1)`,
	)
	await applyGrantedPlan(env.DB, 'usr_op', 'KentCDodds')
	expect(
		(
			await first<{ plan: string }>(
				env.DB,
				'SELECT plan FROM users WHERE id = ?',
				'usr_op',
			)
		)?.plan,
	).toBe('max')

	expect(await grantMaxToLogin(env.DB, 'Pending-User')).toMatchObject({
		ok: true,
		login: 'pending-user',
	})
	await run(
		env.DB,
		`INSERT INTO users (id, github_id, login, name, avatar_url, email, plan, created_at)
		 VALUES ('usr_p', '2', 'pending-user', 'Pat', null, null, 'free', 1)`,
	)
	await applyGrantedPlan(env.DB, 'usr_p', 'pending-user')
	expect(
		(
			await first<{ plan: string }>(
				env.DB,
				'SELECT plan FROM users WHERE id = ?',
				'usr_p',
			)
		)?.plan,
	).toBe('max')
})
