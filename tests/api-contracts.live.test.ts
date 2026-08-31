import { describe, it, expect } from 'vitest';

const BASE = 'https://portabaltica.naurolabs.com';

describe('API contracts (live)', () => {
  it('GET /api/baltic-compare?indicator=gdp returns expected shape', async () => {
    const r = await fetch(`${BASE}/api/baltic-compare?indicator=gdp&years=2`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d).toHaveProperty('indicator', 'gdp');
    expect(d).toHaveProperty('title');
    expect(d).toHaveProperty('unit');
    expect(d).toHaveProperty('countries');
    expect(d.countries).toHaveProperty('LV');
    expect(d.countries).toHaveProperty('EE');
    expect(d.countries).toHaveProperty('LT');
    expect(d.countries.LV.series.length).toBeGreaterThan(0);
  });

  it('GET /api/baltic-compare?indicator=salary returns EUR/hour data', async () => {
    const r = await fetch(`${BASE}/api/baltic-compare?indicator=salary&years=3`);
    const d = await r.json();
    expect(d.unit).toBe('EUR/hour');
    // Values should be reasonable (5-40 EUR/h for Baltics)
    const latest = d.countries.EE.series.filter((s: { value: number | null }) => s.value !== null).pop();
    if (latest) {
      expect(latest.value).toBeGreaterThan(5);
      expect(latest.value).toBeLessThan(50);
    }
  });

  it('GET /api/baltic-compare?indicator=unknown returns 400', async () => {
    const r = await fetch(`${BASE}/api/baltic-compare?indicator=unicorn`);
    expect(r.status).toBe(400);
  });

  // No per-test timeout. `vitest.live.config.ts` sets 45s deliberately, and says
  // why: a slow answer from a warm-up request is worth waiting for, and a
  // genuinely dead endpoint fails long before that. This test used to override
  // it to 15s and was the only one that did, so it failed on a cold Free-tier
  // Function while every endpoint around it passed.
  //
  // That is worse than a slow suite. A check that fails for an identifiable
  // reason unrelated to the thing it tests teaches everyone to discount the
  // whole job -- and this suite runs post-deploy, where discounting it is
  // exactly how a real horizontal-overflow failure went unread from #84 until
  // somebody opened the site by hand. An intermittent red is not a small cost;
  // it is the cost of every other red in the same job.
  // Was: `expect(hasEstonia).toBe(true)`, asserting an insight mentions
  // Tallinn. Measured on clean master it ran RED, green, RED — not flake, but a
  // real defect it could not name. The city insights come from Open-Meteo,
  // which is intermittently unreachable from our egress, and the short list was
  // then cached for the full 15-minute TTL. Every `Age` above 800 carried two
  // insights; every one below 500 carried four.
  //
  // A test that is right about a defect and cannot say which one teaches
  // everyone to discount the job it runs in. So it now asserts the property
  // that is true either way: the capital's insights are present, **or** the
  // response names the source that was unavailable. Both states are acceptable;
  // being unable to tell them apart is not.
  it('GET /api/ai-insights?country=ee names Tallinn, or says what was unavailable', async () => {
    const r = await fetch(`${BASE}/api/ai-insights?country=ee`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d.insights.length).toBeGreaterThan(0);
    expect(Array.isArray(d.unavailable), 'the envelope must always carry the field').toBe(true);

    const hasEstonia = d.insights.some((i: { headline: string }) =>
      i.headline.includes('Tallinn')
    );
    // The city insights are air quality and weather; if neither arrived, the
    // response has to say so rather than simply being shorter.
    const explained = d.unavailable.length > 0;

    expect(
      hasEstonia || explained,
      'no Tallinn insight and nothing declared unavailable — the response is ' +
        'silently short, which is indistinguishable from not offering the insight'
    ).toBe(true);
  });

  it('GET /api/environment-data?country=lt returns capitalPopulation', async () => {
    const r = await fetch(`${BASE}/api/environment-data?country=lt`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d).toHaveProperty('capitalPopulation');
    expect(d).toHaveProperty('weather');
    expect(d).toHaveProperty('airQuality');
    // Weather array may have fewer entries if external APIs are slow
    expect(d.weather.length).toBeLessThanOrEqual(4);
  }, 30_000);

  it('GET /api/economy-data?country=ee returns electricity for Estonia', async () => {
    const r = await fetch(`${BASE}/api/economy-data?country=ee`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d).toHaveProperty('electricityCurrent');
    expect(d).toHaveProperty('exchangeRates');
  });

  // Not skipped. It was, for "slow — 7 parallel health checks", and both halves
  // of that justification have since expired: the endpoint carries 12 checks,
  // and the optional-probe budget in `statusChecks.js` capped the one that used
  // to hang. Measured over four samples it answers in 259-1086ms against a 45s
  // budget, so the cost it was avoiding is gone.
  //
  // What the skip cost, meanwhile, is the point. While it slept the response
  // moved from `sources` to `dataSources.checks`, and nothing noticed, because
  // a skipped test reports the same green as a passing one. `it.skip` is an
  // exemption written as a filter: it cannot fail when its own reason expires,
  // and it cannot notice the shape it asserts has drifted underneath it.
  //
  // So this asserts invariants rather than presence. `toHaveProperty` would
  // have passed on the day the field was renamed if some other `sources` had
  // existed, and passes today on a response where every tally is nonsense.
  it('GET /api/system-status reports internally consistent health', async () => {
    const r = await fetch(`${BASE}/api/system-status`);
    expect(r.ok).toBe(true);
    const d = await r.json();

    expect(d).toHaveProperty('status');
    expect(Array.isArray(d.dataSources?.checks)).toBe(true);
    expect(d.dataSources.checks.length).toBeGreaterThan(0);

    type Check = { name: string; status: string; required: boolean; freshness?: string };
    const checks: Check[] = d.dataSources.checks;

    // The server publishes its own tallies and the UI reads those, not the
    // array. If the two disagree, one of them is lying to a reader.
    expect(d.dataSources.total).toBe(checks.length);
    expect(d.dataSources.healthy).toBe(checks.filter((c) => c.status === 'healthy').length);
    expect(d.dataSources.stale).toBe(checks.filter((c) => c.freshness === 'stale').length);
    expect(d.dataSources.requiredTotal).toBe(checks.filter((c) => c.required).length);
    expect(d.dataSources.requiredHealthy).toBe(
      checks.filter((c) => c.required && c.status === 'healthy').length
    );

    // `overallStatus` does not exist -- the verdict is `status`, and it is
    // derived from the required checks alone, so an optional outage cannot
    // colour the page. Asserting the derivation is what makes a silent change
    // to it visible.
    const requiredAllHealthy =
      d.dataSources.requiredHealthy === d.dataSources.requiredTotal;
    expect(['healthy', 'degraded', 'unhealthy']).toContain(d.status);
    if (requiredAllHealthy) expect(d.status).toBe('healthy');

    // Every check names what it powers, so a red one is actionable rather than
    // a bare name a reader has to go and look up.
    for (const c of checks) {
      expect(typeof c.name).toBe('string');
      expect(c.name.length).toBeGreaterThan(0);
      expect(typeof c.required).toBe('boolean');
    }
  });
});
