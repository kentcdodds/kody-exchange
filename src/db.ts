/**
 * Cloudflare D1 rejects `undefined` binds with D1_TYPE_ERROR. Absent SQL
 * values must be `null`. Coerce at the boundary so call sites cannot crash
 * the Worker with a platform type error.
 */
export function d1BindParams(params: Array<unknown>) {
	return params.map((value) => (value === undefined ? null : value))
}

export async function first<T>(
	db: D1Database,
	sql: string,
	...params: Array<unknown>
) {
	return db
		.prepare(sql)
		.bind(...d1BindParams(params))
		.first<T>()
}

export async function all<T>(
	db: D1Database,
	sql: string,
	...params: Array<unknown>
) {
	const result = await db
		.prepare(sql)
		.bind(...d1BindParams(params))
		.all<T>()
	return result.results
}

export async function run(
	db: D1Database,
	sql: string,
	...params: Array<unknown>
) {
	return db
		.prepare(sql)
		.bind(...d1BindParams(params))
		.run()
}

export async function exec(db: D1Database, sql: string) {
	return db.exec(sql)
}
