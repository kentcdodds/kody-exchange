import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.node.test.ts', 'tools/**/*.node.test.ts'],
		environment: 'node',
	},
	resolve: {
		alias: {
			'#src': new URL('./src', import.meta.url).pathname,
		},
	},
})
