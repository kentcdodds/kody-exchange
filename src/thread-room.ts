import { type AppEnv } from '#src/env.ts'
import { type MessageEnvelope } from '#src/envelope.ts'
import { type ThreadMemberView } from '#src/threads.ts'

export class ThreadRoom {
	constructor(
		readonly ctx: DurableObjectState,
		readonly _env: AppEnv,
	) {}

	async fetch(request: Request) {
		if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
			const pair = new WebSocketPair()
			this.ctx.acceptWebSocket(pair[1])
			return new Response(null, { status: 101, webSocket: pair[0] })
		}
		if (request.method === 'POST') {
			if (new URL(request.url).pathname === '/close') {
				for (const socket of this.ctx.getWebSockets()) {
					try {
						socket.close(1000, 'archived')
					} catch {
						// Drop dead sockets; hibernation cleanup will finish them.
					}
				}
				return new Response(null, { status: 204 })
			}
			const payload = await request.text()
			for (const socket of this.ctx.getWebSockets()) {
				try {
					socket.send(payload)
				} catch {
					// Drop dead sockets; hibernation cleanup will finish them.
				}
			}
			return new Response(null, { status: 204 })
		}
		return new Response('Not found', { status: 404 })
	}

	webSocketMessage(_socket: WebSocket, _message: string | ArrayBuffer) {
		// Read-only watchers. Ignore anything a browser sends.
	}

	webSocketClose(
		_socket: WebSocket,
		_code: number,
		_reason: string,
		_wasClean: boolean,
	) {}

	webSocketError(_socket: WebSocket, _error: unknown) {}
}

export async function broadcastThreadView(
	env: AppEnv,
	threadId: string,
	message: MessageEnvelope | null,
	extra: { members?: Array<ThreadMemberView> } = {},
) {
	if (!env.THREAD_ROOMS) return
	const stub = env.THREAD_ROOMS.get(env.THREAD_ROOMS.idFromName(threadId))
	await stub.fetch('https://thread-room/broadcast', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			ok: true,
			messages: message ? [message] : [],
			...(extra.members ? { members: extra.members } : {}),
		}),
	})
}

export async function closeThreadView(env: AppEnv, threadId: string) {
	if (!env.THREAD_ROOMS) return
	const stub = env.THREAD_ROOMS.get(env.THREAD_ROOMS.idFromName(threadId))
	await stub.fetch('https://thread-room/close', { method: 'POST' })
}

export async function maybeCloseThreadView(
	env: AppEnv,
	threadId: string,
	ctx?: ExecutionContext,
) {
	const pending = closeThreadView(env, threadId).catch((error) => {
		console.warn('thread_room_close_failed', threadId, error)
	})
	if (ctx) ctx.waitUntil(pending)
	await pending
}

export async function maybeBroadcastThreadView(
	env: AppEnv,
	threadId: string,
	message: MessageEnvelope | null,
	ctx?: ExecutionContext,
	extra: { members?: Array<ThreadMemberView> } = {},
) {
	const pending = broadcastThreadView(env, threadId, message, extra).catch(
		(error) => {
			console.warn('thread_room_broadcast_failed', threadId, error)
		},
	)
	if (ctx) ctx.waitUntil(pending)
	await pending
}
