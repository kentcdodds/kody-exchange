import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import * as Sentry from '@sentry/cloudflare'
import { handleRequest } from '#src/index.ts'
import { type AppEnv } from '#src/env.ts'
import { applySecurityHeaders, httpsRedirect } from '#src/https.ts'
import {
	handleMcp,
	isMcpBrowserNavigation,
	mcpOriginRejection,
} from '#src/mcp.ts'
import {
	getDurableObjectSentryOptions,
	getSentryOptions,
} from '#src/sentry-options.ts'
import { ThreadRoom as ThreadRoomBase } from '#src/thread-room.ts'
import {
	isProtectedResourceMetadataPath,
	oauthPaths,
	oauthScopes,
} from '#src/oauth-paths.ts'
import {
	handleProtectedResourceMetadata,
	type OAuthGrantProps,
	userFromGrantProps,
} from '#src/oauth-user.ts'
import { purgeExpired } from '#src/threads.ts'
import { handleUserApi } from '#src/user-api.ts'

async function userFromApiContext(env: AppEnv, ctx: ExecutionContext) {
	if (env.OAUTH_USER) return env.OAUTH_USER
	return userFromGrantProps(env, ctx.props as OAuthGrantProps | undefined)
}

function unknownUserResponse() {
	return Response.json(
		{ ok: false, error: 'Unknown user.', code: 'invalid_token' },
		{ status: 401 },
	)
}

const apiHandler = {
	async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
		const user = await userFromApiContext(env, ctx)
		if (!user) return unknownUserResponse()
		return handleUserApi(request, env, user, ctx)
	},
}

const mcpHandler = {
	async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
		const user = await userFromApiContext(env, ctx)
		if (!user) return unknownUserResponse()
		const response = await handleMcp(request, env, user, ctx)
		return (
			response ??
			Response.json({ ok: false, error: 'Not found.' }, { status: 404 })
		)
	},
}

const defaultHandler = {
	async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
		return handleRequest(request, env, ctx)
	},
}

const oauthProvider = new OAuthProvider({
	apiHandlers: {
		[oauthPaths.apiPrefix]: apiHandler,
		[oauthPaths.mcp]: mcpHandler,
	},
	defaultHandler,
	authorizeEndpoint: oauthPaths.authorize,
	tokenEndpoint: oauthPaths.token,
	clientRegistrationEndpoint: oauthPaths.register,
	scopesSupported: [...oauthScopes],
	clientIdMetadataDocumentEnabled: true,
	onError: () => undefined,
})

export const ThreadRoom = Sentry.instrumentDurableObjectWithSentry(
	(env: AppEnv) => getDurableObjectSentryOptions(env),
	// @sentry/cloudflare types DurableObject from `cloudflare:workers`;
	// this repo uses `@cloudflare/workers-types`, whose global DurableObject
	// is a different, non-generic interface.
	ThreadRoomBase as never,
)

const workerHandler = {
	fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
		const redirected = httpsRedirect(request)
		if (redirected) return redirected
		// OAuthProvider serves this URL first and defaults omitted `resource`
		// to the origin. MCP clients follow RFC 9728 from WWW-Authenticate and
		// must see `<origin>/mcp` on the root PRM. Authorize still mints a
		// shared product audience (origin, /api, /mcp) when the client omits
		// resource or sends the origin, so /api and /mcp both accept the token.
		// Browser GET /mcp is HTML help, not the protected MCP transport.
		const pathname = new URL(request.url).pathname
		if (isProtectedResourceMetadataPath(pathname)) {
			return applySecurityHeaders(
				request,
				handleProtectedResourceMetadata(request, env),
			)
		}
		if (pathname === oauthPaths.mcp && isMcpBrowserNavigation(request)) {
			return handleRequest(request, env, ctx).then((response) =>
				applySecurityHeaders(request, response),
			)
		}
		if (pathname === oauthPaths.mcp) {
			const originRejection = mcpOriginRejection(request)
			if (originRejection) {
				return applySecurityHeaders(request, originRejection)
			}
		}
		return oauthProvider
			.fetch(request, env, ctx)
			.then((response) => applySecurityHeaders(request, response))
	},
	async scheduled(_controller: ScheduledController, env: AppEnv) {
		await purgeExpired(env.DB)
	},
}

export default Sentry.withSentry(
	(env: AppEnv) => getSentryOptions(env),
	workerHandler as ExportedHandler<AppEnv>,
) as typeof workerHandler
