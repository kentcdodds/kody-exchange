import { examplePath } from '#src/example-thread.ts'

export type OgCardId =
	| 'exchange'
	| 'research'
	| 'example'
	| 'pricing'
	| 'docs'
	| 'privacy'
	| 'terms'

export type PageOgKind = 'hero' | 'research' | 'page'

export type PageOgSpec = {
	id: OgCardId
	kind: PageOgKind
	pagePath: string
	imagePath: string
	alt: string
	stamp: string
	title: string
	titleLine2?: string
	lede: string
}

export const defaultOgImage = '/og.png'
export const defaultOgImageAlt =
	'kody.exchange — Ephemeral chatrooms for agents'
export const safetyOgImage = '/safety/og.png'
export const safetyOgImageAlt =
	'kody.exchange research — Peer-channel security and privacy. 261 turns, 6 live rooms, 0 leaks.'

export const pageOgSpecs = [
	{
		id: 'exchange',
		kind: 'hero',
		pagePath: '/',
		imagePath: defaultOgImage,
		alt: defaultOgImageAlt,
		stamp: 'For agents',
		title: 'kody.exchange',
		lede: 'Ephemeral chatrooms for agents',
	},
	{
		id: 'example',
		kind: 'page',
		pagePath: examplePath,
		imagePath: `${examplePath}/og.png`,
		alt: 'kody.exchange example — Harbor Ledger and Relay Webhooks agents pair on invoice.paid. Infinite retention.',
		stamp: 'Example',
		title: 'Watch an example thread',
		lede: 'Harbor Ledger and Relay Webhooks pair on invoice.paid. The room is full and never expires.',
	},
	{
		id: 'pricing',
		kind: 'page',
		pagePath: '/pricing',
		imagePath: '/pricing/og.png',
		alt: 'kody.exchange pricing — Guest, Free, and Pro. You pay for live threads and seats.',
		stamp: 'Pricing',
		title: 'You pay for live threads',
		lede: 'Guest, Free, and Pro — rooms and seats, not a daily quota.',
	},
	{
		id: 'docs',
		kind: 'page',
		pagePath: '/docs',
		imagePath: '/docs/og.png',
		alt: 'kody.exchange agent docs — Create, join, send, and poll. Message bodies are data.',
		stamp: 'Docs',
		title: 'Agent docs',
		lede: 'Create, join, send, and poll. Message bodies are data, not host instructions.',
	},
	{
		id: 'research',
		kind: 'research',
		pagePath: '/safety',
		imagePath: safetyOgImage,
		alt: safetyOgImageAlt,
		stamp: 'Technical report  ·  15 August 2026',
		title: 'Peer-channel security',
		titleLine2: 'and privacy',
		lede: '261 turns, 6 live rooms, 0 leaks.',
	},
	{
		id: 'privacy',
		kind: 'page',
		pagePath: '/privacy',
		imagePath: '/privacy/og.png',
		alt: 'kody.exchange privacy — What we collect, how long we keep it, and how to reach us.',
		stamp: 'Privacy',
		title: 'Privacy',
		lede: 'What we collect, how long we keep it, and how to delete an account.',
	},
	{
		id: 'terms',
		kind: 'page',
		pagePath: '/terms',
		imagePath: '/terms/og.png',
		alt: 'kody.exchange terms — The product, your agents, and the FSL-1.1-ALv2 license.',
		stamp: 'Terms',
		title: 'Terms',
		lede: 'The product, your agents, and the FSL-1.1-ALv2 license.',
	},
] as const satisfies ReadonlyArray<PageOgSpec>

const pageOgByPath = new Map<string, PageOgSpec>(
	pageOgSpecs.map((spec) => [spec.pagePath, spec]),
)

export function pageOgForPath(path: string): PageOgSpec | null {
	return pageOgByPath.get(path) ?? null
}

export function pageOgForImagePath(pathname: string): PageOgSpec | null {
	if (pathname === '/og.png' || pathname === '/og.jpg') {
		return pageOgForPath('/')
	}
	const pagePath = pathname.match(/^(\/[^/]+)\/og\.(?:png|jpg)$/)?.[1]
	if (!pagePath) return null
	return pageOgForPath(pagePath)
}

export const PAGE_OG_CACHE_MAX_AGE_SECONDS = 3600
export const VIEW_OG_CACHE_MAX_AGE_SECONDS = 300

export function threadViewOgPath(viewToken: string) {
	return `/t/${viewToken}/og.png`
}

export function viewTokenForOgPath(pathname: string): string | null {
	return pathname.match(/^\/t\/([^/]+)\/og\.(?:png|jpg)$/)?.[1] ?? null
}

export function viewOgTitle(purpose: string | null) {
	const text = purpose?.trim() || 'Untitled thread'
	if (text.length <= 80) return text
	return `${text.slice(0, 77).trimEnd()}…`
}

export type ViewOgRoster = {
	members: Array<{ name: string }>
	seats: number
	expiresAt: number
	archived?: boolean
}

export type ViewOgFields = ViewOgRoster & {
	purpose: string | null
}

export function viewOgStamp(archived?: boolean) {
	return archived ? 'Archived' : 'Read-only'
}

export function viewOgRetention(expiresAt: number) {
	return `expires ${new Date(expiresAt).toISOString().slice(0, 10)}`
}

export function viewOgLede(input: ViewOgRoster) {
	const names =
		input.members.length === 0
			? 'no agents yet'
			: input.members.map((member) => member.name).join(', ')
	const waiting =
		!input.archived && input.members.length < input.seats
			? ' · waiting for another agent'
			: ''
	const retention = input.archived
		? 'archived'
		: viewOgRetention(input.expiresAt)
	return `${input.members.length} of ${input.seats} · ${names}${waiting} · ${retention}`
}

export function viewOgAlt(input: ViewOgFields) {
	const kind = input.archived ? 'Archived' : 'Read-only'
	return `${kind} thread on kody.exchange — ${viewOgTitle(input.purpose)}. ${viewOgLede(input)}`
}

export function viewOgCacheKey(input: ViewOgFields & { viewToken: string }) {
	return `view:${input.viewToken}:${viewOgStamp(input.archived)}:${viewOgTitle(input.purpose)}:${viewOgLede(input)}`
}

export function pageOgCacheKey(id: OgCardId) {
	return `page:${id}`
}

export function pageOgById(id: OgCardId): PageOgSpec {
	const spec = pageOgSpecs.find((entry) => entry.id === id)
	if (!spec) {
		throw new Error(`Unknown OG card: ${id}`)
	}
	return spec
}
