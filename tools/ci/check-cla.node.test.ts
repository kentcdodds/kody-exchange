import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import {
	applyIndividualClaSigningComment,
	checkClaIdentities,
	individualClaSigningPhrase,
	parseClaSignersFile,
	serializeClaSignersFile,
} from './check-cla.mjs'

function signersFile(overrides = {}) {
	return {
		version: 1,
		document: 'docs/legal/individual-cla.md',
		allowlist: {
			github: ['kentcdodds', 'kody-bot', 'cursoragent'],
			email: ['me@kentcdodds.com', 'me+github@kentcdodds.com'],
		},
		signers: [],
		...overrides,
	}
}

test('CLA check allowlists the Licensor, bots, signed humans, and rejects everyone else', () => {
	const file = signersFile({
		signers: [
			{
				github: 'ExampleSigner',
				signedAt: '2026-08-16',
				cla: 'individual',
			},
		],
	})
	expect(
		checkClaIdentities(
			[
				{ githubLogin: 'kentcdodds', name: 'Kent', email: null },
				{ githubLogin: 'kody-bot', name: 'Kody', email: null },
				{
					githubLogin: 'cursoragent',
					name: 'Cursor Agent',
					email: 'cursoragent@cursor.com',
				},
				{ githubLogin: 'cursor[bot]', name: 'cursor[bot]', email: null },
				{
					githubLogin: 'examplesigner',
					name: 'Example',
					email: null,
				},
			],
			file,
		),
	).toEqual({ ok: true })
	expect(
		checkClaIdentities(
			[{ githubLogin: 'someone-else', name: 'Someone', email: null }],
			file,
		).ok,
	).toBe(false)
})

test('CLA signing comment records the commenter once', () => {
	const recorded = applyIndividualClaSigningComment({
		file: signersFile(),
		github: 'ExampleSigner',
		signedAt: '2026-08-16',
		comment: individualClaSigningPhrase,
	})
	expect(recorded.status).toBe('recorded')
	expect(
		applyIndividualClaSigningComment({
			file: recorded.file,
			github: 'examplesigner',
			signedAt: '2026-08-17',
			comment: individualClaSigningPhrase,
		}).status,
	).toBe('already_signed')
	const serialized = serializeClaSignersFile(recorded.file)
	expect(serialized).toContain('"ExampleSigner"')
	expect(serialized).toContain(
		'"github": ["kentcdodds", "kody-bot", "cursoragent"]',
	)
	expect(serialized.endsWith('\n')).toBe(true)
	expect(parseClaSignersFile(serialized)).toEqual(recorded.file)
	expect(
		applyIndividualClaSigningComment({
			file: signersFile(),
			github: '   ',
			signedAt: '2026-08-16',
			comment: individualClaSigningPhrase,
		}),
	).toEqual({
		file: signersFile(),
		status: 'ignored',
		reason: 'missing_login',
	})
})

test('CLA signers file parser rejects the wrong version and accepts a valid repo file', () => {
	expect(() => parseClaSignersFile('{"version":2}')).toThrow(/version 1/)
	const parsed = parseClaSignersFile(
		readFileSync('.github/cla-signers.json', 'utf8'),
	)
	expect(parsed.version).toBe(1)
	expect(Array.isArray(parsed.signers)).toBe(true)
})
