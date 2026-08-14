import { first, run } from '#src/db.ts'
import { type AppEnv, appBaseUrl } from '#src/env.ts'
import { type UserRow } from '#src/threads.ts'

export function stripeSecretConfigured(env: AppEnv) {
	return Boolean(env.STRIPE_SECRET_KEY?.trim())
}

export function stripeWebhookConfigured(env: AppEnv) {
	return Boolean(env.STRIPE_WEBHOOK_SECRET?.trim())
}

export function paymentLinkUrl(env: AppEnv, user: UserRow) {
	const base = env.STRIPE_PAYMENT_LINK_URL?.trim()
	if (!base) return null
	const url = new URL(base)
	url.searchParams.set('client_reference_id', user.id)
	if (user.email) url.searchParams.set('prefilled_email', user.email)
	return url.toString()
}

async function stripeForm(
	env: AppEnv,
	path: string,
	params: Record<string, string>,
) {
	const key = env.STRIPE_SECRET_KEY?.trim()
	if (!key) throw new Error('stripe_not_configured')
	const body = new URLSearchParams(params)
	const response = await fetch(`https://api.stripe.com/v1/${path}`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${key}`,
			'content-type': 'application/x-www-form-urlencoded',
		},
		body,
	})
	const json = (await response.json()) as Record<string, unknown>
	if (!response.ok) {
		const error = json.error as { message?: string } | undefined
		throw new Error(error?.message ?? 'Stripe request failed.')
	}
	return json
}

export async function createCheckout(input: {
	env: AppEnv
	request: Request
	user: UserRow
}) {
	if (input.user.plan === 'max') return null
	const priceId = input.env.STRIPE_PRO_PRICE_ID?.trim()
	if (!stripeSecretConfigured(input.env) || !priceId) return null
	const session = await stripeForm(input.env, 'checkout/sessions', {
		mode: 'subscription',
		success_url: `${appBaseUrl(input.env, input.request)}/account?upgraded=1`,
		cancel_url: `${appBaseUrl(input.env, input.request)}/pricing`,
		client_reference_id: input.user.id,
		'line_items[0][price]': priceId,
		'line_items[0][quantity]': '1',
		'metadata[user_id]': input.user.id,
		'subscription_data[metadata][user_id]': input.user.id,
		...(input.user.email ? { customer_email: input.user.email } : {}),
		...(input.user.stripe_customer_id
			? { customer: input.user.stripe_customer_id }
			: {}),
	})
	return typeof session.url === 'string' ? session.url : null
}

export async function createPortal(input: {
	env: AppEnv
	request: Request
	user: UserRow
}) {
	if (!stripeSecretConfigured(input.env) || !input.user.stripe_customer_id) {
		return null
	}
	const session = await stripeForm(input.env, 'billing_portal/sessions', {
		customer: input.user.stripe_customer_id,
		return_url: `${appBaseUrl(input.env, input.request)}/account`,
	})
	return typeof session.url === 'string' ? session.url : null
}

async function hmacSha256Hex(secret: string, payload: string) {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const signature = await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(payload),
	)
	return Array.from(new Uint8Array(signature), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('')
}

export async function verifyStripeSignature(input: {
	payload: string
	header: string | null
	secret: string
	now?: number
}) {
	if (!input.header) return false
	const parts = Object.fromEntries(
		input.header.split(',').map((part) => {
			const [key, ...rest] = part.split('=')
			return [key, rest.join('=')]
		}),
	)
	const timestamp = parts.t
	const signature = parts.v1
	if (!timestamp || !signature) return false
	const now = input.now ?? Math.floor(Date.now() / 1000)
	if (Math.abs(now - Number(timestamp)) > 300) return false
	const expected = await hmacSha256Hex(
		input.secret,
		`${timestamp}.${input.payload}`,
	)
	if (expected.length !== signature.length) return false
	let diff = 0
	for (let index = 0; index < expected.length; index += 1) {
		diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index)
	}
	return diff === 0
}

async function setPlanFromStripe(input: {
	db: D1Database
	userId?: string | null
	customerId?: string | null
	subscriptionId?: string | null
	plan: 'free' | 'pro'
}) {
	if (input.userId) {
		await run(
			input.db,
			`UPDATE users SET plan = ?, stripe_customer_id = COALESCE(?, stripe_customer_id),
			 stripe_subscription_id = ? WHERE id = ? AND plan != 'max'`,
			input.plan,
			input.customerId ?? null,
			input.subscriptionId ?? null,
			input.userId,
		)
		return
	}
	if (input.customerId) {
		await run(
			input.db,
			`UPDATE users SET plan = ?, stripe_subscription_id = ? WHERE stripe_customer_id = ? AND plan != 'max'`,
			input.plan,
			input.subscriptionId ?? null,
			input.customerId,
		)
	}
}

export async function handleStripeEvent(
	env: AppEnv,
	event: Record<string, unknown>,
) {
	const type = event.type
	const object = (
		event.data as { object?: Record<string, unknown> } | undefined
	)?.object
	if (!object) return

	if (type === 'checkout.session.completed') {
		const userId =
			(typeof object.client_reference_id === 'string' &&
				object.client_reference_id) ||
			((object.metadata as { user_id?: string } | undefined)?.user_id ?? null)
		const customerId =
			typeof object.customer === 'string' ? object.customer : null
		const subscriptionId =
			typeof object.subscription === 'string' ? object.subscription : null
		if (userId && customerId) {
			const existing = await first<{ id: string }>(
				env.DB,
				'SELECT id FROM users WHERE id = ?',
				userId,
			)
			if (existing) {
				await setPlanFromStripe({
					db: env.DB,
					userId,
					customerId,
					subscriptionId,
					plan: 'pro',
				})
			}
		}
		return
	}

	if (
		type === 'customer.subscription.updated' ||
		type === 'customer.subscription.created'
	) {
		const status = object.status
		const customerId =
			typeof object.customer === 'string' ? object.customer : null
		const subscriptionId = typeof object.id === 'string' ? object.id : null
		const userId =
			(object.metadata as { user_id?: string } | undefined)?.user_id ?? null
		const active = status === 'active' || status === 'trialing'
		await setPlanFromStripe({
			db: env.DB,
			userId,
			customerId,
			subscriptionId,
			plan: active ? 'pro' : 'free',
		})
		return
	}

	if (type === 'customer.subscription.deleted') {
		const customerId =
			typeof object.customer === 'string' ? object.customer : null
		const userId =
			(object.metadata as { user_id?: string } | undefined)?.user_id ?? null
		await setPlanFromStripe({
			db: env.DB,
			userId,
			customerId,
			subscriptionId: null,
			plan: 'free',
		})
	}
}
