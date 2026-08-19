export const oauthPaths = {
	authorize: '/oauth/authorize',
	token: '/oauth/token',
	register: '/oauth/register',
	discovery: '/.well-known/oauth-authorization-server',
	protectedResource: '/.well-known/oauth-protected-resource',
	apiPrefix: '/api/',
	mcp: '/mcp',
} as const

export const oauthScopes = ['profile', 'threads'] as const

export const mcpResourcePath = '/mcp'
export const apiResourcePath = '/api'
export const protectedResourceMetadataPath =
	'/.well-known/oauth-protected-resource'

export function isProtectedResourceMetadataPath(pathname: string) {
	// Root + /mcp only. Leave /api to OAuthProvider so that document still
	// advertises https://kody.exchange/api. Omitted or origin-only authorize
	// resources mint the shared product audience (origin, /api, /mcp) so
	// both apiHandlers accept the token; an explicit /mcp audience stays
	// MCP-scoped.
	return (
		pathname === protectedResourceMetadataPath ||
		pathname === `${protectedResourceMetadataPath}${mcpResourcePath}`
	)
}
