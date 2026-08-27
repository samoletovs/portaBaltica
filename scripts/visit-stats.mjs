/**
 * Turn Azure Monitor's hourly `SiteHits` series into the counts the status
 * panel shows.
 *
 * WHAT THE NUMBER MEANS, because this is the part that is easy to get wrong in
 * a way nobody notices. `SiteHits` counts every HTTP request the Static Web App
 * serves. This dashboard is a single-page app, so one person arriving produces
 * one HTML document plus its JavaScript, CSS, fonts and images — a dozen or
 * more requests. The figure is therefore *requests*, not visits and not page
 * views, and it is labelled that way at every point it surfaces. Calling it
 * "visits" would overstate traffic by whatever the asset-per-page ratio happens
 * to be that week: a number that looks entirely reasonable and means something
 * else, which is the failure mode this repository keeps writing post-mortems
 * about.
 *
 * Azure Monitor retains metrics for 93 days, so there is no all-time total to
 * report and none is invented. Only windows that can be stood behind are
 * emitted.
 *
 * WHY THE DAY BOUNDARY IS THE INTERESTING PART. "Today" means today *in Riga*,
 * because that is where the readers are, and Riga is UTC+2 or UTC+3 depending
 * on the month. Azure returns UTC timestamps. Bucketing those straight into UTC
 * days puts every request between local midnight and 02:00 or 03:00 on the
 * wrong side of the boundary — a plausible figure, one day out, for two to
 * three hours out of every twenty-four, and no test would notice because the
 * number is never absurd. So the hourly series is converted to Europe/Riga
 * before its date is taken, and `tests/visitStats.test.ts` hands this function
 * a series that straddles the boundary in both offsets.
 *
 * The aggregation is a pure function of its input so that it can be tested
 * without Azure, a network, or a clock.
 */

const SITE_TIME_ZONE = 'Europe/Riga';

/** Azure Monitor's retention ceiling. Asking beyond it silently returns less. */
export const RETENTION_DAYS = 93;

/**
 * The local calendar date of an instant, as `YYYY-MM-DD`.
 *
 * `en-CA` is chosen because it formats as ISO, which avoids assembling the
 * string from parts and getting the zero-padding wrong.
 */
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SITE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function localDate(instant) {
  return dateFormatter.format(instant instanceof Date ? instant : new Date(instant));
}

/**
 * Step a `YYYY-MM-DD` string back by whole calendar days.
 *
 * Anchored at UTC midnight deliberately: this is calendar arithmetic on a date
 * that has already been resolved to Riga, so it must not be re-interpreted in
 * any zone. Anchoring in local time would make the arithmetic skip or repeat a
 * day across a DST transition.
 */
export function shiftDate(isoDate, days) {
  const anchor = new Date(`${isoDate}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

/**
 * Collapse every hourly bucket in an Azure Monitor payload into Riga days.
 *
 * Hours in which nothing was served arrive with no `total` field at all rather
 * than a zero, and they are skipped rather than counted as zero. Summing a
 * missing hour as zero is arithmetically identical; *recording* the day as
 * observed when every one of its hours was missing is not, because it turns
 * "Azure has no data for this day" into "no traffic on this day". The
 * `observedFrom`/`observedTo` range below is only honest if absent means absent.
 */
export function dailyTotals(payload) {
  const byDay = new Map();

  for (const metric of payload?.value ?? []) {
    for (const series of metric?.timeseries ?? []) {
      for (const point of series?.data ?? []) {
        if (point?.total === undefined || point.total === null) continue;
        const day = localDate(point.timeStamp);
        byDay.set(day, (byDay.get(day) ?? 0) + Number(point.total));
      }
    }
  }

  return byDay;
}

/**
 * Build the summary that gets published.
 *
 * Windows are inclusive of today and counted in whole local days, so "last 7
 * days" is today plus the six before it. A 168-hour sliding window would be
 * defensible in isolation but would disagree with the daily figure printed
 * beside it, and two numbers that cannot both be right is worse than either.
 */
export function summarise(payload, now = new Date()) {
  const byDay = dailyTotals(payload);
  const today = localDate(now);

  const windowTotal = (days) => {
    const first = shiftDate(today, -(days - 1));
    let total = 0;
    for (const [day, hits] of byDay) {
      if (day >= first && day <= today) total += hits;
    }
    return Math.round(total);
  };

  const observed = [...byDay.keys()].sort();
  const last30 = windowTotal(30);

  return {
    metric: 'SiteHits',
    // The unit travels with the data rather than living only in whichever
    // component happens to render it.
    unit: 'requests',
    today: windowTotal(1),
    last7Days: windowTotal(7),
    last30Days: last30,
    dailyAverage30d: Math.round((last30 / 30) * 10) / 10,
    timezone: SITE_TIME_ZONE,
    retentionDays: RETENTION_DAYS,
    observedFrom: observed[0] ?? null,
    observedTo: observed[observed.length - 1] ?? null,
    generatedAt: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

/* c8 ignore start -- CLI wiring, exercised by the workflow rather than by unit tests */
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') ||
    process.argv[1]?.endsWith('visit-stats.mjs')) {
  const [, , inputPath, outputPath] = process.argv;

  if (!inputPath) {
    console.error('usage: visit-stats.mjs <az-metrics.json> [out.json]');
    process.exit(2);
  }

  const { readFileSync, writeFileSync } = await import('node:fs');
  const payload = JSON.parse(readFileSync(inputPath, 'utf-8'));
  const rendered = `${JSON.stringify(summarise(payload), null, 2)}\n`;

  if (outputPath) writeFileSync(outputPath, rendered);
  else process.stdout.write(rendered);
}
/* c8 ignore stop */
