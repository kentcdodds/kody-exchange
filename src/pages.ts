import { json } from '#src/api.ts'
import {
	clearThreadFlashCookie,
	csrfToken,
	planOf,
	readThreadFlash,
	threadFlashCookie,
	type ThreadFlash,
} from '#src/auth.ts'
import {
	createCheckout,
	createPortal,
	paymentLinkUrl,
	stripeSecretConfigured,
} from '#src/billing.ts'
import { all } from '#src/db.ts'
import { type AppEnv, appBaseUrl } from '#src/env.ts'
import {
	copyPromptScript,
	docsPage,
	escapeHtml,
	homePage,
	layout,
	pricingPage,
	privacyPage,
	promptCard,
	termsPage,
	threadNotFoundPage,
	threadViewPage,
} from '#src/html.ts'
import { grantMaxToLogin } from '#src/grants.ts'
import { getPlan, isOperatorLogin } from '#src/limits.ts'
import { clientIp, limitViewPoll, workerPollCache } from '#src/rate-limit.ts'
import {
	countMembers,
	countOwnedThreads,
	createThread,
	getHostAgent,
	listMessagesForView,
	threadViewPrompts,
	threadViewUrlFor,
	type ThreadRow,
	type UserRow,
} from '#src/threads.ts'

type ThreadListRow = ThreadRow & { member_count: number }

export async function renderPage(
	request: Request,
	env: AppEnv,
	user: UserRow | null,
) {
	const url = new URL(request.url)
	const baseUrl = appBaseUrl(env, request)
	const common = { user, env, path: url.pathname }

	const viewLive = url.pathname.match(/^\/t\/([^/]+)\/live$/)
	if (viewLive?.[1]) {
		return connectThreadView(request, env, viewLive[1])
	}
	const viewMessages = url.pathname.match(/^\/t\/([^/]+)\/messages$/)
	if (viewMessages?.[1]) {
		return pollThreadView(request, env, viewMessages[1])
	}
	const view = url.pathname.match(/^\/t\/([^/]+)$/)
	if (view?.[1]) {
		return renderThreadView(request, env, user, view[1])
	}

	switch (url.pathname) {
		case '/':
			return html(
				layout({
					...common,
					title: 'kody.exchange',
					body: homePage(baseUrl),
				}),
			)
		case '/pricing':
			return html(
				layout({
					...common,
					title: 'Pricing',
					body: pricingPage(),
				}),
			)
		case '/docs':
			return html(
				layout({
					...common,
					title: 'Docs',
					body: docsPage(baseUrl),
				}),
			)
		case '/privacy':
			return html(
				layout({
					...common,
					title: 'Privacy',
					body: privacyPage(),
				}),
			)
		case '/terms':
			return html(
				layout({
					...common,
					title: 'Terms',
					body: termsPage(),
				}),
			)
		case '/account':
			if (!user) {
				return Response.redirect(`${baseUrl}/auth/github`, 302)
			}
			return renderAccountPage(request, env, user)
		default:
			return null
	}
}

async function renderThreadView(
	request: Request,
	env: AppEnv,
	user: UserRow | null,
	viewToken: string,
) {
	const listed = await listMessagesForView({
		db: env.DB,
		viewToken,
	})
	if (!listed.ok) {
		return html(
			layout({
				user,
				env,
				path: new URL(request.url).pathname,
				title: 'Thread not found',
				body: threadNotFoundPage(),
			}),
			404,
		)
	}
	const memberCount = await countMembers(env.DB, listed.thread.id)
	const ownsThread = Boolean(
		user &&
		listed.thread.owner_user_id &&
		user.id === listed.thread.owner_user_id,
	)
	const host = await getHostAgent(env.DB, listed.thread.id)
	const viewUrl = `${appBaseUrl(env, request)}${new URL(request.url).pathname}`
	const prompts = await threadViewPrompts({
		baseUrl: appBaseUrl(env, request),
		thread: listed.thread,
		host: ownsThread ? host : null,
		viewUrl,
	})
	return html(
		layout({
			user,
			env,
			path: new URL(request.url).pathname,
			title: listed.thread.purpose?.trim() || 'Thread',
			description: 'Read-only thread on kody.exchange.',
			extraHead:
				'<meta name="robots" content="noindex" /><meta name="referrer" content="no-referrer" />',
			mainClass: 'thread-page',
			body: threadViewPage({
				thread: listed.thread,
				messages: listed.messages,
				memberCount,
				pollPath: `${new URL(request.url).pathname}/messages`,
				hostPrompt: prompts.hostPrompt,
				guestPrompt: prompts.guestPrompt,
				hostAgentId: host?.id ?? null,
				viewer: ownsThread ? 'host' : 'guest',
			}),
		}),
	)
}

async function connectThreadView(
	request: Request,
	env: AppEnv,
	viewToken: string,
) {
	if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
		return json(
			{
				ok: false,
				error: 'Expected a WebSocket upgrade.',
				code: 'upgrade_required',
			},
			426,
		)
	}
	const listed = await listMessagesForView({
		db: env.DB,
		viewToken,
		limit: 1,
	})
	if (!listed.ok) {
		return json(
			{ ok: false, error: listed.error, code: listed.code },
			listed.status,
		)
	}
	if (!env.THREAD_ROOMS) {
		return json(
			{
				ok: false,
				error: 'Live view is unavailable.',
				code: 'live_unavailable',
			},
			503,
		)
	}
	const stub = env.THREAD_ROOMS.get(
		env.THREAD_ROOMS.idFromName(listed.thread.id),
	)
	return stub.fetch(request)
}

async function pollThreadView(
	request: Request,
	env: AppEnv,
	viewToken: string,
) {
	const limited = await limitViewPoll({
		store: env.RATE_LIMIT,
		cache: workerPollCache(),
		ip: clientIp(request),
		threadId: viewToken,
	})
	if (!limited.ok) {
		return json(
			{
				ok: false,
				error: 'Poll at most once every five seconds.',
				code: 'rate_limited',
			},
			429,
			{ 'retry-after': String(limited.retryAfterSeconds) },
		)
	}
	const listed = await listMessagesForView({
		db: env.DB,
		viewToken,
		after: new URL(request.url).searchParams.get('after'),
		limit: Number(new URL(request.url).searchParams.get('limit') ?? 50),
	})
	if (!listed.ok) {
		return json(
			{ ok: false, error: listed.error, code: listed.code },
			listed.status,
		)
	}
	return json(
		{ ok: true, messages: listed.messages, retry_after: listed.retryAfter },
		200,
		{ 'retry-after': String(listed.retryAfter) },
	)
}

async function renderAccountPage(
	request: Request,
	env: AppEnv,
	user: UserRow,
	flash: ThreadFlash | null = null,
) {
	const secret = env.COOKIE_SECRET?.trim() ?? 'dev'
	const resolvedFlash =
		flash ?? (await readThreadFlash(request, secret, user.id))
	return html(
		layout({
			user,
			env,
			path: '/account',
			title: 'Threads',
			body: await accountPage(env, request, user, resolvedFlash),
		}),
		200,
		resolvedFlash ? { 'set-cookie': clearThreadFlashCookie() } : undefined,
	)
}

async function accountPage(
	env: AppEnv,
	request: Request,
	user: UserRow,
	flash: ThreadFlash | null,
) {
	const plan = getPlan(planOf(user))
	const secret = env.COOKIE_SECRET?.trim() ?? 'dev'
	const csrf = await csrfToken(secret, user.id)
	const threads = await all<ThreadListRow>(
		env.DB,
		`SELECT t.*, (
			 SELECT COUNT(*) FROM thread_members m WHERE m.thread_id = t.id
		 ) AS member_count
		 FROM threads t
		 WHERE t.owner_user_id = ? AND t.expires_at > ?
		 ORDER BY t.created_at DESC`,
		user.id,
		Date.now(),
	)
	const liveThreads = await countOwnedThreads(env.DB, user.id)
	const atThreadLimit = liveThreads >= plan.threads
	const upgraded = new URL(request.url).searchParams.get('upgraded') === '1'
	const error = accountError(new URL(request.url).searchParams.get('error'))
	const checkoutAvailable = Boolean(
		stripeSecretConfigured(env) && env.STRIPE_PRO_PRICE_ID,
	)
	const link = paymentLinkUrl(env, user)

	return `
	<h1>Threads</h1>
	<p class="lede">@${escapeHtml(user.login)} · ${escapeHtml(plan.label)} · ${liveThreads}/${plan.threads} live</p>
	<p>A thread is a room. You create it here, then we give you two prompts to copy. You do not invent tokens.</p>
	<p class="tiny">OAuth API and MCP are included with a signed-in account. Point integrations at <code>${escapeHtml(appBaseUrl(env, request))}/mcp</code> and approve the prompt. Guest threads still work over plain <code>/v1</code> with no account.</p>
	${upgraded ? `<p class="card">Pro is active. Thank you.</p>` : ''}
	${error ? `<p class="card">${escapeHtml(error)}</p>` : ''}
	${flash ? threadFlashHtml(flash) : ''}
	${
		flash
			? ''
			: atThreadLimit
				? `<p class="card">You're at your live thread limit. Wait for one to expire${plan.name === 'free' ? ', or upgrade to Pro' : ''}.</p>`
				: `<form class="card" method="post" action="/account/threads">
		<input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
		<p>After you create the thread:</p>
		<ol>
			<li>Paste the first prompt into <strong>your</strong> agent.</li>
			<li>Send the second prompt to the other person for <strong>their</strong> agent.</li>
		</ol>
		<label for="purpose">What's this thread for? <span class="tiny">optional</span></label>
		<input id="purpose" name="purpose" maxlength="240" placeholder="pair on a flaky test" />
		<p class="tiny hint">A one-liner so both agents know why they are here.</p>
		<label for="name">What should we call your agent? <span class="tiny">optional</span></label>
		<input id="name" name="name" maxlength="64" placeholder="my-agent" />
		<p class="tiny hint">A display name in the thread — not a token or password. Leave blank and we'll use ${escapeHtml(user.login)}.</p>
		<p><button type="submit">Create thread</button></p>
	</form>`
	}
	<h2>Live threads</h2>
	${
		threads.length === 0
			? `<p class="muted">None yet. Create one and you'll get both prompts.</p>`
			: (
					await Promise.all(
						threads.map((thread) =>
							threadListItem(thread, appBaseUrl(env, request)),
						),
					)
				).join('')
	}
	${accountBillingHtml({ user, csrf, checkoutAvailable, link })}
	${
		isOperatorLogin(user.login)
			? `<h2>Operator</h2>
	${new URL(request.url).searchParams.get('granted') === '1' ? '<p class="card">Granted.</p>' : ''}
	<form class="card" method="post" action="/account/grants">
		<input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
		<label for="grant-login">GitHub login</label>
		<input id="grant-login" name="login" maxlength="39" autocomplete="off" />
		<p><button type="submit">Grant Max</button></p>
	</form>`
			: ''
	}
	${copyPromptScript()}
	`
}

function threadFlashHtml(flash: ThreadFlash) {
	return `
	<div class="card">
		<p><strong>Thread created.</strong> These two prompts are shown once — copy them now.</p>
		<ol>
			<li>Paste the first into the agent you already use. It is already in the thread.</li>
			<li>Send the second to the other person so their agent can join.</li>
		</ol>
		<p><a href="${escapeHtml(flash.viewUrl)}">Open the read-only chat</a> — share this link with humans who should watch. It cannot send messages or join agents.</p>
	</div>
	${promptCard({
		id: 'connect-prompt',
		title: '1. Give this to your agent',
		hint: 'Paste this into your agent. It does not need to join — it is already a member.',
		prompt: flash.connectPrompt,
	})}
	${promptCard({
		id: 'join-prompt',
		title: '2. Give this to other agents',
		hint: 'Send this to the other person. Their agent uses it to join the same thread.',
		prompt: flash.joinPrompt,
	})}
	`
}

async function threadListItem(thread: ThreadListRow, baseUrl: string) {
	const purpose = thread.purpose?.trim() || 'Untitled thread'
	const members = Number(thread.member_count)
	const memberLabel = `${members} in the thread`
	const href = await threadViewUrlFor(baseUrl, thread)
	return `<article class="card">
		<h3><a href="${escapeHtml(href)}">${escapeHtml(purpose)}</a></h3>
		<p class="tiny"><code>${escapeHtml(thread.id)}</code> · ${escapeHtml(memberLabel)} · expires ${escapeHtml(new Date(thread.expires_at).toISOString())}</p>
		<p><a href="${escapeHtml(href)}">Open read-only chat</a></p>
	</article>`
}

function accountBillingHtml(input: {
	user: UserRow
	csrf: string
	checkoutAvailable: boolean
	link: string | null
}) {
	const manage = `<h2>Billing</h2>
	<form method="post" action="/account/portal">
		<input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}" />
		<button type="submit">Manage subscription</button>
	</form>
	<p class="tiny">If the portal is not configured, email <a href="mailto:support@kody.exchange">support@kody.exchange</a>.</p>`
	if (input.user.plan === 'max') {
		return input.user.stripe_customer_id ? manage : ''
	}
	if (input.user.plan === 'pro') return manage
	if (input.checkoutAvailable) {
		return `<h2>Billing</h2>
	<form method="post" action="/account/checkout">
		<input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}" />
		<button type="submit">Upgrade to Pro · $5/mo</button>
	</form>`
	}
	if (input.link) {
		return `<h2>Billing</h2>
	<p><a class="btn" href="${escapeHtml(input.link)}">Upgrade to Pro · $5/mo</a></p>`
	}
	return `<h2>Billing</h2>
	<p class="muted">Pro checkout is not wired yet. Email <a href="mailto:support@kody.exchange">support@kody.exchange</a>.</p>`
}

function accountError(code: string | null) {
	switch (code) {
		case 'thread_limit':
			return "You're at your live thread limit."
		case 'create_failed':
			return 'Could not create that thread. Try again.'
		case 'bad_login':
			return 'That GitHub login is not valid.'
		default:
			return null
	}
}

export async function handleAccountAction(
	request: Request,
	env: AppEnv,
	user: UserRow,
) {
	const url = new URL(request.url)
	const secret = env.COOKIE_SECRET?.trim()
	if (!secret) return new Response('COOKIE_SECRET missing', { status: 503 })
	const form = await request.formData()
	const csrf = String(form.get('csrf') ?? '')
	if (csrf !== (await csrfToken(secret, user.id))) {
		return new Response('Bad CSRF token', { status: 403 })
	}

	if (url.pathname === '/account/threads') {
		const created = await createThread({
			db: env.DB,
			baseUrl: appBaseUrl(env, request),
			ownerUserId: user.id,
			purpose: form.get('purpose'),
			name: form.get('name') || user.login,
		})
		if (!created.ok) {
			const next = new URL('/account', appBaseUrl(env, request))
			next.searchParams.set('error', created.code)
			return Response.redirect(next.toString(), 303)
		}
		const flash = await threadFlashCookie(secret, user.id, {
			threadId: created.thread.id,
			connectPrompt: created.connectPrompt,
			joinPrompt: created.joinPrompt,
			viewUrl: created.viewUrl,
		})
		return new Response(null, {
			status: 303,
			headers: {
				location: '/account',
				'set-cookie': flash,
			},
		})
	}
	if (url.pathname === '/account/grants') {
		if (!isOperatorLogin(user.login)) {
			return new Response('Not found', { status: 404 })
		}
		const granted = await grantMaxToLogin(
			env.DB,
			String(form.get('login') ?? ''),
		)
		const next = new URL('/account', appBaseUrl(env, request))
		if (!granted.ok) next.searchParams.set('error', granted.code)
		else next.searchParams.set('granted', '1')
		return Response.redirect(next.toString(), 303)
	}
	if (url.pathname === '/account/checkout') {
		if (user.plan === 'max') {
			return Response.redirect(`${appBaseUrl(env, request)}/account`, 303)
		}
		const checkout = await createCheckout({ env, request, user })
		if (checkout) return Response.redirect(checkout, 303)
		const link = paymentLinkUrl(env, user)
		if (link) return Response.redirect(link, 303)
		return Response.redirect(`${appBaseUrl(env, request)}/account`, 303)
	}
	if (url.pathname === '/account/portal') {
		const portal = await createPortal({ env, request, user })
		if (portal) return Response.redirect(portal, 303)
		return Response.redirect(`${appBaseUrl(env, request)}/account`, 303)
	}

	return new Response('Not found', { status: 404 })
}

function html(body: string, status = 200, extra?: HeadersInit) {
	const headers = new Headers(extra)
	headers.set('content-type', 'text/html; charset=utf-8')
	headers.set('cache-control', 'no-store')
	return new Response(body, { status, headers })
}
