import { type ErrorEvent } from '@sentry/cloudflare'
import { expect, test } from 'vitest'
import {
	buildSentryOptions,
	d1StorageOperationTimeoutResetMessage,
	durableObjectCodeUpdatedResetMessage,
	durableObjectIsolateMemoryResetMessage,
	filterSentryEvent,
	getDurableObjectSentryOptions,
	getSentryOptions,
} from '#src/sentry-options.ts'
import { createTestEnv } from '#src/test-support.ts'

function errorEvent(message: string, extra?: string): ErrorEvent {
	return {
		message,
		exception: {
			values: [
				{ type: 'Error', value: message },
				...(extra ? [{ type: 'Error', value: extra }] : []),
			],
		},
	} as ErrorEvent
}

test('disables Sentry when SENTRY_DSN is unset', () => {
	expect(getSentryOptions(createTestEnv())).toMatchObject({
		enabled: false,
		dsn: '',
	})
	expect(getSentryOptions(createTestEnv({ SENTRY_DSN: '   ' }))).toMatchObject({
		enabled: false,
		dsn: '',
	})
	expect(getDurableObjectSentryOptions(createTestEnv())).toMatchObject({
		enabled: false,
		dsn: '',
	})
})

test('disables Sentry for local wrangler (dev, empty commit, or environment)', () => {
	const localWithProductionDsn = createTestEnv({
		SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
		APP_COMMIT_SHA: 'dev',
		SENTRY_ENVIRONMENT: 'production',
	})
	expect(getSentryOptions(localWithProductionDsn)).toMatchObject({
		enabled: false,
		dsn: '',
	})
	expect(getDurableObjectSentryOptions(localWithProductionDsn)).toMatchObject({
		enabled: false,
		dsn: '',
	})
	expect(
		getSentryOptions(
			createTestEnv({
				SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
				APP_COMMIT_SHA: '',
				SENTRY_ENVIRONMENT: 'production',
			}),
		),
	).toMatchObject({ enabled: false, dsn: '' })
	expect(
		getSentryOptions(
			createTestEnv({
				SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
				APP_COMMIT_SHA: 'abc123',
				SENTRY_ENVIRONMENT: 'development',
			}),
		),
	).toMatchObject({ enabled: false, dsn: '' })
})

test('builds options from the DSN, environment, and commit sha', () => {
	const env = createTestEnv({
		SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
		SENTRY_ENVIRONMENT: 'production',
		APP_COMMIT_SHA: 'abc123',
	})
	const options = getSentryOptions(env)
	expect(options).toMatchObject({
		dsn: 'https://public@o1.ingest.sentry.io/1',
		environment: 'production',
		release: 'abc123',
		tracesSampleRate: 1,
		sendDefaultPii: false,
	})
	expect(getDurableObjectSentryOptions(env)).toMatchObject({
		dsn: 'https://public@o1.ingest.sentry.io/1',
		environment: 'production',
		release: 'abc123',
	})
	expect(buildSentryOptions(createTestEnv()).environment).toBe('development')
})

test('honors a numeric traces sample rate var', () => {
	const options = getSentryOptions(
		createTestEnv({
			SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
			SENTRY_ENVIRONMENT: 'production',
			SENTRY_TRACES_SAMPLE_RATE: 0.25,
		}),
	)
	expect(options?.tracesSampleRate).toBe(0.25)
})

test('drops retryable D1 platform noise and keeps real errors', () => {
	expect(
		filterSentryEvent(errorEvent('D1_ERROR: SQLITE_BUSY: database is locked')),
	).toBeNull()
	expect(
		filterSentryEvent(
			errorEvent('D1 DB is overloaded. Requests queued for too long'),
		),
	).toBeNull()
	expect(
		filterSentryEvent(
			errorEvent(
				'internal error in D1 DB storage caused object to be reset; reference = abc123',
			),
		),
	).toBeNull()
	expect(
		filterSentryEvent(
			errorEvent(
				'D1_ERROR: internal error in D1 DB storage caused object to be reset; reference = abc123',
			),
		),
	).toBeNull()
	expect(
		filterSentryEvent(
			errorEvent('internal error; reference = 4g5mg5npu939v89t62h451km'),
		),
	).toBeNull()
	expect(
		filterSentryEvent(
			errorEvent(
				'D1_ERROR: internal error; reference = 4g5mg5npu939v89t62h451km',
			),
		),
	).toBeNull()
	expect(
		filterSentryEvent(
			errorEvent(
				'Error: D1_ERROR: internal error; reference = 4g5mg5npu939v89t62h451km',
			),
		),
	).toBeNull()
	expect(filterSentryEvent(errorEvent('Network connection lost'))).toBeNull()
	expect(
		filterSentryEvent(errorEvent(d1StorageOperationTimeoutResetMessage)),
	).toBeNull()
	expect(
		filterSentryEvent(
			errorEvent(d1StorageOperationTimeoutResetMessage.replace(/\.$/, '')),
		),
	).toBeNull()
	expect(
		filterSentryEvent(
			errorEvent(`D1_ERROR: ${d1StorageOperationTimeoutResetMessage}`),
		),
	).toBeNull()
	expect(
		filterSentryEvent(
			errorEvent(`Error: D1_ERROR: ${d1StorageOperationTimeoutResetMessage}`),
		),
	).toBeNull()
	const kept = errorEvent('thread create failed')
	expect(filterSentryEvent(kept)).toBe(kept)
	const keptIncompleteInternal = errorEvent('D1_ERROR: internal error')
	expect(filterSentryEvent(keptIncompleteInternal)).toBe(keptIncompleteInternal)
})

test('drops localhost request URLs so wrangler cannot email production', () => {
	const fromRequest = errorEvent(
		'D1_ERROR: no such table: threads: SQLITE_ERROR',
	)
	fromRequest.request = { url: 'http://localhost/v1/threads' }
	expect(filterSentryEvent(fromRequest)).toBeNull()

	const fromTag = errorEvent('thread create failed')
	fromTag.tags = { url: 'http://127.0.0.1:8787/v1/threads' }
	expect(filterSentryEvent(fromTag)).toBeNull()

	const ipv6 = errorEvent('thread create failed')
	ipv6.request = { url: 'http://[::1]:8787/health' }
	expect(filterSentryEvent(ipv6)).toBeNull()

	const production = errorEvent('thread create failed')
	production.request = { url: 'https://kody.exchange/v1/threads' }
	expect(filterSentryEvent(production)).toBe(production)
})

test('drops bare Durable Object platform resets only', () => {
	expect(
		filterSentryEvent(errorEvent(durableObjectIsolateMemoryResetMessage)),
	).toBeNull()
	expect(
		filterSentryEvent(errorEvent(durableObjectCodeUpdatedResetMessage)),
	).toBeNull()
	const wrapped = errorEvent(
		'broadcast failed',
		durableObjectIsolateMemoryResetMessage,
	)
	expect(filterSentryEvent(wrapped)).toBe(wrapped)
})
