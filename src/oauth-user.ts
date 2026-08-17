import { json } from '#src/api.ts'
import { first } from '#src/db.ts'
import { type AppEnv, appBaseUrl } from '#src/env.ts'
import { freeAccountUpsell } from '#src/free-account.ts'
import {
	apiResourcePath,
	mcpResourcePath,
	oauthScopes,
	protectedResourceMetadataPath,
} from '#src/oauth-paths.ts'
import { type UserRow } from '#src/threads.ts'

export type OAuthGrantProps = {
	userId?: string
	email?: string
	username?: string
	displayName?: string
}

export type OAuthHelpers = {
	parseAuthRequest: (request: Request) => Promise<OAuthAuthRequest>
	lookupClient: (clientId: string) => Promise<OAuthClientInfo | null>
	completeAuthorization: (input: {
		request: OAuthAuthRequest
		userId: string
		scope: Array<string>
		metadata: Record<string, unknown>
		props: OAuthGrantProps
	}) => Promise<{ redirectTo: string }>
	unwrapToken: (token: string) => Promise<OAuthTokenSummary | null>
}

export type OAuthAuthRequest = {
	responseType: string
	clientId: string
	redirectUri: string
	scope: Array<string>
	state?: string
	codeChallenge?: string
	codeChallengeMethod?: string
	resource?: string | Array<string>
}

export type OAuthClientInfo = {
	clientId: string
	clientName?: string
	redirectUris?: Array<string>
}

export type OAuthTokenSummary = {
	audience?: string | Array<string>
	grant: {
		userId?: string
		props?: OAuthGrantProps | null
	}
}

export function buildProtectedResourceMetadata(origin: string) {
	return {
		resource: `${origin}${mcpResourcePath}`,
		authorization_servers: [origin],
		scopes_supported: [...oauthScopes],
		bearer_methods_supported: ['header'],
	}
}

export function handleProtectedResourceMetadata(request: Request, env: AppEnv) {
	const origin = appBaseUrl(env, request)
	return json(buildProtectedResourceMetadata(origin))
}

export function unauthorizedOAuthResponse(origin: string) {
	const resourceMetadata = `${origin}${protectedResourceMetadataPath}`
	const scope = ` scope="${oauthScopes.join(' ')}"`
	return json(
		{
			ok: false,
			error:
				'Sign in with GitHub for a free account, then connect OAuth to use /api and /mcp.',
			code: 'invalid_token',
			...freeAccountUpsell(origin),
		},
		401,
		{
			'www-authenticate': `Bearer resource_metadata="${resourceMetadata}"${scope}`,
		},
	)
}

export function defaultMcpResource(origin: string) {
	return `${origin}${mcpResourcePath}`
}

export function canonicalizeAudience(value: string) {
	return value.replace(/\/+$/, '')
}

export function sharedProductResources(origin: string) {
	const base = canonicalizeAudience(origin)
	return [base, `${base}${apiResourcePath}`, `${base}${mcpResourcePath}`]
}

function resourceValues(resource: string | Array<string> | undefined) {
	if (resource === undefined) return []
	return typeof resource === 'string' ? [resource] : resource
}

export function isSharedProductResource(
	resource: string | Array<string> | undefined,
	origin: string,
) {
	if (resource === undefined) return true
	const values = resourceValues(resource)
	return (
		values.length === 1 &&
		canonicalizeAudience(values[0] ?? '') === canonicalizeAudience(origin)
	)
}

export function resolveAuthorizationResource(
	resource: string | Array<string> | undefined,
	origin: string,
) {
	if (isSharedProductResource(resource, origin)) {
		return sharedProductResources(origin)
	}
	return resource
}

export function audienceMatches(
	audience: string | Array<string> | undefined,
	origin: string,
) {
	if (audience === undefined) return true
	const base = canonicalizeAudience(origin)
	const allowed = new Set([
		base,
		`${base}${mcpResourcePath}`,
		`${base}${apiResourcePath}`,
	])
	const values = typeof audience === 'string' ? [audience] : audience
	return values.some((value) => allowed.has(canonicalizeAudience(value)))
}

export async function userFromGrantProps(
	env: AppEnv,
	props: OAuthGrantProps | null | undefined,
) {
	const userId = props?.userId
	if (!userId) return null
	return first<UserRow>(env.DB, 'SELECT * FROM users WHERE id = ?', userId)
}

function bearer(request: Request) {
	const header = request.headers.get('authorization')
	if (!header?.startsWith('Bearer ')) return null
	const token = header.slice('Bearer '.length).trim()
	return token.length > 0 ? token : null
}

export async function resolveOAuthUser(request: Request, env: AppEnv) {
	if (env.OAUTH_USER) return env.OAUTH_USER
	const token = bearer(request)
	const helpers = env.OAUTH_PROVIDER
	if (!token || !helpers) return null
	const summary = await helpers.unwrapToken(token)
	if (!summary) return null
	const origin = appBaseUrl(env, request)
	if (!audienceMatches(summary.audience, origin)) return null
	return userFromGrantProps(env, summary.grant.props)
}
