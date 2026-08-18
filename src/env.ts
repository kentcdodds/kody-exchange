export type AppEnv = {
	DB: D1Database
	RATE_LIMIT: KVNamespace
	BLOBS: R2Bucket
	ASSETS?: Fetcher
	THREAD_ROOMS?: DurableObjectNamespace
	OAUTH_KV?: KVNamespace
	OAUTH_PROVIDER?: import('#src/oauth-user.ts').OAuthHelpers
	OAUTH_USER?: import('#src/threads.ts').UserRow
	COOKIE_SECRET?: string
	GITHUB_CLIENT_ID?: string
	GITHUB_CLIENT_SECRET?: string
	STRIPE_SECRET_KEY?: string
	STRIPE_WEBHOOK_SECRET?: string
	STRIPE_PRO_PRICE_ID?: string
	STRIPE_PAYMENT_LINK_URL?: string
	APP_BASE_URL: string
	APP_COMMIT_SHA: string
	SENTRY_DSN?: string
	SENTRY_ENVIRONMENT?: string
	SENTRY_TRACES_SAMPLE_RATE?: number
}

export function appBaseUrl(env: AppEnv, request: Request) {
	const configured = env.APP_BASE_URL?.trim()
	if (configured) return configured.replace(/\/$/, '')
	return new URL(request.url).origin
}
