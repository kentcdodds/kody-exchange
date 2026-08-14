import { expect, test } from 'vitest'
import { handleStripeEvent, verifyStripeSignature } from '#src/billing.ts'
import { createTestEnv } from '#src/test-support.ts'
import { first, run } from '#src/db.ts'

test('stripe signature accepts a matching v1 HMAC', async () => {
	const payload = '{"ok":true}'
	const secret = 'whsec_test'
	const timestamp = '1710000000'
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
		new TextEncoder().encode(`${timestamp}.${payload}`),
	)
	const hex = Array.from(new Uint8Array(signature), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('')
	const header = `t=${timestamp},v1=${hex}`
	expect(
		await verifyStripeSignature({
			payload,
			header,
			secret,
			now: 1710000000,
		}),
	).toBe(true)
	expect(
		await verifyStripeSignature({
			payload,
			header: `t=${timestamp},v1=nope`,
			secret,
			now: 1710000000,
		}),
	).toBe(false)
})

test('checkout.session.completed promotes the referenced user to pro', async () => {
	const env = createTestEnv()
	await run(
		env.DB,
		`INSERT INTO users (id, github_id, login, name, avatar_url, email, plan, created_at)
		 VALUES ('usr_1', '1', 'kent', 'Kent', null, null, 'free', 1)`,
	)
	await handleStripeEvent(env, {
		type: 'checkout.session.completed',
		data: {
			object: {
				client_reference_id: 'usr_1',
				customer: 'cus_1',
				subscription: 'sub_1',
			},
		},
	})
	const user = await first<{ plan: string; stripe_customer_id: string }>(
		env.DB,
		'SELECT plan, stripe_customer_id FROM users WHERE id = ?',
		'usr_1',
	)
	expect(user).toEqual({ plan: 'pro', stripe_customer_id: 'cus_1' })
})
