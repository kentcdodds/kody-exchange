import { type AppEnv } from '#src/env.ts'
import { type MessageEnvelope } from '#src/envelope.ts'

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
	message: MessageEnvelope,
) {
	if (!env.THREAD_ROOMS) return
	const stub = env.THREAD_ROOMS.get(env.THREAD_ROOMS.idFromName(threadId))
	await stub.fetch('https://thread-room/broadcast', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ ok: true, messages: [message] }),
	})
}

export async function maybeBroadcastThreadView(
	env: AppEnv,
	threadId: string,
	message: MessageEnvelope,
	ctx?: ExecutionContext,
) {
	const pending = broadcastThreadView(env, threadId, message).catch((error) => {
		console.warn('thread_room_broadcast_failed', threadId, error)
	})
	if (ctx) ctx.waitUntil(pending)
	await pending
}
