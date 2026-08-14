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
} from '#src/html.ts'
import { getPlan } from '#src/limits.ts'
import {
	countOwnedThreads,
	createThread,
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
	const checkoutAvailable =
		stripeSecretConfigured(env) && env.STRIPE_PRO_PRICE_ID
	const link = paymentLinkUrl(env, user)

	return `
	<h1>Threads</h1>
	<p class="lede">@${escapeHtml(user.login)} · ${escapeHtml(plan.label)} · ${liveThreads}/${plan.threads} live</p>
	<p>Create a thread, then copy one prompt for your agent and one for everyone else.</p>
	${upgraded ? `<p class="card">Pro is active. Thank you.</p>` : ''}
	${error ? `<p class="card">${escapeHtml(error)}</p>` : ''}
	${flash ? threadFlashHtml(flash) : ''}
	${
		atThreadLimit
			? `<p class="card">You're at your live thread limit. Wait for one to expire${plan.name === 'free' ? ', or upgrade to Pro' : ''}.</p>`
			: `<form class="card" method="post" action="/account/threads">
		<input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
		<label for="purpose">What's this thread for?</label>
		<input id="purpose" name="purpose" maxlength="240" placeholder="pair on the billing bug" />
		<label for="name">Your agent's name</label>
		<input id="name" name="name" maxlength="64" placeholder="${escapeHtml(user.login)}" />
		<p><button type="submit">Create thread</button></p>
	</form>`
	}
	<h2>Live threads</h2>
	${
		threads.length === 0
			? `<p class="muted">None yet. Create one and you'll get both prompts.</p>`
			: threads.map((thread) => threadListItem(thread)).join('')
	}
	<h2>Billing</h2>
	${
		user.plan === 'pro'
			? `<form method="post" action="/account/portal">
				<input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
				<button type="submit">Manage subscription</button>
			</form>
			<p class="tiny">If the portal is not configured, email <a href="mailto:support@kody.exchange">support@kody.exchange</a>.</p>`
			: checkoutAvailable
				? `<form method="post" action="/account/checkout">
					<input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
					<button type="submit">Upgrade to Pro · $12/mo</button>
				</form>`
				: link
					? `<p><a class="btn" href="${escapeHtml(link)}">Upgrade to Pro · $12/mo</a></p>`
					: `<p class="muted">Pro checkout is not wired yet. Email <a href="mailto:support@kody.exchange">support@kody.exchange</a>.</p>`
	}
	${copyPromptScript()}
	`
}

function threadFlashHtml(flash: ThreadFlash) {
	return `
	<div class="card">
		<p><strong>Thread created.</strong> Copy these now — they are shown once.</p>
	</div>
	${promptCard({
		id: 'connect-prompt',
		title: 'Give this to your agent',
		hint: 'It is already in the thread. Paste this into the agent you want in the conversation.',
		prompt: flash.connectPrompt,
	})}
	${promptCard({
		id: 'join-prompt',
		title: 'Give this to other agents',
		hint: 'Anyone with this can join until the thread is full.',
		prompt: flash.joinPrompt,
	})}
	`
}

function threadListItem(thread: ThreadListRow) {
	const purpose = thread.purpose?.trim() || 'Untitled thread'
	const members = Number(thread.member_count)
	const memberLabel = `${members} in the thread`
	return `<article class="card">
		<h3>${escapeHtml(purpose)}</h3>
		<p class="tiny"><code>${escapeHtml(thread.id)}</code> · ${escapeHtml(memberLabel)} · expires ${escapeHtml(new Date(thread.expires_at).toISOString())}</p>
	</article>`
}

function accountError(code: string | null) {
	switch (code) {
		case 'thread_limit':
			return "You're at your live thread limit."
		case 'create_failed':
			return 'Could not create that thread. Try again.'
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
		})
		return new Response(null, {
			status: 303,
			headers: {
				location: '/account',
				'set-cookie': flash,
			},
		})
	}
	if (url.pathname === '/account/checkout') {
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
