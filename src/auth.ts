import { hmacSha256Hex, signPayload, verifyPayload } from '#src/crypto.ts'
import { first, run } from '#src/db.ts'
import { type AppEnv, appBaseUrl } from '#src/env.ts'
import { createId } from '#src/ids.ts'
import { isPlanName, type PlanName } from '#src/limits.ts'
import { type UserRow } from '#src/threads.ts'

const sessionCookie = 'kx_session'
const oauthStateCookie = 'kx_oauth'
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000

export function githubOAuthConfigured(env: AppEnv) {
	return Boolean(
		env.GITHUB_CLIENT_ID?.trim() && env.GITHUB_CLIENT_SECRET?.trim(),
	)
}

export function cookieSecret(env: AppEnv) {
	return env.COOKIE_SECRET?.trim() || null
}

function cookie(name: string, value: string, maxAgeSeconds: number) {
	return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

function clearCookie(name: string) {
	return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export function readCookie(request: Request, name: string) {
	const header = request.headers.get('cookie')
	if (!header) return null
	for (const part of header.split(';')) {
		const [rawName, ...rest] = part.trim().split('=')
		if (rawName === name) return rest.join('=')
	}
	return null
}

export async function readSessionUser(request: Request, env: AppEnv) {
	const secret = cookieSecret(env)
	if (!secret) return null
	const token = readCookie(request, sessionCookie)
	if (!token) return null
	const payload = await verifyPayload(secret, token)
	if (!payload) return null
	let parsed: { userId?: string; exp?: number }
	try {
		parsed = JSON.parse(payload) as { userId?: string; exp?: number }
	} catch {
		return null
	}
	if (!parsed.userId || !parsed.exp || parsed.exp < Date.now()) return null
	const user = await first<UserRow>(
		env.DB,
		'SELECT * FROM users WHERE id = ?',
		parsed.userId,
	)
	if (!user) return null
	return {
		...user,
		plan: (isPlanName(user.plan) && user.plan !== 'guest'
			? user.plan
			: 'free') as 'free' | 'pro',
	}
}

export async function startGithubOAuth(request: Request, env: AppEnv) {
	if (!githubOAuthConfigured(env) || !env.GITHUB_CLIENT_ID) {
		return new Response('GitHub sign-in is not configured yet.', {
			status: 503,
		})
	}
	const secret = cookieSecret(env)
	if (!secret) {
		return new Response('COOKIE_SECRET is not configured.', { status: 503 })
	}
	const state = crypto.randomUUID()
	const signed = await signPayload(secret, JSON.stringify({ state }))
	const url = new URL('https://github.com/login/oauth/authorize')
	url.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
	url.searchParams.set(
		'redirect_uri',
		`${appBaseUrl(env, request)}/auth/callback/github`,
	)
	url.searchParams.set('scope', 'read:user user:email')
	url.searchParams.set('state', state)
	return new Response(null, {
		status: 302,
		headers: {
			location: url.toString(),
			'set-cookie': cookie(oauthStateCookie, signed, 600),
		},
	})
}

export async function finishGithubOAuth(request: Request, env: AppEnv) {
	if (
		!githubOAuthConfigured(env) ||
		!env.GITHUB_CLIENT_ID ||
		!env.GITHUB_CLIENT_SECRET
	) {
		return new Response('GitHub sign-in is not configured yet.', {
			status: 503,
		})
	}
	const secret = cookieSecret(env)
	if (!secret) {
		return new Response('COOKIE_SECRET is not configured.', { status: 503 })
	}

	const url = new URL(request.url)
	const code = url.searchParams.get('code')
	const state = url.searchParams.get('state')
	const signedState = readCookie(request, oauthStateCookie)
	if (!code || !state || !signedState) {
		return new Response('Missing OAuth state.', { status: 400 })
	}
	const payload = await verifyPayload(secret, signedState)
	if (!payload) return new Response('Invalid OAuth state.', { status: 400 })
	const parsed = JSON.parse(payload) as { state?: string }
	if (parsed.state !== state) {
		return new Response('OAuth state mismatch.', { status: 400 })
	}

	const tokenResponse = await fetch(
		'https://github.com/login/oauth/access_token',
		{
			method: 'POST',
			headers: {
				accept: 'application/json',
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				client_id: env.GITHUB_CLIENT_ID,
				client_secret: env.GITHUB_CLIENT_SECRET,
				code,
				redirect_uri: `${appBaseUrl(env, request)}/auth/callback/github`,
			}),
		},
	)
	const tokenJson = (await tokenResponse.json()) as {
		access_token?: string
		error?: string
	}
	if (!tokenJson.access_token) {
		return new Response('GitHub token exchange failed.', { status: 502 })
	}

	const profileResponse = await fetch('https://api.github.com/user', {
		headers: {
			authorization: `Bearer ${tokenJson.access_token}`,
			accept: 'application/vnd.github+json',
			'user-agent': 'kody.exchange',
		},
	})
	const profile = (await profileResponse.json()) as {
		id?: number
		login?: string
		name?: string | null
		avatar_url?: string | null
		email?: string | null
	}
	if (!profile.id || !profile.login) {
		return new Response('GitHub profile was incomplete.', { status: 502 })
	}

	let email = profile.email ?? null
	if (!email) {
		const emailsResponse = await fetch('https://api.github.com/user/emails', {
			headers: {
				authorization: `Bearer ${tokenJson.access_token}`,
				accept: 'application/vnd.github+json',
				'user-agent': 'kody.exchange',
			},
		})
		if (emailsResponse.ok) {
			const emails = (await emailsResponse.json()) as Array<{
				email?: string
				primary?: boolean
				verified?: boolean
			}>
			email =
				emails.find((item) => item.primary && item.verified)?.email ??
				emails.find((item) => item.verified)?.email ??
				null
		}
	}

	const now = Date.now()
	const existing = await first<UserRow>(
		env.DB,
		'SELECT * FROM users WHERE github_id = ?',
		String(profile.id),
	)
	const userId = existing?.id ?? createId('usr')
	if (existing) {
		await run(
			env.DB,
			`UPDATE users SET login = ?, name = ?, avatar_url = ?, email = ? WHERE id = ?`,
			profile.login,
			profile.name ?? existing.name,
			profile.avatar_url ?? existing.avatar_url,
			email ?? existing.email,
			existing.id,
		)
	} else {
		await run(
			env.DB,
			`INSERT INTO users (id, github_id, login, name, avatar_url, email, plan, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'free', ?)`,
			userId,
			String(profile.id),
			profile.login,
			profile.name ?? null,
			profile.avatar_url ?? null,
			email,
			now,
		)
	}

	const session = await signPayload(
		secret,
		JSON.stringify({ userId, exp: now + sessionTtlMs }),
	)
	const headers = new Headers({
		location: '/account',
		'set-cookie': cookie(sessionCookie, session, sessionTtlMs / 1000),
	})
	headers.append('set-cookie', clearCookie(oauthStateCookie))
	return new Response(null, { status: 302, headers })
}

export function logoutResponse() {
	return new Response(null, {
		status: 302,
		headers: {
			location: '/',
			'set-cookie': clearCookie(sessionCookie),
		},
	})
}

export async function csrfToken(secret: string, userId: string) {
	return hmacSha256Hex(secret, `csrf:${userId}`)
}

export function planOf(user: UserRow): Exclude<PlanName, 'guest'> {
	return user.plan === 'pro' ? 'pro' : 'free'
}
