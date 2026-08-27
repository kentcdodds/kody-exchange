import { type CloudflareOptions, type ErrorEvent } from '@sentry/cloudflare'
import { type AppEnv } from '#src/env.ts'
import { isLocalHostname } from '#src/https.ts'

/** @sentry/cloudflare fills `dsn` from `env.SENTRY_DSN` when options omit it. */
const disabledSentryOptions: CloudflareOptions = {
	enabled: false,
	dsn: '',
	beforeSend: () => null,
}

function sentryEventUrl(event: ErrorEvent) {
	const requestUrl = event.request?.url
	if (typeof requestUrl === 'string' && requestUrl.trim()) return requestUrl
	const urlTag = event.tags?.url
	if (typeof urlTag === 'string' && urlTag.trim()) return urlTag
	return undefined
}

export function isLocalSentryEvent(event: ErrorEvent) {
	const url = sentryEventUrl(event)
	if (!url) return false
	try {
		return isLocalHostname(new URL(url).hostname)
	} catch {
		return false
	}
}

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
	// Cloudflare may wrap this as `D1_ERROR: …`, with or without a trailing `.`.
	const d1StorageTimeoutStem = d1StorageOperationTimeoutResetMessage.replace(
		/\.$/,
		'',
	)
	if (normalized.includes(d1StorageTimeoutStem)) return true
	// Cloudflare wraps platform blips as `D1_ERROR: …` (and sometimes `Error: D1_ERROR: …`).
	const withoutD1Prefix = normalized.replace(/^D1_ERROR:\s*/i, '')
	// Bare `internal error; reference = …` and the longer storage-reset form.
	return /^internal error(?: in D1 DB storage caused object to be reset)?;\s*reference\s*=\s*[A-Za-z0-9]+$/i.test(
		withoutD1Prefix,
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
	if (isLocalSentryEvent(event)) return null
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

export function isLocalSentryRuntime(env: AppEnv) {
	const sha = env.APP_COMMIT_SHA?.trim()
	if (!sha || sha === 'dev') return true
	return (env.SENTRY_ENVIRONMENT?.trim() || 'development') === 'development'
}

/**
 * Shared by the Worker wrapper and ThreadRoom. Returning `undefined` is not a
 * skip: `@sentry/cloudflare` then reads the baked `SENTRY_DSN` and reports
 * local wrangler as production (no release). Disable the SDK instead.
 */
export function getSentryOptions(env: AppEnv): CloudflareOptions {
	const options = buildSentryOptions(env)
	if (!options.dsn || isLocalSentryRuntime(env)) return disabledSentryOptions
	return options
}

/** `instrumentDurableObjectWithSentry` requires an options object. */
export function getDurableObjectSentryOptions(env: AppEnv): CloudflareOptions {
	return getSentryOptions(env)
}
