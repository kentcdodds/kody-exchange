import { type CloudflareOptions, type ErrorEvent } from '@sentry/cloudflare'
import { type AppEnv } from '#src/env.ts'

function sentryEventMessages(event: ErrorEvent) {
	return [
		event.message,
		...(event.exception?.values?.map((value) => value.value) ?? []),
	]
}

function withoutErrorPrefix(message: string) {
	return message.trim().replace(/^Error:\s*/i, '')
}

/**
 * Transient D1 / SQLite platform unavailability. Call sites retry; these
 * should not open or regress Sentry issues.
 */
/** D1 analogue of durableObjectStorageOperationTimeoutResetMessage. */
export const d1StorageOperationTimeoutResetMessage =
	'D1 DB storage operation exceeded timeout which caused object to be reset.'

export function isRetryableD1PlatformMessage(message: string) {
	const normalized = withoutErrorPrefix(message)
	if (normalized.includes('SQLITE_BUSY')) return true
	if (
		normalized.includes('D1 DB is overloaded. Requests queued for too long')
	) {
		return true
	}
	if (normalized.includes('Currently processing a long-running export')) {
		return true
	}
	if (normalized === 'Network connection lost') return true
	// Cloudflare may wrap this as `D1_ERROR: …`.
	if (normalized.includes(d1StorageOperationTimeoutResetMessage)) return true
	return /^internal error in D1 DB storage caused object to be reset;\s*reference\s*=\s*[A-Za-z0-9]+$/i.test(
		normalized,
	)
}

export function isRetryableD1PlatformSentryEvent(event: ErrorEvent) {
	return sentryEventMessages(event).some(
		(message) =>
			typeof message === 'string' && isRetryableD1PlatformMessage(message),
	)
}

export function filterRetryableD1PlatformSentryEvent(event: ErrorEvent) {
	if (!isRetryableD1PlatformSentryEvent(event)) return event
	return null
}

export const durableObjectIsolateMemoryResetMessage =
	"Durable Object's isolate exceeded its memory limit and was reset."

export const durableObjectIsolateCpuResetMessage =
	'Durable Object exceeded its CPU time limit and was reset.'

export const durableObjectCodeUpdatedResetMessage =
	'Durable Object reset because its code was updated.'

export const durableObjectBlockConcurrencyWhileTimeoutResetMessage =
	'A call to blockConcurrencyWhile() in a Durable Object waited for too long. The call was canceled and the Durable Object was reset.'

export const durableObjectStorageOperationTimeoutResetMessage =
	'Durable Object storage operation exceeded timeout which caused object to be reset.'

const durableObjectStorageObjectResetPattern =
	/^internal error in Durable Object storage caused object to be reset;\s*reference\s*=\s*[A-Za-z0-9]+$/i

function normalizeDurableObjectResetMessage(message: string) {
	const withoutPrefix = withoutErrorPrefix(message)
	return withoutPrefix.endsWith('.') ? withoutPrefix : `${withoutPrefix}.`
}

export function isDurableObjectIsolateResetMessage(message: string) {
	const normalized = normalizeDurableObjectResetMessage(message)
	return (
		normalized === durableObjectIsolateMemoryResetMessage ||
		normalized === durableObjectIsolateCpuResetMessage ||
		normalized === durableObjectCodeUpdatedResetMessage ||
		normalized === durableObjectBlockConcurrencyWhileTimeoutResetMessage ||
		normalized === durableObjectStorageOperationTimeoutResetMessage ||
		durableObjectStorageObjectResetPattern.test(withoutErrorPrefix(message))
	)
}

export function isDurableObjectIsolateResetSentryEvent(event: ErrorEvent) {
	const messages = sentryEventMessages(event).filter(
		(message): message is string =>
			typeof message === 'string' && message.trim().length > 0,
	)
	return (
		messages.length > 0 &&
		messages.every((message) => isDurableObjectIsolateResetMessage(message))
	)
}

export function filterDurableObjectIsolateResetSentryEvent(event: ErrorEvent) {
	if (!isDurableObjectIsolateResetSentryEvent(event)) return event
	return null
}

export function filterSentryEvent(event: ErrorEvent) {
	if (filterRetryableD1PlatformSentryEvent(event) === null) return null
	if (filterDurableObjectIsolateResetSentryEvent(event) === null) return null
	return event
}

export function buildSentryOptions(env: AppEnv): CloudflareOptions {
	const dsn = env.SENTRY_DSN?.trim()
	const environment = env.SENTRY_ENVIRONMENT?.trim() || 'development'
	const release = env.APP_COMMIT_SHA?.trim()
	const tracesSampleRate =
		typeof env.SENTRY_TRACES_SAMPLE_RATE === 'number'
			? env.SENTRY_TRACES_SAMPLE_RATE
			: 1.0

	return {
		...(dsn ? { dsn } : {}),
		environment,
		...(release ? { release } : {}),
		tracesSampleRate,
		sendDefaultPii: false,
		beforeSend: filterSentryEvent,
	}
}

/**
 * Skip Sentry when no DSN is configured, or when this is local wrangler
 * (`APP_COMMIT_SHA` stays `dev` in wrangler.jsonc; production deploy
 * overwrites it with the git SHA). Shared by the Worker wrapper and
 * ThreadRoom so a baked production DSN cannot report from `wrangler dev`.
 */
export function getSentryOptions(env: AppEnv): CloudflareOptions | undefined {
	const options = buildSentryOptions(env)
	if (!options.dsn) return undefined
	if (env.APP_COMMIT_SHA === 'dev') return undefined
	if (options.environment === 'development') return undefined
	return options
}

/** `instrumentDurableObjectWithSentry` requires an options object. */
export function getDurableObjectSentryOptions(env: AppEnv): CloudflareOptions {
	return getSentryOptions(env) ?? {}
}
