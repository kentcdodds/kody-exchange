export async function first<T>(
	db: D1Database,
	sql: string,
	...params: Array<unknown>
) {
	return db
		.prepare(sql)
		.bind(...params)
		.first<T>()
}

export async function all<T>(
	db: D1Database,
	sql: string,
	...params: Array<unknown>
) {
	const result = await db
		.prepare(sql)
		.bind(...params)
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
		.bind(...params)
		.run()
}

export async function exec(db: D1Database, sql: string) {
	return db.exec(sql)
}
