import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { ThreadRoom } from '#src/thread-room.ts'
import { handleRequest } from '#src/index.ts'
import { type AppEnv } from '#src/env.ts'
import { oauthPaths, oauthScopes } from '#src/oauth-paths.ts'
import { userFromGrantProps } from '#src/oauth-user.ts'
import { purgeExpired } from '#src/threads.ts'
import { handleUserApi } from '#src/user-api.ts'

const apiHandler = {
	async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
		const props = ctx.props as { userId?: string } | undefined
		const user = await userFromGrantProps(env, props)
		if (!user) {
			return Response.json(
				{ ok: false, error: 'Unknown user.', code: 'invalid_token' },
				{ status: 401 },
			)
		}
		return handleUserApi(request, env, user, ctx)
	},
}

const defaultHandler = {
	async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
		return handleRequest(request, env, ctx)
	},
}

const oauthProvider = new OAuthProvider({
	apiRoute: oauthPaths.apiPrefix,
	apiHandler,
	defaultHandler,
	authorizeEndpoint: oauthPaths.authorize,
	tokenEndpoint: oauthPaths.token,
	clientRegistrationEndpoint: oauthPaths.register,
	scopesSupported: [...oauthScopes],
	clientIdMetadataDocumentEnabled: true,
	onError: () => undefined,
})

export { ThreadRoom }

export default {
	fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
		return oauthProvider.fetch(request, env, ctx)
	},
	async scheduled(_event: ScheduledEvent, env: AppEnv) {
		await purgeExpired(env.DB)
	},
}
