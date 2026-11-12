import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
    // The multiplayer's signalling and TURN credentials, served by `npm run dev:signal` (wrangler dev).
    proxy: {
      '/signal': { target: 'ws://localhost:8787', ws: true },
      '/players': { target: 'http://localhost:8787' },
      // The Worker only answers its own origin.
      '/turn': { target: 'http://localhost:8787', changeOrigin: true, headers: { Origin: 'http://localhost:8787' } },
    },
  },
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
