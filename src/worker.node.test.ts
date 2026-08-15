import { expect, test } from 'vitest'
import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { oauthPaths, oauthScopes } from '#src/oauth-paths.ts'
import { createTestEnv, request } from '#src/test-support.ts'
import worker from '#src/worker.ts'

function executionContext(): ExecutionContext {
	return {
		waitUntil() {},
		passThroughOnException() {},
		props: {},
	} as unknown as ExecutionContext
}

test('worker fetch serves /mcp on the root PRM OAuthProvider would own', async () => {
	const env = createTestEnv()
	const ctx = executionContext()
	const provider = new OAuthProvider({
		apiRoute: oauthPaths.apiPrefix,
		apiHandler: {
			fetch() {
				return new Response('api')
			},
		},
		defaultHandler: {
			fetch() {
				return new Response('default')
			},
		},
		authorizeEndpoint: oauthPaths.authorize,
		tokenEndpoint: oauthPaths.token,
		clientRegistrationEndpoint: oauthPaths.register,
		scopesSupported: [...oauthScopes],
	})

	const throughProvider = await provider.fetch(
		request(oauthPaths.protectedResource),
		env,
		ctx,
	)
	const providerBody = (await throughProvider.json()) as { resource: string }
	expect(providerBody.resource).toBe('https://kody.exchange')

	const throughWorker = await worker.fetch(
		request(oauthPaths.protectedResource),
		env,
		ctx,
	)
	expect(throughWorker.status).toBe(200)
	const workerBody = (await throughWorker.json()) as { resource: string }
	expect(workerBody.resource).toBe('https://kody.exchange/mcp')

	const pathBased = await worker.fetch(
		request(`${oauthPaths.protectedResource}${oauthPaths.mcp}`),
		env,
		ctx,
	)
	const pathBody = (await pathBased.json()) as { resource: string }
	expect(pathBody.resource).toBe('https://kody.exchange/mcp')

	const apiPath = await worker.fetch(
		request(`${oauthPaths.protectedResource}/api`),
		env,
		ctx,
	)
	const apiBody = (await apiPath.json()) as { resource: string }
	expect(apiBody.resource).toBe('https://kody.exchange/api')
})
