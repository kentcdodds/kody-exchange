import { all, first } from '#src/db.ts'
import { escapeHtml } from '#src/html.ts'
import { accountPlan, yearMonth, type AccountPlanName } from '#src/limits.ts'
import { sqlThreadLive, sqlThreadUnexpired } from '#src/threads.ts'

export const adminPath = '/admin'
export const adminJsonPath = '/admin.json'
export const adminRecentUserLimit = 50
export const adminRecentThreadLimit = 40
export const adminDailyWindowDays = 14

export type AdminPlanCounts = Record<AccountPlanName, number>

export type AdminUserInsight = {
	login: string
	name: string | null
	email: string | null
	plan: AccountPlanName
	createdAt: string
	liveThreads: number
	messagesThisMonth: number
}

export type AdminThreadInsight = {
	id: string
	purpose: string | null
	ownerLogin: string | null
	guest: boolean
	memberCount: number
	createdAt: string
	expiresAt: string | null
	neverExpires: boolean
	archived: boolean
	lastMessageAt: string | null
}

export type AdminDayCount = {
	day: string
	count: number
}

export type AdminInsights = {
	generatedAt: string
	users: {
		total: number
		byPlan: AdminPlanCounts
	}
	threads: {
		liveOwned: number
		liveGuest: number
		archivedUnexpired: number
		remaining: number
	}
	messages: {
		all: number
		thisMonth: number
		thisMonthAccount: number
		thisMonthGuest: number
	}
	blobs: {
		count: number
		bytes: number
	}
	liveAgents: number
	liveGuestIps: number
	recentUsers: Array<AdminUserInsight>
	recentThreads: Array<AdminThreadInsight>
	dailyMessages: Array<AdminDayCount>
}

type CountRow = { n: number | string | null }
type PlanRow = { plan: string; n: number | string | null }
type MonthSplitRow = {
	account: number | string | null
	guest: number | string | null
}
type BlobRow = { n: number | string | null; bytes: number | string | null }
type UserRow = {
	login: string
	name: string | null
	email: string | null
	plan: string
	created_at: number
	live_threads: number | string | null
	messages_this_month: number | string | null
}
type ThreadRow = {
	id: string
	purpose: string | null
	owner_login: string | null
	created_at: number
	expires_at: number
	archived_at: number | null
	never_expires_at: number | null
	member_count: number | string | null
	last_message_at: number | string | null
}
type DayRow = { day: string; n: number | string | null }

function asCount(value: number | string | null | undefined) {
	return Number(value ?? 0)
}

function iso(ms: number) {
	return new Date(ms).toISOString()
}

function utcDayKey(ms: number) {
	return new Date(ms).toISOString().slice(0, 10)
}

function emptyPlanCounts(): AdminPlanCounts {
	return { free: 0, pro: 0, max: 0 }
}

async function count(db: D1Database, sql: string, ...params: Array<unknown>) {
	const row = await first<CountRow>(db, sql, ...params)
	return asCount(row?.n)
}

function lastUtcDays(now: number, days: number) {
	const keys: Array<string> = []
	const start = Date.UTC(
		new Date(now).getUTCFullYear(),
		new Date(now).getUTCMonth(),
		new Date(now).getUTCDate(),
	)
	for (let i = 0; i < days; i++) {
		keys.push(utcDayKey(start - i * 24 * 60 * 60 * 1000))
	}
	return keys
}

/**
 * Operator snapshot. Counts and metadata only — never message bodies, tokens,
 * or guest IPs.
 */
export async function loadAdminInsights(
	db: D1Database,
	now = Date.now(),
): Promise<AdminInsights> {
	const month = yearMonth(now)
	const sinceDaily = now - adminDailyWindowDays * 24 * 60 * 60 * 1000
	const [
		usersTotal,
		planRows,
		liveOwned,
		liveGuest,
		archivedUnexpired,
		threadsRemaining,
		messagesAll,
		monthSplit,
		blobRow,
		liveAgents,
		liveGuestIps,
		recentUserRows,
		recentThreadRows,
		dailyRows,
	] = await Promise.all([
		count(db, 'SELECT COUNT(*) AS n FROM users'),
		all<PlanRow>(db, 'SELECT plan, COUNT(*) AS n FROM users GROUP BY plan'),
		count(
			db,
			`SELECT COUNT(*) AS n FROM threads
			 WHERE owner_user_id IS NOT NULL AND ${sqlThreadLive()}`,
			now,
		),
		count(
			db,
			`SELECT COUNT(*) AS n FROM threads
			 WHERE owner_user_id IS NULL AND ${sqlThreadLive()}`,
			now,
		),
		count(
			db,
			`SELECT COUNT(*) AS n FROM threads
			 WHERE ${sqlThreadUnexpired()} AND archived_at IS NOT NULL`,
			now,
		),
		count(db, 'SELECT COUNT(*) AS n FROM threads'),
		count(db, 'SELECT COUNT(*) AS n FROM messages'),
		first<MonthSplitRow>(
			db,
			`SELECT
				 COALESCE(SUM(CASE WHEN owner_key LIKE 'user:%' THEN message_count ELSE 0 END), 0) AS account,
				 COALESCE(SUM(CASE WHEN owner_key LIKE 'guest:%' THEN message_count ELSE 0 END), 0) AS guest
			 FROM usage_months
			 WHERE yyyymm = ?`,
			month,
		),
		first<BlobRow>(
			db,
			'SELECT COUNT(*) AS n, COALESCE(SUM(byte_size), 0) AS bytes FROM blobs',
		),
		count(db, 'SELECT COUNT(*) AS n FROM agents WHERE revoked_at IS NULL'),
		count(
			db,
			`SELECT COUNT(DISTINCT creator_ip) AS n FROM threads
			 WHERE owner_user_id IS NULL
			   AND creator_ip IS NOT NULL
			   AND ${sqlThreadLive()}`,
			now,
		),
		all<UserRow>(
			db,
			`SELECT u.login, u.name, u.email, u.plan, u.created_at,
				 (
					 SELECT COUNT(*) FROM threads t
					 WHERE t.owner_user_id = u.id AND ${sqlThreadLive('t.')}
				 ) AS live_threads,
				 COALESCE((
					 SELECT um.message_count FROM usage_months um
					 WHERE um.owner_key = 'user:' || u.id AND um.yyyymm = ?
				 ), 0) AS messages_this_month
			 FROM users u
			 ORDER BY u.created_at DESC
			 LIMIT ?`,
			now,
			month,
			adminRecentUserLimit,
		),
		all<ThreadRow>(
			db,
			`SELECT t.id, t.purpose, u.login AS owner_login, t.created_at, t.expires_at,
				 t.archived_at, t.never_expires_at,
				 (SELECT COUNT(*) FROM thread_members m WHERE m.thread_id = t.id) AS member_count,
				 (SELECT MAX(msg.created_at) FROM messages msg WHERE msg.thread_id = t.id) AS last_message_at
			 FROM threads t
			 LEFT JOIN users u ON u.id = t.owner_user_id
			 WHERE ${sqlThreadUnexpired('t.')}
			 ORDER BY t.created_at DESC
			 LIMIT ?`,
			now,
			adminRecentThreadLimit,
		),
		all<DayRow>(
			db,
			`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n
			 FROM messages
			 WHERE created_at >= ?
			 GROUP BY day
			 ORDER BY day DESC`,
			sinceDaily,
		),
	])

	const byPlan = emptyPlanCounts()
	for (const row of planRows) {
		const plan = accountPlan(row.plan)
		byPlan[plan] += asCount(row.n)
	}

	const thisMonthAccount = asCount(monthSplit?.account)
	const thisMonthGuest = asCount(monthSplit?.guest)
	const dailyByDay = new Map(
		dailyRows.map((row) => [row.day, asCount(row.n)] as const),
	)

	return {
		generatedAt: iso(now),
		users: { total: usersTotal, byPlan },
		threads: {
			liveOwned,
			liveGuest,
			archivedUnexpired,
			remaining: threadsRemaining,
		},
		messages: {
			all: messagesAll,
			thisMonth: thisMonthAccount + thisMonthGuest,
			thisMonthAccount,
			thisMonthGuest,
		},
		blobs: {
			count: asCount(blobRow?.n),
			bytes: asCount(blobRow?.bytes),
		},
		liveAgents,
		liveGuestIps,
		recentUsers: recentUserRows.map((row) => ({
			login: row.login,
			name: row.name,
			email: row.email,
			plan: accountPlan(row.plan),
			createdAt: iso(row.created_at),
			liveThreads: asCount(row.live_threads),
			messagesThisMonth: asCount(row.messages_this_month),
		})),
		recentThreads: recentThreadRows.map((row) => ({
			id: row.id,
			purpose: row.purpose,
			ownerLogin: row.owner_login,
			guest: row.owner_login == null,
			memberCount: asCount(row.member_count),
			createdAt: iso(row.created_at),
			expiresAt: row.never_expires_at != null ? null : iso(row.expires_at),
			neverExpires: row.never_expires_at != null,
			archived: row.archived_at != null,
			lastMessageAt:
				row.last_message_at == null ? null : iso(asCount(row.last_message_at)),
		})),
		dailyMessages: lastUtcDays(now, adminDailyWindowDays).map((day) => ({
			day,
			count: dailyByDay.get(day) ?? 0,
		})),
	}
}

function formatNumber(value: number) {
	return value.toLocaleString('en-US')
}

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${formatNumber(bytes)} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function stamp(value: string | null) {
	if (!value) return '—'
	return `${value.replace('T', ' ').slice(0, 16)} UTC`
}

function statCard(label: string, value: string, hint: string) {
	return `<article class="card">
		<h3>${escapeHtml(label)}</h3>
		<p class="price">${escapeHtml(value)}</p>
		<p class="tiny">${escapeHtml(hint)}</p>
	</article>`
}

function usersTable(users: Array<AdminUserInsight>) {
	if (users.length === 0) {
		return '<p class="muted">No signed-in users yet.</p>'
	}
	const rows = users
		.map(
			(user) => `<tr>
			<td>@${escapeHtml(user.login)}</td>
			<td>${escapeHtml(user.name ?? '—')}</td>
			<td>${escapeHtml(user.email ?? '—')}</td>
			<td>${escapeHtml(user.plan)}</td>
			<td class="num">${escapeHtml(formatNumber(user.liveThreads))}</td>
			<td class="num">${escapeHtml(formatNumber(user.messagesThisMonth))}</td>
			<td>${escapeHtml(stamp(user.createdAt))}</td>
		</tr>`,
		)
		.join('')
	return `<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>GitHub</th>
					<th>Name</th>
					<th>Email</th>
					<th>Plan</th>
					<th class="num">Live threads</th>
					<th class="num">Msgs this month</th>
					<th>Signed up</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	</div>`
}

function threadsTable(threads: Array<AdminThreadInsight>) {
	if (threads.length === 0) {
		return '<p class="muted">No unexpired threads.</p>'
	}
	const rows = threads
		.map((thread) => {
			const owner = thread.guest
				? 'guest'
				: `@${thread.ownerLogin ?? 'unknown'}`
			const purpose = thread.purpose?.trim() || 'Untitled'
			const state = thread.archived ? 'archived' : 'live'
			return `<tr>
			<td>${escapeHtml(purpose)}</td>
			<td>${escapeHtml(owner)}</td>
			<td class="num">${escapeHtml(formatNumber(thread.memberCount))}</td>
			<td>${escapeHtml(state)}</td>
			<td>${escapeHtml(stamp(thread.lastMessageAt))}</td>
			<td>${escapeHtml(stamp(thread.createdAt))}</td>
		</tr>`
		})
		.join('')
	return `<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Purpose</th>
					<th>Owner</th>
					<th class="num">Members</th>
					<th>State</th>
					<th>Last message</th>
					<th>Created</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	</div>`
}

function dailyTable(days: Array<AdminDayCount>) {
	const rows = days
		.map(
			(day) => `<tr>
			<td>${escapeHtml(day.day)}</td>
			<td class="num">${escapeHtml(formatNumber(day.count))}</td>
		</tr>`,
		)
		.join('')
	return `<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>UTC day</th>
					<th class="num">Messages</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	</div>`
}

export function adminPage(insights: AdminInsights) {
	const plans = insights.users.byPlan
	return `
	<p class="stamp">Operator</p>
	<h1>Usage</h1>
	<p class="lede">Signed-in accounts, live rooms, and message volume. Message bodies, tokens, and guest IPs stay off this page.</p>
	<p class="tiny">Snapshot ${escapeHtml(stamp(insights.generatedAt))}. Same numbers as JSON at <code>${escapeHtml(adminJsonPath)}</code>.</p>
	<div class="stats">
		${statCard(
			'Users',
			formatNumber(insights.users.total),
			`${formatNumber(plans.free)} free · ${formatNumber(plans.pro)} pro · ${formatNumber(plans.max)} max`,
		)}
		${statCard(
			'Live threads',
			formatNumber(insights.threads.liveOwned + insights.threads.liveGuest),
			`${formatNumber(insights.threads.liveOwned)} owned · ${formatNumber(insights.threads.liveGuest)} guest`,
		)}
		${statCard(
			'Messages this month',
			formatNumber(insights.messages.thisMonth),
			`${formatNumber(insights.messages.thisMonthAccount)} account · ${formatNumber(insights.messages.thisMonthGuest)} guest`,
		)}
		${statCard(
			'Messages all time',
			formatNumber(insights.messages.all),
			`${formatNumber(insights.threads.remaining)} threads still in D1`,
		)}
		${statCard(
			'Live agents',
			formatNumber(insights.liveAgents),
			`${formatNumber(insights.liveGuestIps)} guest IPs with a live room`,
		)}
		${statCard(
			'Blobs',
			formatNumber(insights.blobs.count),
			formatBytes(insights.blobs.bytes),
		)}
	</div>
	${
		insights.threads.archivedUnexpired === 0
			? ''
			: `<p class="tiny">${escapeHtml(formatNumber(insights.threads.archivedUnexpired))} archived rooms are still within retention.</p>`
	}
	<h2>Accounts</h2>
	${usersTable(insights.recentUsers)}
	<h2>Unexpired threads</h2>
	<p class="tiny">Purposes are the one-liners people typed. This list does not include watch links or tokens.</p>
	${threadsTable(insights.recentThreads)}
	<h2>Messages by day</h2>
	<p class="tiny">Includes system join lines. Last ${escapeHtml(String(adminDailyWindowDays))} UTC days.</p>
	${dailyTable(insights.dailyMessages)}
	<p class="tiny">Hidden plan grants still live on <a href="/account">Threads</a>.</p>
	`
}
