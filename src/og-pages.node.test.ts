import { expect, test } from 'vitest'
import { examplePath } from '#src/example-thread.ts'
import {
	defaultOgImage,
	pageOgForImagePath,
	pageOgForPath,
	pageOgSpecs,
	safetyOgImage,
	threadViewOgPath,
	viewOgCacheKey,
	viewOgLede,
	viewOgTitle,
	viewTokenForOgPath,
} from '#src/og-pages.ts'

test('every public page has a unique OG image path', () => {
	const imagePaths = pageOgSpecs.map((spec) => spec.imagePath)
	expect(new Set(imagePaths).size).toBe(pageOgSpecs.length)
	expect(pageOgForPath('/')?.imagePath).toBe(defaultOgImage)
	expect(pageOgForPath(examplePath)?.imagePath).toBe(`${examplePath}/og.png`)
	expect(pageOgForPath('/safety')?.imagePath).toBe(safetyOgImage)
	expect(pageOgForPath('/account')).toBeNull()
})

test('pageOgForImagePath maps png and jpg aliases', () => {
	expect(pageOgForImagePath('/og.png')?.id).toBe('exchange')
	expect(pageOgForImagePath('/og.jpg')?.id).toBe('exchange')
	expect(pageOgForImagePath('/example/og.png')?.id).toBe('example')
	expect(pageOgForImagePath('/example/og.jpg')?.id).toBe('example')
	expect(pageOgForImagePath('/pricing/og.png')?.id).toBe('pricing')
	expect(pageOgForImagePath('/docs/og.png')?.id).toBe('docs')
	expect(pageOgForImagePath('/privacy/og.png')?.id).toBe('privacy')
	expect(pageOgForImagePath('/terms/og.png')?.id).toBe('terms')
	expect(pageOgForImagePath('/safety/og.png')?.id).toBe('research')
	expect(pageOgForImagePath('/missing/og.png')).toBeNull()
	expect(pageOgForImagePath('/example')).toBeNull()
	expect(pageOgForImagePath('/t/kx_view_abc/og.png')).toBeNull()
})

test('view OG paths and copy stay on the public roster, not tokens', () => {
	const token = `kx_view_${'a'.repeat(48)}`
	expect(threadViewOgPath(token)).toBe(`/t/${token}/og.png`)
	expect(viewTokenForOgPath(`/t/${token}/og.png`)).toBe(token)
	expect(viewTokenForOgPath(`/t/${token}/og.jpg`)).toBe(token)
	expect(viewTokenForOgPath(`/t/${token}`)).toBeNull()
	expect(viewOgTitle(null)).toBe('Untitled thread')
	expect(viewOgTitle('x'.repeat(90)).endsWith('…')).toBe(true)
	const lede = viewOgLede({
		members: [{ name: 'harbor' }, { name: 'relay' }],
		seats: 2,
		expiresAt: Date.parse('2026-04-09T15:02:11.000Z'),
	})
	expect(lede).toBe('2 of 2 · harbor, relay · expires 2026-04-09')
	const beforeJoin = viewOgCacheKey({
		viewToken: token,
		purpose: 'pair on billing',
		members: [{ name: 'harbor' }],
		seats: 2,
		expiresAt: Date.parse('2026-04-09T15:02:11.000Z'),
	})
	const afterJoin = viewOgCacheKey({
		viewToken: token,
		purpose: 'pair on billing',
		members: [{ name: 'harbor' }, { name: 'relay' }],
		seats: 2,
		expiresAt: Date.parse('2026-04-09T15:02:11.000Z'),
	})
	expect(beforeJoin).not.toBe(afterJoin)
	expect(beforeJoin).toContain(token)
	const archived = viewOgCacheKey({
		viewToken: token,
		purpose: 'pair on billing',
		members: [{ name: 'harbor' }, { name: 'relay' }],
		seats: 2,
		expiresAt: Date.parse('2026-04-09T15:02:11.000Z'),
		archived: true,
	})
	expect(archived).not.toBe(afterJoin)
	expect(
		viewOgLede({
			members: [{ name: 'harbor' }],
			seats: 2,
			expiresAt: Date.parse('2026-04-09T15:02:11.000Z'),
			archived: true,
		}),
	).toBe('1 of 2 · harbor · archived')
})
