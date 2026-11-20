import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vitest/config';

// The demo app is src/routes; the package is src/lib, built by `svelte-package` into dist/.
export default defineConfig({
	plugins: [sveltekit({ adapter: adapter({ fallback: 'index.html' }) })],
	server: { port: 5181 },
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
	test: { environment: 'jsdom', include: ['src/**/*.test.ts'] }
});
