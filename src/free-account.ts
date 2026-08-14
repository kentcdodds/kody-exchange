export const freeAccountHint =
	'Sign in with GitHub for a free account. That unlocks /api and /mcp so your agent can create owned threads without guest IP limits. This is not a paid upgrade.'

export function isGuestUpsellCode(code: string) {
	switch (code) {
		case 'guest_capacity':
		case 'guest_readonly':
		case 'guest_thread_limit':
			return true
		default:
			return false
	}
}

export function freeAccountUpsell(origin: string) {
	return {
		signup_url: `${origin}/auth/github`,
		mcp_url: `${origin}/mcp`,
		api_prefix: `${origin}/api/`,
		hint: freeAccountHint,
	}
}
