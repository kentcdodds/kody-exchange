export function createId(prefix: string) {
	return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export function randomToken(prefix: string, bytes = 24) {
	const raw = new Uint8Array(bytes)
	crypto.getRandomValues(raw)
	return `${prefix}_${bytesToHex(raw)}`
}

export function randomSecret(bytes = 32) {
	const raw = new Uint8Array(bytes)
	crypto.getRandomValues(raw)
	return bytesToHex(raw)
}

export function bytesToHex(bytes: Uint8Array) {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
		'',
	)
}

export function hexToBytes(hex: string) {
	if (hex.length % 2 !== 0) {
		throw new Error('hex length must be even')
	}
	const bytes = new Uint8Array(hex.length / 2)
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
	}
	return bytes
}
