import { defineConfig } from 'vitest/config';

// Which build a browser runs, in its reports of how the picture runs (src/perf.ts):
// the commit on Cloudflare's Workers Builds, else when it was built.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const build = env.WORKERS_CI_COMMIT_SHA?.slice(0, 7) || new Date().toISOString().slice(0, 16);

export default defineConfig({
  define: { __BUILD__: JSON.stringify(build) },
  server: {
    port: 5173,
    strictPort: false,
    // The multiplayer's signalling, TURN credentials, the accounts and the leaderboard,
    // served by `npm run dev:signal` (wrangler dev, with .dev.vars: see .dev.vars.example).
    proxy: {
      '/signal': { target: 'ws://localhost:8787', ws: true },
      '/players': { target: 'http://localhost:8787' },
      // The Worker only answers its own origin.
      '/turn': { target: 'http://localhost:8787', changeOrigin: true, headers: { Origin: 'http://localhost:8787' } },
      // The page's own Host and Origin go through: the session's cookie is this page's.
      '/api': { target: 'http://localhost:8787' },
      '/scores': { target: 'http://localhost:8787' },
    },
  },
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
