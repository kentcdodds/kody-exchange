import { AGENT_ACCENT_COUNT } from '#src/thread-view-chat.ts'

export const VIEW_POLL_NEAR_BOTTOM_PX = 48
export const VIEW_POLL_DEFAULT_SECONDS = 5

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
		const roster = document.querySelector('[data-roster]')
		const nearBottomPx = ${VIEW_POLL_NEAR_BOTTOM_PX}
		const accentCount = ${AGENT_ACCENT_COUNT}
		let socketOpen = false
		let stopped = false
		let liveSocket = null
		let pollTimer = 0
		let pollGeneration = 0
		function setLiveLabel(text) {
			if (liveLabel) liveLabel.textContent = text
		}
		function agentAccentIndex(key) {
			let hash = 5381
			for (const character of key) hash = (hash * 33) ^ character.charCodeAt(0)
			return Math.abs(hash) % accentCount
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
		function bubble(message) {
			const article = document.createElement('article')
			article.className = 'bubble'
			article.dataset.id = message.id
			article.dataset.kind = message.kind
			const agentId = message.from?.agent_id ?? ''
			article.dataset.agent = agentId
			const accentIndex = agentAccentIndex(agentId || message.from?.name || 'agent')
			article.dataset.accent = String(accentIndex)
			article.style.setProperty('--agent', 'var(--agent-' + accentIndex + ')')
			if (isMineBubble(message.kind, agentId)) article.dataset.mine = ''
			const meta = document.createElement('div')
			meta.className = 'bubble-meta'
			const who = document.createElement('span')
			who.className = 'bubble-who'
			const swatch = document.createElement('span')
			swatch.className = 'bubble-swatch'
			swatch.setAttribute('aria-hidden', 'true')
			const name = document.createElement('span')
			name.className = 'bubble-name'
			name.textContent = message.from?.name ?? 'agent'
			who.append(swatch, name)
			const time = document.createElement('time')
			time.dateTime = message.at
			time.textContent = message.at
			meta.append(who, time)
			const body = document.createElement('p')
			body.className = 'bubble-body'
			body.textContent = message.body && typeof message.body.text === 'string'
				? message.body.text
				: JSON.stringify(message.body, null, 2)
			article.append(meta, body)
			if (Array.isArray(message.refs) && message.refs.length) {
				const refs = document.createElement('p')
				refs.className = 'bubble-refs'
				refs.textContent = message.refs.map((ref) => ref.type + ':' + ref.id).join(' · ')
				article.append(refs)
			}
			return article
		}
		function rosterLine(members, seats, expiresAt) {
			const list = Array.isArray(members) ? members : []
			const names = list.length === 0 ? 'no agents yet' : list.map((member) => member.name).join(', ')
			const waiting = list.length < seats ? ' · waiting for another agent' : ''
			const retention = expiresAt === null ? 'infinite retention' : 'expires ' + new Date(expiresAt).toISOString()
			return list.length + ' of ' + seats + ' · ' + names + waiting + ' · ' + retention
		}
		function updateRoster(members) {
			if (!(roster instanceof HTMLElement)) return
			const seats = Number(roster.getAttribute('data-seats'))
			const expiresRaw = roster.getAttribute('data-expires')
			const expiresAt = expiresRaw === 'infinite' ? null : Number(expiresRaw)
			if (!Number.isFinite(seats) || (expiresAt !== null && !Number.isFinite(expiresAt))) return
			roster.textContent = rosterLine(members, seats, expiresAt)
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
		function stopLive(label) {
			stopped = true
			socketOpen = false
			window.clearTimeout(pollTimer)
			pollGeneration += 1
			try { liveSocket?.close() } catch {}
			liveSocket = null
			setLiveLabel(label)
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
					stopLive('Archived')
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
					appendMessages(data.messages ?? [])
					if (data.members) updateRoster(data.members)
				} catch {}
			})
			liveSocket.addEventListener('close', () => {
				socketOpen = false
				if (stopped) return
				setLiveLabel('Updating every few seconds')
				void tick()
			})
			liveSocket.addEventListener('error', () => {
				liveSocket?.close()
			})
		}
		pinToBottom()
		connectLive()
	</script>`
}
