import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import { checkClaIdentities, parseClaSignersFile } from './check-cla.mjs'

test('CLA check allowlists the Licensor and signed humans, and rejects everyone else', () => {
	const file = parseClaSignersFile(
		readFileSync('.github/cla-signers.json', 'utf8'),
	)
	expect(
		checkClaIdentities(
			[
				{ githubLogin: 'kentcdodds', name: 'Kent', email: null },
				{ githubLogin: 'kody-bot', name: 'Kody', email: null },
				{ githubLogin: 'cursoragent', name: 'Cursor Agent', email: 'cursoragent@cursor.com' },
				{ githubLogin: 'cursor[bot]', name: 'cursor[bot]', email: null },
			],
			file,
		),
	).toEqual({ ok: true })
	const failing = checkClaIdentities(
		[{ githubLogin: 'someone-else', name: 'Someone', email: null }],
		file,
	)
	expect(failing.ok).toBe(false)
})
