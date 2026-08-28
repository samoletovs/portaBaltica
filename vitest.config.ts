import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `*.live.test.ts` files hit the deployed site over the internet. They are
// smoke tests, not unit tests, and they are excluded here deliberately.
//
// They used to run in the PR gate, where they measured production's latency
// from a GitHub runner rather than anything about the pull request. A cold
// SWA managed Function was enough to fail an unrelated PR, and it did —
// blocking the newsroom stack on a 15s timeout while the same endpoint
// answered a local probe in 0.3s. A gate that red-lights correct changes
// teaches people to bypass gates.
//
// They still run, against the real deployment, in the post-deploy smoke job.
// That is where "is production healthy" belongs.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // No unit test may open a socket to the internet. Two files believed they
    // had stubbed the network and had not, which made roughly two of every five
    // pushes to master go red on an unrelated 5000ms timeout. See
    // `tests/noNetwork.ts` for the measurement and why this is not a raised
    // timeout. Deliberately absent from `vitest.live.config.ts`.
    setupFiles: ['./tests/noNetwork.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/**/*.live.test.{ts,tsx}', '**/node_modules/**', '**/dist/**'],
  },
});
