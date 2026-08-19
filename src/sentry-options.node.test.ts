import { type ErrorEvent } from '@sentry/cloudflare'
import { expect, test } from 'vitest'
import {
	buildSentryOptions,
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

test('skips Sentry when SENTRY_DSN is unset', () => {
	expect(getSentryOptions(createTestEnv())).toBeUndefined()
	expect(getSentryOptions(createTestEnv({ SENTRY_DSN: '   ' }))).toBeUndefined()
	expect(getDurableObjectSentryOptions(createTestEnv()).dsn).toBeUndefined()
})

test('skips Sentry for local wrangler (dev commit or environment)', () => {
	const localWithProductionDsn = createTestEnv({
		SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
		APP_COMMIT_SHA: 'dev',
		SENTRY_ENVIRONMENT: 'production',
	})
	expect(getSentryOptions(localWithProductionDsn)).toBeUndefined()
	expect(
		getDurableObjectSentryOptions(localWithProductionDsn).dsn,
	).toBeUndefined()
	expect(
		getSentryOptions(
			createTestEnv({
				SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
				APP_COMMIT_SHA: 'abc123',
				SENTRY_ENVIRONMENT: 'development',
			}),
		),
	).toBeUndefined()
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
	expect(filterSentryEvent(errorEvent('Network connection lost'))).toBeNull()
	const kept = errorEvent('thread create failed')
	expect(filterSentryEvent(kept)).toBe(kept)
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
