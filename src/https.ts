const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isLocalHostname(hostname: string) {
	const host = hostname.toLowerCase()
	return localHosts.has(host) || host.endsWith('.localhost')
}

export function httpsRedirect(request: Request): Response | null {
	const url = new URL(request.url)
	if (isLocalHostname(url.hostname)) return null
	if (url.protocol !== 'http:') return null
	url.protocol = 'https:'
	if (url.port === '80') url.port = ''
	return Response.redirect(url.href, 301)
}

export function applySecurityHeaders(request: Request, response: Response) {
	if (response.status === 101) return response
	const url = new URL(request.url)
	if (isLocalHostname(url.hostname) || url.protocol !== 'https:') {
		return response
	}
	const headers = new Headers(response.headers)
	if (!headers.has('strict-transport-security')) {
		headers.set(
			'strict-transport-security',
			'max-age=31536000; includeSubDomains; preload',
		)
	}
	if (!headers.has('x-content-type-options')) {
		headers.set('x-content-type-options', 'nosniff')
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}
