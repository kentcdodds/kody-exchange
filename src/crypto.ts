import { bytesToHex, hexToBytes } from '#src/ids.ts'

const textEncoder = new TextEncoder()

export async function sha256Hex(value: string) {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		textEncoder.encode(value),
	)
	return bytesToHex(new Uint8Array(digest))
}

export async function hmacSha256Hex(secret: string, value: string) {
	const key = await crypto.subtle.importKey(
		'raw',
		textEncoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const signature = await crypto.subtle.sign(
		'HMAC',
		key,
		textEncoder.encode(value),
	)
	return bytesToHex(new Uint8Array(signature))
}

export function bytesToBase64Url(bytes: Uint8Array) {
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary)
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '')
}

export function utf8ToBase64Url(value: string) {
	return bytesToBase64Url(textEncoder.encode(value))
}

export function base64UrlToUtf8(value: string) {
	const padded = value.replaceAll('-', '+').replaceAll('_', '/')
	const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
	const binary = atob(`${padded}${pad}`)
	const bytes = new Uint8Array(binary.length)
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index)
	}
	return new TextDecoder().decode(bytes)
}

export async function signPayload(secret: string, payload: string) {
	const encoded = utf8ToBase64Url(payload)
	const signature = await hmacSha256Hex(secret, encoded)
	return `${encoded}.${signature}`
}

export async function verifyPayload(secret: string, token: string) {
	const dot = token.lastIndexOf('.')
	if (dot <= 0) return null
	const encoded = token.slice(0, dot)
	const signature = token.slice(dot + 1)
	const expected = await hmacSha256Hex(secret, encoded)
	if (!timingSafeEqualHex(signature, expected)) return null
	try {
		return base64UrlToUtf8(encoded)
	} catch {
		return null
	}
}

export function timingSafeEqualHex(left: string, right: string) {
	if (left.length !== right.length) return false
	try {
		const leftBytes = hexToBytes(left)
		const rightBytes = hexToBytes(right)
		if (leftBytes.length !== rightBytes.length) return false
		let diff = 0
		for (let index = 0; index < leftBytes.length; index += 1) {
			diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
		}
		return diff === 0
	} catch {
		return false
	}
}
