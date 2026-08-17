import { csrfToken, readSessionUser } from '#src/auth.ts'
import { type AppEnv, appBaseUrl } from '#src/env.ts'
import { escapeHtml, layout } from '#src/html.ts'
import { oauthPaths, oauthScopes } from '#src/oauth-paths.ts'
import { getPkceValidationError } from '#src/oauth-pkce.ts'
import {
	type OAuthAuthRequest,
	resolveAuthorizationResource,
} from '#src/oauth-user.ts'

function html(body: string, status = 200, extra?: HeadersInit) {
	const headers = new Headers(extra)
	headers.set('content-type', 'text/html; charset=utf-8')
	headers.set('cache-control', 'no-store')
	return new Response(body, { status, headers })
}

function resolveScopes(requested: Array<string>) {
	if (requested.length === 0) return [...oauthScopes]
	const allowed = new Set<string>(oauthScopes)
	const granted = requested.filter((scope) => allowed.has(scope))
	return granted.length > 0 ? granted : [...oauthScopes]
}

function applyDefaultResource(authRequest: OAuthAuthRequest, origin: string) {
	authRequest.resource = resolveAuthorizationResource(
		authRequest.resource,
		origin,
	)
	return authRequest
}

function accessDeniedRedirect(authRequest: OAuthAuthRequest) {
	try {
		const redirect = new URL(authRequest.redirectUri)
		redirect.searchParams.set('error', 'access_denied')
		if (authRequest.state) redirect.searchParams.set('state', authRequest.state)
		return redirect.toString()
	} catch {
		return null
	}
}

export async function handleAuthorizeRequest(request: Request, env: AppEnv) {
	const helpers = env.OAUTH_PROVIDER
	if (!helpers) {
		return new Response('OAuth provider is not configured.', { status: 503 })
	}

	let authRequest: OAuthAuthRequest
	try {
		authRequest = applyDefaultResource(
			await helpers.parseAuthRequest(request),
			appBaseUrl(env, request),
		)
	} catch {
		return html(
			layout({
				user: null,
				env,
				path: oauthPaths.authorize,
				title: 'Authorize',
				body: `<h1>Authorize access</h1><p>This authorization request is invalid or expired. Start again from the app that sent you here.</p>`,
			}),
			400,
		)
	}

	const user = await readSessionUser(request, env)
	if (!user) {
		const next = `${oauthPaths.authorize}${new URL(request.url).search}`
		const login = new URL('/auth/github', appBaseUrl(env, request))
		login.searchParams.set('next', next)
		return Response.redirect(login.toString(), 302)
	}

	if (request.method === 'GET') {
		const client = await helpers.lookupClient(authRequest.clientId)
		const secret = env.COOKIE_SECRET?.trim() ?? 'dev'
		const csrf = await csrfToken(secret, user.id)
		const clientName = client?.clientName?.trim() || authRequest.clientId
		return html(
			layout({
				user,
				env,
				path: oauthPaths.authorize,
				title: 'Authorize',
				body: `
	<h1>Authorize access</h1>
	<p class="lede"><strong>${escapeHtml(clientName)}</strong> wants to use your kody.exchange account as @${escapeHtml(user.login)}.</p>
	<p>This lets that app create threads, send as you, and set webhooks on threads you own. It does not get your GitHub password.</p>
	<form class="card" method="post" action="${escapeHtml(oauthPaths.authorize + new URL(request.url).search)}">
		<input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
		<p><button type="submit" name="decision" value="approve">Allow</button>
		<button type="submit" name="decision" value="deny" class="ghost">Deny</button></p>
	</form>`,
			}),
		)
	}

	if (request.method !== 'POST') {
		return new Response('Method not allowed', { status: 405 })
	}

	const secret = env.COOKIE_SECRET?.trim()
	if (!secret) return new Response('COOKIE_SECRET missing', { status: 503 })
	const form = await request.formData()
	if (String(form.get('csrf') ?? '') !== (await csrfToken(secret, user.id))) {
		return new Response('Bad CSRF token', { status: 403 })
	}

	const pkceError = getPkceValidationError({
		codeChallenge: authRequest.codeChallenge,
		codeChallengeMethod: authRequest.codeChallengeMethod,
	})
	if (pkceError) {
		return html(
			layout({
				user,
				env,
				path: oauthPaths.authorize,
				title: 'Authorize',
				body: `<h1>Authorize access</h1><p>${escapeHtml(pkceError)}</p>`,
			}),
			400,
		)
	}

	if (String(form.get('decision') ?? 'approve') === 'deny') {
		const redirectTo = accessDeniedRedirect(authRequest)
		if (!redirectTo) {
			return html(
				layout({
					user,
					env,
					path: oauthPaths.authorize,
					title: 'Authorize',
					body: `<h1>Authorize access</h1><p>Missing redirect URI for access denial.</p>`,
				}),
				400,
			)
		}
		return Response.redirect(redirectTo, 302)
	}

	const { redirectTo } = await helpers.completeAuthorization({
		request: authRequest,
		userId: user.id,
		scope: resolveScopes(authRequest.scope),
		metadata: {
			email: user.email,
			clientId: authRequest.clientId,
		},
		props: {
			userId: user.id,
			email: user.email ?? undefined,
			username: user.login,
			displayName: user.name ?? user.login,
		},
	})
	return Response.redirect(redirectTo, 302)
}
