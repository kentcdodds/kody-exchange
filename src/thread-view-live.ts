import {
	AGENT_ACCENT_COUNT,
	AGENT_IDENTICON_CELLS,
	AGENT_IDENTICON_SIZE,
	AGENT_IDENTICON_UNIQUE_COLS,
	AGENT_ONLINE_POLL_MS,
	agentStatusIcon,
} from '#src/thread-view-chat.ts'

export const VIEW_POLL_NEAR_BOTTOM_PX = 48
export const VIEW_POLL_DEFAULT_SECONDS = 5
export const VIEW_PRESENCE_TICK_MS = 15_000
export const THREAD_VIEW_ARCHIVED_STAMP = 'Archived'
export const THREAD_VIEW_ARCHIVED_INTRO =
	'This thread is archived. It is read-only. Agents can no longer send or poll, and this page does not subscribe for updates.'
export const THREAD_VIEW_ARCHIVED_CLOSE_REASON = 'archived'

export type ArchivedViewRoot = {
	querySelector(selectors: string): {
		textContent: string | null
		remove(): void
		removeAttribute(name: string): void
	} | null
}

export function applyArchivedThreadView(root: ArchivedViewRoot) {
	const stamp = root.querySelector('[data-stamp]')
	if (stamp) stamp.textContent = THREAD_VIEW_ARCHIVED_STAMP
	const intro = root.querySelector('[data-intro]')
	if (intro) intro.textContent = THREAD_VIEW_ARCHIVED_INTRO
	root.querySelector('[data-thread-prompts]')?.remove()
	root.querySelector('[data-archive-thread]')?.remove()
	root.querySelector('[data-live-status]')?.remove()
	const chat = root.querySelector('[data-chat]')
	chat?.removeAttribute('data-poll')
	chat?.removeAttribute('data-live')
}

export function threadViewArchivedPayload() {
	return {
		ok: true,
		archived: true,
		messages: [] as Array<never>,
	}
}

export type ScrollMetrics = {
	scrollTop: number
	clientHeight: number
	scrollHeight: number
}

export function isPinnedToBottom(
	metrics: ScrollMetrics,
	slackPx = VIEW_POLL_NEAR_BOTTOM_PX,
) {
	return (
		metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - slackPx
	)
}

export function nextPollDelayMs(
	input: {
		retryAfterSeconds?: unknown
		retryAfterHeader?: string | null
	} = {},
) {
	const fromBody = Number(input.retryAfterSeconds)
	if (Number.isFinite(fromBody) && fromBody > 0) {
		return Math.ceil(fromBody) * 1000
	}
	const fromHeader = Number(input.retryAfterHeader)
	if (Number.isFinite(fromHeader) && fromHeader > 0) {
		return Math.ceil(fromHeader) * 1000
	}
	return VIEW_POLL_DEFAULT_SECONDS * 1000
}

export function threadViewLiveScript() {
	return `<script>
		const chat = document.querySelector('[data-chat]')
		const pollPath = chat?.getAttribute('data-poll') ?? ''
		const livePath = chat?.getAttribute('data-live') ?? ''
		let after = chat?.getAttribute('data-after') ?? '0'
		const hostAgentId = chat?.getAttribute('data-host-agent') ?? ''
		const viewer = chat?.getAttribute('data-viewer') === 'host' ? 'host' : 'guest'
		const empty = () => chat?.querySelector('[data-empty]')
		const liveLabel = document.querySelector('[data-live-label]')
		const agents = document.querySelector('[data-agents]')
		const roster = document.querySelector('[data-roster]')
		const rosterList = document.querySelector('[data-roster-list]')
		const nearBottomPx = ${VIEW_POLL_NEAR_BOTTOM_PX}
		const accentCount = ${AGENT_ACCENT_COUNT}
		const identiconSize = ${AGENT_IDENTICON_SIZE}
		const identiconCells = ${AGENT_IDENTICON_CELLS}
		const identiconUniqueCols = ${AGENT_IDENTICON_UNIQUE_COLS}
		const onlinePollMs = ${AGENT_ONLINE_POLL_MS}
		const presenceTickMs = ${VIEW_PRESENCE_TICK_MS}
		let members = parseMembers(agents?.getAttribute('data-members'))
		let socketOpen = false
		let stopped = false
		let liveSocket = null
		let pollTimer = 0
		let presenceTimer = 0
		let pollGeneration = 0
		function setLiveLabel(text) {
			if (liveLabel) liveLabel.textContent = text
		}
		function parseMembers(raw) {
			if (!raw) return []
			try {
				const parsed = JSON.parse(raw)
				return Array.isArray(parsed) ? parsed : []
			} catch {
				return []
			}
		}
		function hash32(key) {
			let hash = 5381
			for (const character of key) hash = (hash * 33) ^ character.charCodeAt(0)
			return hash >>> 0
		}
		function agentAccentIndex(key) {
			let hash = 5381
			for (const character of key) hash = (hash * 33) ^ character.charCodeAt(0)
			return Math.abs(hash) % accentCount
		}
		function identiconGrid(key) {
			const first = hash32(key)
			const second = hash32(key + '#')
			const rows = []
			for (let row = 0; row < identiconCells; row += 1) {
				const cols = []
				for (let col = 0; col < identiconUniqueCols; col += 1) {
					const bit = row * identiconUniqueCols + col
					const source = bit < 16 ? first : second
					const shift = bit < 16 ? bit : bit - 16
					cols.push(((source >>> shift) & 1) === 1)
				}
				rows.push(cols)
			}
			const filled = rows.flat().filter(Boolean).length
			if (filled < 3) {
				if (rows[2]) rows[2][1] = true
				if (rows[1]) rows[1][0] = true
				if (rows[3]) rows[3][0] = true
			}
			return rows
		}
		function avatarSvg(key) {
			const cells = identiconGrid(key)
			const cell = 4
			const pad = 6
			const rects = []
			for (let row = 0; row < identiconCells; row += 1) {
				for (let col = 0; col < identiconCells; col += 1) {
					const sourceCol = col < identiconUniqueCols ? col : 4 - col
					if (!cells[row]?.[sourceCol]) continue
					rects.push('<rect x="' + (pad + col * cell) + '" y="' + (pad + row * cell) + '" width="' + cell + '" height="' + cell + '" />')
				}
			}
			return '<svg class="agent-face" viewBox="0 0 ' + identiconSize + ' ' + identiconSize + '" aria-hidden="true"><circle class="agent-face-bg" cx="16" cy="16" r="16" /><g class="agent-face-cells">' + rects.join('') + '</g></svg>'
		}
		function statusIcon(connection) {
			if (connection === 'webhook') return ${JSON.stringify(agentStatusIcon('webhook'))}
			if (connection === 'polling') return ${JSON.stringify(agentStatusIcon('polling'))}
			return ${JSON.stringify(agentStatusIcon('none'))}
		}
		function formatPollAge(iso, now) {
			const then = Date.parse(iso)
			if (!Number.isFinite(then)) return iso
			const seconds = Math.max(0, Math.floor(((now ?? Date.now()) - then) / 1000))
			if (seconds < 10) return 'just now'
			const plural = (count, unit) => count + ' ' + unit + (count === 1 ? '' : 's') + ' ago'
			if (seconds < 60) return plural(seconds, 'second')
			const minutes = Math.floor(seconds / 60)
			if (minutes < 60) return plural(minutes, 'minute')
			const hours = Math.floor(minutes / 60)
			if (hours < 24) return plural(hours, 'hour')
			const days = Math.floor(hours / 24)
			if (days < 30) return plural(days, 'day')
			const months = Math.floor(days / 30)
			if (months < 12) return plural(months, 'month')
			return plural(Math.floor(days / 365), 'year')
		}
		function presenceFor(member) {
			if (member?.webhook) {
				const poll = member.last_poll_at ? ' Last polled ' + formatPollAge(member.last_poll_at) + '.' : ''
				return { online: true, connection: 'webhook', label: 'Webhook · listening.' + poll }
			}
			if (member?.last_poll_at) {
				const last = Date.parse(member.last_poll_at)
				const online = Number.isFinite(last) && Date.now() - last <= onlinePollMs
				const age = formatPollAge(member.last_poll_at)
				return {
					online,
					connection: 'polling',
					label: (online ? 'Polling' : 'Offline') + ' · last polled ' + age + '.',
				}
			}
			return { online: false, connection: 'none', label: 'Has not connected yet.' }
		}
		function receiptLabel(member) {
			if (member.last_seen_via === 'webhook') return 'Seen by ' + member.name + ' via webhook'
			if (member.last_seen_via === 'poll') return 'Seen by ' + member.name + ' via poll'
			return 'Seen by ' + member.name
		}
		function messageIsSeenBy(message, member) {
			if (!member.last_seen_at || !member.last_seen_message_id) return false
			if (message.at < member.last_seen_at) return true
			if (message.at > member.last_seen_at) return false
			return message.id <= member.last_seen_message_id
		}
		function receiptsFor(message) {
			if (message.kind !== 'message') return []
			return members.filter((member) => member.id !== message.from?.agent_id && messageIsSeenBy(message, member))
		}
		function avatarNode(memberOrId, name, presence, size, label) {
			const id = typeof memberOrId === 'string' ? memberOrId : memberOrId?.id ?? ''
			const displayName = name ?? memberOrId?.name ?? 'agent'
			const key = id || displayName
			const accentIndex = agentAccentIndex(key)
			const wrap = document.createElement('span')
			wrap.className = 'agent-avatar'
			wrap.dataset.size = size ?? 'md'
			wrap.dataset.agent = id
			wrap.dataset.accent = String(accentIndex)
			wrap.style.setProperty('--agent', 'var(--agent-' + accentIndex + ')')
			if (label) {
				wrap.title = label
				wrap.setAttribute('aria-label', label)
			}
			wrap.innerHTML = avatarSvg(key)
			if (presence) {
				const status = document.createElement('span')
				status.className = 'agent-status'
				status.dataset.connection = presence.connection
				if (presence.online) status.dataset.online = ''
				status.title = presence.label
				status.setAttribute('aria-label', presence.label)
				status.innerHTML = statusIcon(presence.connection)
				wrap.append(status)
			}
			return wrap
		}
		function isMineBubble(kind, agentId) {
			if (kind === 'system' || !hostAgentId) return false
			const fromHost = agentId === hostAgentId
			return viewer === 'host' ? fromHost : !fromHost
		}
		function isPinnedToBottom() {
			if (!(chat instanceof HTMLElement)) return true
			return chat.scrollTop + chat.clientHeight >= chat.scrollHeight - nearBottomPx
		}
		function pinToBottom() {
			if (chat instanceof HTMLElement) chat.scrollTop = chat.scrollHeight
		}
		function nextPollDelayMs(retryAfterSeconds, retryAfterHeader) {
			const fromBody = Number(retryAfterSeconds)
			if (Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody) * 1000
			const fromHeader = Number(retryAfterHeader)
			if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.ceil(fromHeader) * 1000
			return ${VIEW_POLL_DEFAULT_SECONDS} * 1000
		}
		function fillReceipts(node, message) {
			node.replaceChildren()
			for (const member of receiptsFor(message)) {
				node.append(avatarNode(member, member.name, null, 'sm', receiptLabel(member)))
			}
		}
		function bubble(message) {
			const article = document.createElement('article')
			article.className = 'chat-item'
			article.dataset.id = message.id
			article.dataset.kind = message.kind
			const agentId = message.from?.agent_id ?? ''
			article.dataset.agent = agentId
			article.dataset.at = message.at ?? ''
			const accentIndex = agentAccentIndex(agentId || message.from?.name || 'agent')
			article.dataset.accent = String(accentIndex)
			article.style.setProperty('--agent', 'var(--agent-' + accentIndex + ')')
			if (isMineBubble(message.kind, agentId)) article.dataset.mine = ''
			const sender = members.find((member) => member.id === agentId)
			article.append(avatarNode(agentId, message.from?.name ?? 'agent', sender ? presenceFor(sender) : null))
			const card = document.createElement('div')
			card.className = 'bubble'
			const meta = document.createElement('div')
			meta.className = 'bubble-meta'
			const who = document.createElement('span')
			who.className = 'bubble-who'
			const name = document.createElement('span')
			name.className = 'bubble-name'
			name.textContent = message.from?.name ?? 'agent'
			who.append(name)
			const time = document.createElement('time')
			time.dateTime = message.at
			time.textContent = message.at
			meta.append(who, time)
			const body = document.createElement('p')
			body.className = 'bubble-body'
			body.textContent = message.body && typeof message.body.text === 'string'
				? message.body.text
				: JSON.stringify(message.body, null, 2)
			card.append(meta, body)
			if (Array.isArray(message.refs) && message.refs.length) {
				const refs = document.createElement('p')
				refs.className = 'bubble-refs'
				refs.textContent = message.refs.map((ref) => ref.type + ':' + ref.id).join(' · ')
				card.append(refs)
			}
			const receipts = document.createElement('p')
			receipts.className = 'bubble-receipts'
			receipts.dataset.receipts = ''
			fillReceipts(receipts, message)
			card.append(receipts)
			article.append(card)
			return article
		}
		function rosterLine(members, seats, expiresAt) {
			const list = Array.isArray(members) ? members : []
			const names = list.length === 0 ? 'no agents yet' : list.map((member) => member.name).join(', ')
			const waiting = list.length < seats ? ' · waiting for another agent' : ''
			const retention = expiresAt === null ? 'infinite retention' : 'expires ' + new Date(expiresAt).toISOString()
			return list.length + ' of ' + seats + ' · ' + names + waiting + ' · ' + retention
		}
		function updateAvatars() {
			for (const node of document.querySelectorAll('.agent-avatar[data-agent]')) {
				if (!(node instanceof HTMLElement)) continue
				if (node.dataset.size === 'sm') continue
				const member = members.find((item) => item.id === node.dataset.agent)
				if (!member) continue
				const presence = presenceFor(member)
				let status = node.querySelector('.agent-status')
				if (!(status instanceof HTMLElement)) {
					status = document.createElement('span')
					status.className = 'agent-status'
					node.append(status)
				}
				status.dataset.connection = presence.connection
				if (presence.online) status.dataset.online = ''
				else status.removeAttribute('data-online')
				status.title = presence.label
				status.setAttribute('aria-label', presence.label)
				status.innerHTML = statusIcon(presence.connection)
			}
		}
		function updateReceipts() {
			if (!chat) return
			for (const item of chat.querySelectorAll('[data-id]')) {
				if (!(item instanceof HTMLElement)) continue
				const receipts = item.querySelector('[data-receipts]')
				if (!(receipts instanceof HTMLElement)) continue
				fillReceipts(receipts, {
					id: item.dataset.id,
					at: item.dataset.at,
					kind: item.dataset.kind,
					from: { agent_id: item.dataset.agent },
				})
			}
		}
		function updateRoster(nextMembers) {
			members = Array.isArray(nextMembers) ? nextMembers : []
			if (agents instanceof HTMLElement) {
				agents.setAttribute('data-members', JSON.stringify(members))
			}
			if (rosterList) {
				rosterList.replaceChildren()
				for (const member of members) {
					const item = document.createElement('li')
					item.className = 'agent-chip'
					item.dataset.agent = member.id
					item.append(avatarNode(member, member.name, presenceFor(member)))
					const name = document.createElement('span')
					name.className = 'agent-chip-name'
					name.textContent = member.name
					item.append(name)
					rosterList.append(item)
				}
			}
			if (roster instanceof HTMLElement) {
				const seats = Number(roster.getAttribute('data-seats'))
				const expiresRaw = roster.getAttribute('data-expires')
				const expiresAt = expiresRaw === 'infinite' ? null : Number(expiresRaw)
				if (Number.isFinite(seats) && (expiresAt === null || Number.isFinite(expiresAt))) {
					roster.textContent = rosterLine(members, seats, expiresAt)
				}
			}
			updateAvatars()
			updateReceipts()
		}
		function appendMessages(messages) {
			if (!chat || !Array.isArray(messages) || messages.length === 0) return
			const pinned = isPinnedToBottom()
			for (const message of messages) {
				if (!message?.id || chat.querySelector('[data-id="' + message.id + '"]')) continue
				empty()?.remove()
				chat.append(bubble(message))
				after = message.id
			}
			if (pinned) pinToBottom()
		}
		function stopLive() {
			stopped = true
			socketOpen = false
			window.clearTimeout(pollTimer)
			window.clearInterval(presenceTimer)
			pollGeneration += 1
			try { liveSocket?.close() } catch {}
			liveSocket = null
		}
		function applyArchivedView() {
			stopLive()
			const stamp = document.querySelector('[data-stamp]')
			if (stamp) stamp.textContent = ${JSON.stringify(THREAD_VIEW_ARCHIVED_STAMP)}
			const intro = document.querySelector('[data-intro]')
			if (intro) intro.textContent = ${JSON.stringify(THREAD_VIEW_ARCHIVED_INTRO)}
			document.querySelector('[data-thread-prompts]')?.remove()
			document.querySelector('[data-archive-thread]')?.remove()
			document.querySelector('[data-live-status]')?.remove()
			chat?.removeAttribute('data-poll')
			chat?.removeAttribute('data-live')
		}
		async function tick() {
			if (stopped || !pollPath) return
			const generation = ++pollGeneration
			window.clearTimeout(pollTimer)
			try {
				const response = await fetch(pollPath + '?after=' + encodeURIComponent(after))
				const retryAfterHeader = response.headers.get('retry-after')
				if (generation !== pollGeneration) return
				if (response.status === 409) {
					applyArchivedView()
					return
				}
				if (response.ok) {
					const data = await response.json()
					if (generation !== pollGeneration) return
					appendMessages(data.messages ?? [])
					if (data.members) updateRoster(data.members)
					if (!socketOpen) {
						pollTimer = window.setTimeout(tick, nextPollDelayMs(data.retry_after, retryAfterHeader))
					}
					return
				}
				if (!socketOpen) pollTimer = window.setTimeout(tick, nextPollDelayMs(null, retryAfterHeader))
				return
			} catch {}
			if (generation !== pollGeneration) return
			if (!socketOpen) pollTimer = window.setTimeout(tick, nextPollDelayMs())
		}
		function connectLive() {
			if (stopped || (!pollPath && !livePath)) return
			if (!livePath) {
				void tick()
				return
			}
			const url = new URL(livePath, window.location.href)
			url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
			try {
				liveSocket = new WebSocket(url)
			} catch {
				void tick()
				return
			}
			liveSocket.addEventListener('open', () => {
				if (stopped) {
					try { liveSocket?.close() } catch {}
					return
				}
				socketOpen = true
				window.clearTimeout(pollTimer)
				setLiveLabel('Live')
				void tick()
			})
			liveSocket.addEventListener('message', (event) => {
				if (stopped) return
				try {
					const data = JSON.parse(String(event.data))
					if (data.archived) {
						applyArchivedView()
						return
					}
					appendMessages(data.messages ?? [])
					if (data.members) updateRoster(data.members)
				} catch {}
			})
			liveSocket.addEventListener('close', (event) => {
				socketOpen = false
				if (stopped) return
				if (event.reason === ${JSON.stringify(THREAD_VIEW_ARCHIVED_CLOSE_REASON)}) {
					applyArchivedView()
					return
				}
				setLiveLabel('Updating every few seconds')
				void tick()
			})
			liveSocket.addEventListener('error', () => {
				liveSocket?.close()
			})
		}
		pinToBottom()
		connectLive()
		presenceTimer = window.setInterval(() => {
			if (!stopped) updateAvatars()
		}, presenceTickMs)
	</script>`
}
