import { handleApi, json } from '#src/api.ts'
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
import { handleAccountAction, renderPage } from '#src/pages.ts'
import { handleUserApi } from '#src/user-api.ts'
import { purgeExpired } from '#src/threads.ts'

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
	const url = new URL(request.url)

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
		return new Response('User-agent: *\nAllow: /\nDisallow: /t/\n', {
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		})
	}

	if (url.pathname === '/og.png' || url.pathname === '/og.jpg') {
		// Lazy import (sanctioned exception to the no-inline-imports rule):
		// satori + resvg-wasm would otherwise sit in every isolate for a
		// route that only social crawlers hit.
		const { ogImageResponse } = await import('#src/og.ts')
		return ogImageResponse(env)
	}

	if (
		url.pathname === '/research/og.png' ||
		url.pathname === '/research/og.jpg'
	) {
		const { ogImageResponse } = await import('#src/og.ts')
		return ogImageResponse(env, 'research')
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
