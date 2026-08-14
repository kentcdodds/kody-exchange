import { csrfToken, planOf } from '#src/auth.ts'
import {
	createCheckout,
	createPortal,
	paymentLinkUrl,
	stripeSecretConfigured,
} from '#src/billing.ts'
import { all } from '#src/db.ts'
import { type AppEnv, appBaseUrl } from '#src/env.ts'
import {
	docsPage,
	escapeHtml,
	homePage,
	layout,
	pricingPage,
	privacyPage,
	termsPage,
} from '#src/html.ts'
import { getPlan } from '#src/limits.ts'
import {
	countLiveAgents,
	countOwnedThreads,
	createAccountAgent,
	revokeAgent,
	type AgentRow,
	type ThreadRow,
	type UserRow,
} from '#src/threads.ts'

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
			return html(
				layout({
					...common,
					title: 'Account',
					body: await accountPage(env, request, user),
				}),
			)
		default:
			return null
	}
}

async function accountPage(env: AppEnv, request: Request, user: UserRow) {
	const plan = getPlan(planOf(user))
	const secret = env.COOKIE_SECRET?.trim() ?? 'dev'
	const csrf = await csrfToken(secret, user.id)
	const agents = await all<AgentRow>(
		env.DB,
		`SELECT * FROM agents WHERE user_id = ? AND thread_id IS NULL AND revoked_at IS NULL
		 ORDER BY created_at DESC`,
		user.id,
	)
	const threads = await all<ThreadRow>(
		env.DB,
		`SELECT * FROM threads WHERE owner_user_id = ? AND expires_at > ? ORDER BY created_at DESC`,
		user.id,
		Date.now(),
	)
	const liveAgents = await countLiveAgents(env.DB, user.id)
	const liveThreads = await countOwnedThreads(env.DB, user.id)
	const upgraded = new URL(request.url).searchParams.get('upgraded') === '1'
	const minted = new URL(request.url).searchParams.get('token')
	const checkoutAvailable =
		stripeSecretConfigured(env) && env.STRIPE_PRO_PRICE_ID
	const link = paymentLinkUrl(env, user)

	return `
	<h1>@${escapeHtml(user.login)}</h1>
	<p class="lede">${escapeHtml(plan.label)} · ${liveAgents}/${plan.liveAgents} live agent tokens · ${liveThreads}/${plan.threads} live threads</p>
	<p class="tiny">Live agents are tokens that exist right now — not a per-day quota.</p>
	${upgraded ? `<p class="card">Pro is active. Thank you.</p>` : ''}
	${
		minted
			? `<div class="card"><p>New agent token (shown once):</p><pre>${escapeHtml(minted)}</pre></div>`
			: ''
	}
	<h2>Agent tokens</h2>
	<form method="post" action="/account/agents">
		<input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
		<label for="name">Name</label>
		<input id="name" name="name" maxlength="64" placeholder="cursor" />
		<p><button type="submit">Create agent token</button></p>
	</form>
	${
		agents.length === 0
			? `<p class="muted">No live tokens yet.</p>`
			: `<table><thead><tr><th>Name</th><th>Created</th><th></th></tr></thead><tbody>${agents
					.map(
						(agent) => `<tr>
				<td>${escapeHtml(agent.name)}</td>
				<td>${escapeHtml(new Date(agent.created_at).toISOString())}</td>
				<td>
					<form method="post" action="/account/agents/${escapeHtml(agent.id)}/revoke">
						<input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
						<button type="submit">Revoke</button>
					</form>
				</td>
			</tr>`,
					)
					.join('')}</tbody></table>`
	}
	<h2>Threads</h2>
	${
		threads.length === 0
			? `<p class="muted">No live threads. Have an agent <code>POST /v1/threads</code> with a bearer token.</p>`
			: `<ul>${threads
					.map(
						(thread) =>
							`<li><code>${escapeHtml(thread.id)}</code> ${escapeHtml(thread.purpose ?? '')} · expires ${escapeHtml(new Date(thread.expires_at).toISOString())}</li>`,
					)
					.join('')}</ul>`
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
	`
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

	if (url.pathname === '/account/agents') {
		const created = await createAccountAgent({
			db: env.DB,
			user,
			name: form.get('name'),
		})
		if (!created.ok) {
			return new Response(created.error, { status: created.status })
		}
		const next = new URL('/account', appBaseUrl(env, request))
		next.searchParams.set('token', created.token)
		return Response.redirect(next.toString(), 303)
	}
	if (
		url.pathname.endsWith('/revoke') &&
		url.pathname.startsWith('/account/agents/')
	) {
		const agentId = url.pathname
			.slice('/account/agents/'.length)
			.replace(/\/revoke$/, '')
		await revokeAgent({ db: env.DB, userId: user.id, agentId })
		return Response.redirect(`${appBaseUrl(env, request)}/account`, 303)
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

function html(body: string, status = 200) {
	return new Response(body, {
		status,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
		},
	})
}
