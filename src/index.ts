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
import { type AppEnv } from '#src/env.ts'
import { handleMcp } from '#src/mcp.ts'
import { handleAccountAction, renderPage } from '#src/pages.ts'
import { purgeExpired } from '#src/threads.ts'

export default {
	async fetch(request: Request, env: AppEnv): Promise<Response> {
		return handleRequest(request, env)
	},
	async scheduled(_event: ScheduledEvent, env: AppEnv) {
		await purgeExpired(env.DB)
	},
}

export async function handleRequest(request: Request, env: AppEnv) {
	const url = new URL(request.url)
	if (
		url.hostname === 'kody.email' &&
		request.method !== 'POST' &&
		url.pathname !== '/webhooks/stripe'
	) {
		const next = new URL(request.url)
		next.hostname = 'kody.exchange'
		return Response.redirect(next.toString(), 301)
	}

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
		return new Response('User-agent: *\nAllow: /\n', {
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		})
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

	const api = await handleApi(request, env)
	if (api) return api

	const mcp = await handleMcp(request, env)
	if (mcp) return mcp

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
		case '/og.jpg':
		case '/og.png':
			return { key: 'public/og.jpg', contentType: 'image/jpeg' }
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
