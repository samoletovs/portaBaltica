import { mergeConfig } from 'vitest/config';
import live from './vitest.live.config';

// These exercise third-party datasets through local handlers, not the deployed
// build. Keep them available in test:live; source-alert owns upstream health.
export const upstreamChecks = [
  'tests/indicators.live.test.ts',
  'tests/historicalData.live.test.ts',
  'tests/portData.live.test.ts',
  'tests/tradePartners.live.test.ts',
];

export default mergeConfig(live, {
  test: { exclude: upstreamChecks },
});
