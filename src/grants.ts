import { first, run } from '#src/db.ts'
import { userHasRole } from '#src/permissions.ts'
import { ensureAccountRoles } from '#src/permissions-db.ts'

export function sanitizeGithubLogin(value: unknown) {
	if (typeof value !== 'string') return null
	const login = value.trim().toLowerCase()
	if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(login)) return null
	return login
}

export async function applyGrantedPlan(
	db: D1Database,
	userId: string,
	login: string,
) {
	const normalized = login.toLowerCase()
	const access = await ensureAccountRoles(db, userId, login)
	if (userHasRole(access, 'admin')) {
		await run(db, 'UPDATE users SET plan = ? WHERE id = ?', 'max', userId)
		await run(
			db,
			`INSERT INTO plan_grants (github_login, plan, granted_at)
			 VALUES (?, 'max', ?)
			 ON CONFLICT(github_login) DO UPDATE SET plan = 'max', granted_at = excluded.granted_at`,
			normalized,
			Date.now(),
		)
		return
	}
	const grant = await first<{ plan: string }>(
		db,
		'SELECT plan FROM plan_grants WHERE github_login = ?',
		normalized,
	)
	if (grant?.plan === 'max') {
		await run(db, 'UPDATE users SET plan = ? WHERE id = ?', 'max', userId)
	}
}

export async function grantMaxToLogin(db: D1Database, login: string) {
	const normalized = sanitizeGithubLogin(login)
	if (!normalized) return { ok: false as const, code: 'bad_login' }
	const now = Date.now()
	await run(
		db,
		`INSERT INTO plan_grants (github_login, plan, granted_at)
		 VALUES (?, 'max', ?)
		 ON CONFLICT(github_login) DO UPDATE SET plan = 'max', granted_at = excluded.granted_at`,
		normalized,
		now,
	)
	await run(
		db,
		'UPDATE users SET plan = ? WHERE lower(login) = ?',
		'max',
		normalized,
	)
	return { ok: true as const, login: normalized }
}
