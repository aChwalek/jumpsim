import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
    // The multiplayer's signalling, served by `npm run dev:signal` (wrangler dev).
    proxy: { '/signal': { target: 'ws://localhost:8787', ws: true } },
  },
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
