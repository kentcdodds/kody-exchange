import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { csrfToken } from '#src/auth.ts'
import { signPayload } from '#src/crypto.ts'
import { run } from '#src/db.ts'
import { type AppEnv } from '#src/env.ts'
import { type UserRow } from '#src/threads.ts'

const migrationsDir = join(
	dirname(fileURLToPath(import.meta.url)),
	'../migrations',
)
const migrations = readdirSync(migrationsDir)
	.filter((name) => name.endsWith('.sql'))
	.toSorted()
	.map((name) => readFileSync(join(migrationsDir, name), 'utf8'))

class MemoryPrepared {
	#db: DatabaseSync
	#sql: string
	#params: Array<unknown> = []

	constructor(db: DatabaseSync, sql: string) {
		this.#db = db
		this.#sql = sql
	}

	bind(...params: Array<unknown>) {
		this.#params = params
		return this
	}

	#bound() {
		return this.#params as Array<
			null | number | bigint | string | Uint8Array | Int8Array
		>
	}

	async first<T>() {
		const row = this.#db.prepare(this.#sql).get(...this.#bound()) as
			| T
			| undefined
		return row ?? null
	}

	async all<T>() {
		const results = this.#db
			.prepare(this.#sql)
			.all(...this.#bound()) as Array<T>
		return { results, success: true }
	}

	async run() {
		const result = this.#db.prepare(this.#sql).run(...this.#bound())
		return {
			success: true,
			meta: { changes: result.changes, last_row_id: result.lastInsertRowid },
		}
	}
}

function createD1(db: DatabaseSync): D1Database {
	return {
		prepare(sql: string) {
			return new MemoryPrepared(db, sql) as unknown as D1PreparedStatement
		},
		async exec(sql: string) {
			db.exec(sql)
			return { count: 1, duration: 0 }
		},
		async batch() {
			throw new Error('batch not implemented in test D1')
		},
		async dump() {
			throw new Error('dump not implemented in test D1')
		},
	} as unknown as D1Database
}

class MemoryKv {
	#map = new Map<string, string>()

	async get(key: string) {
		return this.#map.get(key) ?? null
	}

	async put(key: string, value: string) {
		this.#map.set(key, value)
	}

	async delete(key: string) {
		this.#map.delete(key)
	}

	async list() {
		return { keys: [...this.#map.keys()].map((name) => ({ name })) }
	}
}

class MemoryR2 {
	#map = new Map<string, { body: ArrayBuffer; contentType: string }>()

	async put(
		key: string,
		value: ArrayBuffer,
		options?: { httpMetadata?: { contentType?: string } },
	) {
		this.#map.set(key, {
			body: value,
			contentType:
				options?.httpMetadata?.contentType ?? 'application/octet-stream',
		})
		return { key }
	}

	async get(key: string) {
		const item = this.#map.get(key)
		if (!item) return null
		return {
			body: item.body,
			httpMetadata: { contentType: item.contentType },
			async arrayBuffer() {
				return item.body
			},
		}
	}
}

export function createTestEnv(overrides: Partial<AppEnv> = {}): AppEnv {
	const sqlite = new DatabaseSync(':memory:')
	for (const migration of migrations) sqlite.exec(migration)
	return {
		DB: createD1(sqlite),
		RATE_LIMIT: new MemoryKv() as unknown as KVNamespace,
		BLOBS: new MemoryR2() as unknown as R2Bucket,
		COOKIE_SECRET: 'test-cookie-secret-at-least-32-bytes',
		APP_BASE_URL: 'https://kody.exchange',
		APP_COMMIT_SHA: 'testsha',
		...overrides,
	}
}

export function request(path: string, init: RequestInit = {}) {
	return new Request(`https://kody.exchange${path}`, init)
}

export async function createSignedInUser(
	env: AppEnv,
	overrides: Partial<UserRow> = {},
) {
	const user: UserRow = {
		id: 'usr_1',
		github_id: '1',
		login: 'kent',
		name: 'Kent',
		avatar_url: null,
		email: 'k@example.com',
		plan: 'free',
		stripe_customer_id: null,
		stripe_subscription_id: null,
		created_at: 1,
		...overrides,
	}
	await run(
		env.DB,
		`INSERT INTO users (id, github_id, login, name, avatar_url, email, plan, stripe_customer_id, stripe_subscription_id, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		user.id,
		user.github_id,
		user.login,
		user.name,
		user.avatar_url,
		user.email,
		user.plan,
		user.stripe_customer_id,
		user.stripe_subscription_id,
		user.created_at,
	)
	const secret = env.COOKIE_SECRET ?? 'test-cookie-secret-at-least-32-bytes'
	const session = await signPayload(
		secret,
		JSON.stringify({ userId: user.id, exp: Date.now() + 86_400_000 }),
	)
	const csrf = await csrfToken(secret, user.id)
	return {
		user,
		csrf,
		cookie: `kx_session=${session}`,
	}
}

export function firstSetCookie(response: Response) {
	const header =
		response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie')
	if (!header) return null
	return header.split(';')[0] ?? null
}
