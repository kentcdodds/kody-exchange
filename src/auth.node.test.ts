import * as Sentry from '@sentry/cloudflare'
import { expect, test, vi } from 'vitest'
import {
	githubTokenExchangeSentryExtra,
	githubTokenExchangeUserMessage,
	shouldRetryGithubTokenExchange,
} from '#src/auth.ts'
import { first } from '#src/db.ts'
import { handleRequest } from '#src/index.ts'
import { createTestEnv, firstSetCookie, request } from '#src/test-support.ts'
import { type UserRow } from '#src/threads.ts'

const clientSecret = 'super-secret-github-client'
const oauthCode = 'oauth-used-code-xyz'
const leakedAccessToken = 'gho_should_never_appear'

function oauthEnv() {
	return createTestEnv({
		GITHUB_CLIENT_ID: 'Iv1.testclient',
		GITHUB_CLIENT_SECRET: clientSecret,
	})
}

async function startGithubSignIn() {
	const env = oauthEnv()
	const started = await handleRequest(request('/auth/github'), env)
	const location = started.headers.get('location')
	expect(location).toBeTruthy()
	const authorize = new URL(location ?? '')
	const state = authorize.searchParams.get('state')
	const cookie = firstSetCookie(started)
	expect(state).toBeTruthy()
	expect(cookie).toBeTruthy()
	return { env, state: state ?? '', cookie: cookie ?? '' }
}

function callbackRequest(state: string, cookie: string, code = oauthCode) {
	const iss = encodeURIComponent('https://github.com/login/oauth')
	return request(
		`/auth/callback/github?code=${code}&state=${state}&iss=${iss}`,
		{
			headers: { cookie },
		},
	)
}

async function withMockedFetch<T>(
	impl: typeof fetch,
	run: () => Promise<T>,
): Promise<T> {
	const originalFetch = globalThis.fetch
	globalThis.fetch = impl
	try {
		return await run()
	} finally {
		globalThis.fetch = originalFetch
	}
}

test('token exchange with a known GitHub error shows safe copy and a retry link', async () => {
	const { env, state, cookie } = await startGithubSignIn()
	let tokenPosts = 0
	const captured: Array<{ extra?: unknown }> = []
	const spy = vi
		.spyOn(Sentry, 'captureException')
		.mockImplementation((_error, hint) => {
			captured.push({ extra: hint?.extra })
			return ''
		})

	const response = await withMockedFetch(
		async (input) => {
			const url = String(input)
			if (url === 'https://github.com/login/oauth/access_token') {
				tokenPosts += 1
				return Response.json({
					error: 'bad_verification_code',
					error_description: 'The code passed is incorrect or expired.',
				})
			}
			throw new Error(`unexpected fetch ${url}`)
		},
		() => handleRequest(callbackRequest(state, cookie), env),
	)

	spy.mockRestore()

	expect(tokenPosts).toBe(1)
	expect(response.status).toBe(502)
	expect(response.headers.get('content-type')).toContain('text/html')
	const html = await response.text()
	expect(html).toContain('<!doctype html>')
	expect(html).toContain('Could not sign in with GitHub')
	expect(html).toContain(
		githubTokenExchangeUserMessage('bad_verification_code'),
	)
	expect(html).toContain('href="/auth/github"')
	expect(html).toContain('Try signing in again')
	expect(html).not.toContain('GitHub token exchange failed.')
	expect(html).not.toContain(clientSecret)
	expect(html).not.toContain(oauthCode)
	expect(html).not.toContain(leakedAccessToken)
	expect(html).not.toContain('The code passed is incorrect or expired.')
	expect(html).not.toContain('Iv1.testclient')

	expect(captured).toHaveLength(1)
	expect(captured[0]?.extra).toEqual({
		github_error: 'bad_verification_code',
		github_error_description: 'The code passed is incorrect or expired.',
		http_status: 200,
		body_kind: 'json',
	})
	const reported = JSON.stringify(captured)
	expect(reported).not.toContain(clientSecret)
	expect(reported).not.toContain(oauthCode)
	expect(reported).not.toContain(leakedAccessToken)
})

test('token exchange Sentry extras never include the code, secret, or access token', () => {
	const extra = githubTokenExchangeSentryExtra({
		httpStatus: 401,
		bodyKind: 'json',
		error: 'incorrect_client_credentials',
		errorDescription:
			'The client_id and/or client_secret passed are incorrect.',
	})
	const serialized = JSON.stringify(extra)
	expect(extra.github_error).toBe('incorrect_client_credentials')
	expect(serialized).not.toContain(clientSecret)
	expect(serialized).not.toContain(oauthCode)
	expect(serialized).not.toContain('access_token')
	expect(serialized).not.toContain(leakedAccessToken)
})

test('does not retry clear GitHub client errors', () => {
	expect(
		shouldRetryGithubTokenExchange({
			httpStatus: 200,
			bodyKind: 'json',
			error: 'bad_verification_code',
		}),
	).toBe(false)
	expect(
		shouldRetryGithubTokenExchange({
			httpStatus: 401,
			bodyKind: 'json',
			error: 'incorrect_client_credentials',
		}),
	).toBe(false)
	expect(
		shouldRetryGithubTokenExchange({
			httpStatus: 200,
			bodyKind: 'json',
			error: 'redirect_uri_mismatch',
		}),
	).toBe(false)
	expect(
		shouldRetryGithubTokenExchange({
			httpStatus: 503,
			bodyKind: 'empty',
		}),
	).toBe(true)
	expect(
		shouldRetryGithubTokenExchange({
			httpStatus: null,
			bodyKind: 'network',
		}),
	).toBe(true)
	expect(
		shouldRetryGithubTokenExchange({
			httpStatus: 502,
			bodyKind: 'non-json',
		}),
	).toBe(true)
})

test('retries a transient empty token response once, then shows the generic page', async () => {
	const { env, state, cookie } = await startGithubSignIn()
	let tokenPosts = 0

	const response = await withMockedFetch(
		async (input) => {
			const url = String(input)
			if (url === 'https://github.com/login/oauth/access_token') {
				tokenPosts += 1
				return new Response('', { status: 503 })
			}
			throw new Error(`unexpected fetch ${url}`)
		},
		() => handleRequest(callbackRequest(state, cookie), env),
	)

	expect(tokenPosts).toBe(2)
	const html = await response.text()
	expect(html).toContain(githubTokenExchangeUserMessage(undefined))
	expect(html).toContain('href="/auth/github"')
	expect(html).not.toContain(clientSecret)
	expect(html).not.toContain(oauthCode)
})

test('retries a network throw once and can still complete sign-in', async () => {
	const { env, state, cookie } = await startGithubSignIn()
	let tokenPosts = 0

	const signedIn = await withMockedFetch(
		async (input) => {
			const url = String(input)
			if (url === 'https://github.com/login/oauth/access_token') {
				tokenPosts += 1
				if (tokenPosts === 1) throw new TypeError('fetch failed')
				return Response.json({ access_token: 'gho_ok' })
			}
			if (url === 'https://api.github.com/user') {
				return Response.json({
					id: 4242,
					login: 'noah',
					name: 'Noah',
					avatar_url: null,
					email: 'noah@example.com',
				})
			}
			throw new Error(`unexpected fetch ${url}`)
		},
		() => handleRequest(callbackRequest(state, cookie), env),
	)

	expect(tokenPosts).toBe(2)
	expect(signedIn.status).toBe(302)
	expect(signedIn.headers.get('location')).toBe('/account')
	const user = await first<UserRow>(
		env.DB,
		'SELECT * FROM users WHERE login = ?',
		'noah',
	)
	expect(user?.github_id).toBe('4242')
})
