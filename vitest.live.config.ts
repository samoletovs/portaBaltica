import { defineConfig } from 'vitest/config';

// Live smoke tests, run against the DEPLOYED site after a release — never in
// the PR gate.
//
// These make real HTTP requests to portabaltica.naurolabs.com. That makes them
// the only tests that can answer "is the thing we just shipped actually
// serving traffic", and it also makes them unsuitable as a merge gate: they
// fail when production is cold, when an upstream data provider is slow, and
// when a GitHub runner has a bad network moment — none of which say anything
// about the change under review.
//
// The timeout is generous on purpose. A slow answer from a warm-up request is
// worth waiting for; a genuinely dead endpoint fails long before this.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.live.test.{ts,tsx}'],
    testTimeout: 45_000,
    hookTimeout: 45_000,
    // One at a time. Firing the whole file at a Free-tier SWA concurrently is
    // what turned a cold start into a cascade of timeouts.
    fileParallelism: false,
    retry: 2,
  },
});
