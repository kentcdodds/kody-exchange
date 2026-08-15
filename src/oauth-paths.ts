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

export function isProtectedResourceMetadataRequest(pathname: string) {
	return (
		pathname === protectedResourceMetadataPath ||
		pathname === `${protectedResourceMetadataPath}${mcpResourcePath}`
	)
}
