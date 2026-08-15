import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.node.test.ts', 'tools/**/*.node.test.ts'],
		environment: 'node',
		server: {
			deps: {
				inline: ['@cloudflare/workers-oauth-provider'],
			},
		},
	},
	resolve: {
		alias: [
			{
				find: 'cloudflare:workers',
				replacement: new URL(
					'./src/cloudflare-workers-node.ts',
					import.meta.url,
				).pathname,
			},
			{
				find: '#src/og-assets.ts',
				replacement: new URL('./src/og-assets.node.ts', import.meta.url)
					.pathname,
			},
			{
				find: '#src',
				replacement: new URL('./src', import.meta.url).pathname,
			},
		],
	},
})
