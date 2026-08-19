import { handleApi, json } from '#src/api.ts'
import {
	apiCatalog,
	apiCatalogPath,
	authMd,
	authMdPath,
	discoveryHeaders,
	llmsTxt,
	llmsTxtPath,
	mcpServerCard,
	mcpServerCardPath,
	robotsTxt,
	securityTxt,
	securityTxtPath,
	sitemapXml,
	textResponse,
} from '#src/discover.ts'
import {
	finishGithubOAuth,
	logoutResponse,
	readSessionUser,
	startGithubOAuth,
} from '#src/auth.ts'
import {
	handleStripeEvent,
	stripeWebhookConfigured,
	verifyStripeSignature,
} from '#src/billing.ts'
import { type AppEnv, appBaseUrl } from '#src/env.ts'
import { httpsRedirect } from '#src/https.ts'
import {
	handleMcp,
	isMcpBrowserNavigation,
	mcpBrowserLanding,
} from '#src/mcp.ts'
import { handleAuthorizeRequest } from '#src/oauth-authorize.ts'
import { oauthPaths } from '#src/oauth-paths.ts'
import {
	handleProtectedResourceMetadata,
	resolveOAuthUser,
	unauthorizedOAuthResponse,
} from '#src/oauth-user.ts'
import { pageOgForImagePath, viewTokenForOgPath } from '#src/og-pages.ts'
import { handleAccountAction, renderPage } from '#src/pages.ts'
import { handleUserApi } from '#src/user-api.ts'
import { getThreadViewCard, purgeExpired } from '#src/threads.ts'

export default {
	async fetch(
		request: Request,
		env: AppEnv,
		ctx?: ExecutionContext,
	): Promise<Response> {
		return handleRequest(request, env, ctx)
	},
	async scheduled(_event: ScheduledEvent, env: AppEnv) {
		await purgeExpired(env.DB)
	},
}

export async function handleRequest(
	request: Request,
	env: AppEnv,
	ctx?: ExecutionContext,
) {
	const redirected = httpsRedirect(request)
	if (redirected) return redirected

	const url = new URL(request.url)
	const origin = appBaseUrl(env, request)

	if (url.pathname === '/health') {
		return json({
			ok: true,
			commit: env.APP_COMMIT_SHA,
			githubOAuth: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
			stripe: Boolean(env.STRIPE_SECRET_KEY || env.STRIPE_PAYMENT_LINK_URL),
		})
	}

	if (url.pathname === '/favicon.ico') {
		return Response.redirect(
			new URL('/favicon.png', request.url).toString(),
			302,
		)
	}

	if (url.pathname === '/robots.txt') {
		return textResponse(robotsTxt(origin), 'text/plain; charset=utf-8')
	}
	if (url.pathname === '/security.txt') {
		return Response.redirect(new URL(securityTxtPath, origin).toString(), 301)
	}
	if (url.pathname === securityTxtPath) {
		return textResponse(securityTxt(origin), 'text/plain; charset=utf-8')
	}
	if (url.pathname === '/sitemap.xml') {
		return textResponse(sitemapXml(origin), 'application/xml; charset=utf-8')
	}
	if (url.pathname === llmsTxtPath) {
		return textResponse(llmsTxt(origin), 'text/plain; charset=utf-8')
	}
	if (url.pathname === authMdPath) {
		return textResponse(authMd(origin), 'text/markdown; charset=utf-8')
	}
	if (url.pathname === apiCatalogPath) {
		const headers = new Headers(discoveryHeaders(origin))
		headers.set(
			'content-type',
			'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
		)
		headers.set('cache-control', 'public, max-age=300')
		return new Response(JSON.stringify(apiCatalog(origin)), { headers })
	}
	if (
		url.pathname === mcpServerCardPath ||
		url.pathname === '/.well-known/mcp.json' ||
		url.pathname === '/server-card'
	) {
		return json(mcpServerCard(origin))
	}

	const viewOgToken = viewTokenForOgPath(url.pathname)
	if (viewOgToken) {
		const card = await getThreadViewCard({
			db: env.DB,
			viewToken: viewOgToken,
		})
		if (!card.ok) {
			return json(
				{ ok: false, error: card.error, code: card.code },
				card.status,
			)
		}
		// Lazy import (sanctioned exception to the no-inline-imports rule):
		// satori + resvg-wasm would otherwise sit in every isolate for a
		// route that only social crawlers hit. Expired/missing rooms 404
		// above so they never load the renderer.
		const { viewOgImageResponse } = await import('#src/og.ts')
		return viewOgImageResponse(env, {
			viewToken: viewOgToken,
			purpose: card.thread.purpose,
			members: card.members,
			seats: card.seats,
			expiresAt:
				card.thread.never_expires_at != null ? null : card.thread.expires_at,
			archived: card.thread.archived_at != null,
		})
	}

	const pageOg = pageOgForImagePath(url.pathname)
	if (pageOg) {
		// Lazy import (sanctioned exception to the no-inline-imports rule):
		// satori + resvg-wasm would otherwise sit in every isolate for a
		// route that only social crawlers hit.
		const { ogImageResponse } = await import('#src/og.ts')
		return ogImageResponse(env, pageOg.id)
	}

	if (url.pathname === '/research' || url.pathname === '/research/') {
		return Response.redirect(new URL('/safety', request.url).toString(), 301)
	}
	if (
		url.pathname === '/research/og.png' ||
		url.pathname === '/research/og.jpg'
	) {
		const dest = url.pathname.endsWith('.jpg')
			? '/safety/og.jpg'
			: '/safety/og.png'
		return Response.redirect(new URL(dest, request.url).toString(), 301)
	}

	if (request.method === 'POST' && url.pathname === '/webhooks/stripe') {
		return stripeWebhook(request, env)
	}

	if (url.pathname === '/auth/github' && request.method === 'GET') {
		return startGithubOAuth(request, env)
	}
	if (url.pathname === '/auth/callback/github' && request.method === 'GET') {
		return finishGithubOAuth(request, env)
	}
	if (url.pathname === '/auth/logout' && request.method === 'POST') {
		return logoutResponse()
	}

	if (url.pathname === oauthPaths.protectedResource) {
		return handleProtectedResourceMetadata(request, env)
	}
	if (url.pathname === `${oauthPaths.protectedResource}${oauthPaths.mcp}`) {
		return handleProtectedResourceMetadata(request, env)
	}
	if (url.pathname === oauthPaths.authorize) {
		return handleAuthorizeRequest(request, env)
	}

	const api = await handleApi(request, env, ctx)
	if (api) return api

	if (url.pathname === oauthPaths.mcp) {
		if (isMcpBrowserNavigation(request)) {
			const sessionUser = await readSessionUser(request, env)
			return mcpBrowserLanding(request, env, sessionUser)
		}
		// Production `/mcp` is an OAuthProvider apiHandler in worker.ts.
		// This path remains for tests (`env.OAUTH_USER`) and the HTML landing.
		const oauthUser = await resolveOAuthUser(request, env)
		if (!oauthUser) {
			return unauthorizedOAuthResponse(appBaseUrl(env, request))
		}
		const mcp = await handleMcp(request, env, oauthUser, ctx)
		if (mcp) return mcp
	}

	if (url.pathname.startsWith(oauthPaths.apiPrefix)) {
		const oauthUser = await resolveOAuthUser(request, env)
		if (!oauthUser) {
			return unauthorizedOAuthResponse(appBaseUrl(env, request))
		}
		return handleUserApi(request, env, oauthUser, ctx)
	}

	const user = await readSessionUser(request, env)
	if (request.method === 'POST' && url.pathname.startsWith('/account')) {
		if (!user)
			return Response.redirect(
				new URL('/auth/github', request.url).toString(),
				302,
			)
		return handleAccountAction(request, env, user)
	}

	const page = await renderPage(request, env, user)
	if (page) return page

	const publicAsset = publicAssetKey(url.pathname)
	if (publicAsset) {
		const object = await env.BLOBS.get(publicAsset.key)
		if (object) {
			return new Response(object.body, {
				headers: {
					'content-type': publicAsset.contentType,
					'cache-control': 'public, max-age=86400',
				},
			})
		}
	}

	if (env.ASSETS) {
		const asset = await env.ASSETS.fetch(request)
		if (asset.status !== 404) return asset
	}

	return json({ ok: false, error: 'Not found.' }, 404)
}

function publicAssetKey(pathname: string) {
	switch (pathname) {
		case '/icon.png':
			return { key: 'public/icon.png', contentType: 'image/png' }
		case '/favicon.png':
			return { key: 'public/favicon.png', contentType: 'image/png' }
		default:
			return null
	}
}

async function stripeWebhook(request: Request, env: AppEnv) {
	if (!stripeWebhookConfigured(env) || !env.STRIPE_WEBHOOK_SECRET) {
		return json({ ok: false, error: 'Webhook not configured.' }, 503)
	}
	const payload = await request.text()
	const valid = await verifyStripeSignature({
		payload,
		header: request.headers.get('stripe-signature'),
		secret: env.STRIPE_WEBHOOK_SECRET,
	})
	if (!valid) return json({ ok: false, error: 'Bad signature.' }, 400)
	const event = JSON.parse(payload) as Record<string, unknown>
	await handleStripeEvent(env, event)
	return json({ ok: true })
}
