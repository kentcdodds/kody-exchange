export const mcpLatestProtocolVersion = '2026-07-28'

// Legacy revisions the Agents SDK / MCP server still serve via
// `createMcpHandler({ legacy: 'stateless' })`. Keep in lockstep with
// `@modelcontextprotocol/server` `SUPPORTED_PROTOCOL_VERSIONS`.
export const mcpLegacyProtocolVersions = [
	'2025-11-25',
	'2025-06-18',
	'2025-03-26',
	'2024-11-05',
	'2024-10-07',
] as const

export const mcpSupportedProtocolVersions = [
	mcpLatestProtocolVersion,
	...mcpLegacyProtocolVersions,
] as const
