import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.node.test.ts', 'tools/**/*.node.test.ts'],
		environment: 'node',
	},
	resolve: {
		alias: [
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
