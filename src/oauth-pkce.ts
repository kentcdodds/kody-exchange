export function getPkceValidationError(input: {
	codeChallenge?: string
	codeChallengeMethod?: string
}) {
	if (input.codeChallenge && input.codeChallengeMethod !== 'S256') {
		return 'PKCE code_challenge_method must be S256.'
	}
	return null
}
