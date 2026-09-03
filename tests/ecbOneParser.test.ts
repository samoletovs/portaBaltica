import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ecb = require('../api/shared/ecb.js');
const freshness = require('../api/shared/freshness.js');
const economy = require('../api/economy-data/index.js');

/**
 * One parser for the ECB daily reference-rate XML, and two distinct failures.
 *
 * Two faults lived here, neither of which needed the ECB to change anything:
 *
 *   1. `economy-data` and `freshness.js` each carried their own pattern for
 *      the same document, and the probe's was strictly more tolerant than the
 *      consumer's. The disagreement was therefore ORDERED: it could only ever
 *      produce a green status page beside an empty currency ticker.
 *
 *   2. `catch { return [] }` made "the ECB was unreachable" and "we could not
 *      read the document" one artefact, so nobody debugging an empty ticker
 *      could tell which had happened.
 *
 * The document below is the live file's real shape. Attribute quoting and
 * spacing carry no meaning in XML, so every reserialisation here is the same
 * data — which is what makes this a present-tense defect rather than a
 * prediction about a format change.
 */

const SINGLE_QUOTED = [
  "<?xml version='1.0' encoding='UTF-8'?>",
  "<gesmes:Envelope xmlns:gesmes='http://www.gesmes.org/xml/2002-08-01'>",
  '  <Cube>',
  "    <Cube time='2026-09-02'>",
  "      <Cube currency='USD' rate='1.1578'/>",
  "      <Cube currency='GBP' rate='0.85870'/>",
  "      <Cube currency='SEK' rate='11.1575'/>",
  '    </Cube>',
  '  </Cube>',
  '</gesmes:Envelope>',
].join('\n');

// Valid XML for the identical data: double quotes, and `rate` before
// `currency` on one row. Nothing about the meaning has changed.
const RESERIALISED = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">',
  '  <Cube>',
  '    <Cube time="2026-09-02">',
  '      <Cube currency="USD" rate="1.1578"/>',
  '      <Cube rate="0.85870"  currency="GBP"/>',
  '      <Cube currency="SEK" rate="11.1575"/>',
  '    </Cube>',
  '  </Cube>',
  '</gesmes:Envelope>',
].join('\n');

/** An `https.get` that serves one document, so `fetchECBRates` can be driven. */
function serving(xml: string) {
  const https = require('https');
  vi.spyOn(https, 'get').mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1] as (r: unknown) => void;
    const res = {
      statusCode: 200,
      resume: () => {},
      on: (evt: string, fn: (chunk?: string) => void) => {
        if (evt === 'data') fn(xml);
        if (evt === 'end') fn();
        return res;
      },
    };
    setTimeout(() => cb(res), 0);
    return { on: () => ({}), destroy: () => {} };
  }) as never);
}

describe('the ECB document has one parser', () => {
  it('reads the live shape exactly as the old bespoke patterns did', () => {
    const parsed = ecb.parseDaily(SINGLE_QUOTED);
    expect(parsed.referenceDate).toBe('2026-09-02');
    expect(parsed.rates).toEqual({ USD: 1.1578, GBP: 0.8587, SEK: 11.1575 });
  });

  /**
   * The regression that mattered, stated as the property rather than as a
   * format prediction: the date and the rates must never disagree about
   * whether the document is readable.
   *
   * Before the fix, `freshness.extract.ecbXml` returned a date from this input
   * while `fetchECBRates` returned nothing from it. That is the false green.
   */
  it('never yields a reference date from a document it cannot read rates from', () => {
    for (const xml of [SINGLE_QUOTED, RESERIALISED]) {
      const parsed = ecb.parseDaily(xml);
      const hasRates = Object.keys(parsed.rates).length > 0;
      const hasDate = parsed.referenceDate !== null;
      expect(hasRates, 'rates and date must agree about readability').toBe(hasDate);
    }
  });

  it('parses a valid reserialisation the old consumer pattern could not', () => {
    // The old consumer regex, verbatim, for contrast. It is the control: it
    // must succeed on the live shape and fail on the reserialisation, or this
    // test is asserting nothing about the change.
    const oldPattern = (xml: string, code: string) =>
      new RegExp("currency='" + code + "' rate='([\\d.]+)'").test(xml);

    expect(oldPattern(SINGLE_QUOTED, 'USD'), 'CONTROL: the old pattern worked on the live shape').toBe(true);
    expect(oldPattern(RESERIALISED, 'USD'), 'CONTROL: and could not read this one').toBe(false);

    expect(ecb.parseDaily(RESERIALISED).rates).toEqual({ USD: 1.1578, GBP: 0.8587, SEK: 11.1575 });
  });

  it('drops a rate that is not a finite number rather than serving NaN', () => {
    const xml = SINGLE_QUOTED.replace("rate='1.1578'", "rate='n/a'");
    const parsed = ecb.parseDaily(xml);
    expect(parsed.rates.USD).toBeUndefined();
    expect(parsed.rates.GBP, 'the other rows still parse').toBe(0.8587);
  });

  it('returns an empty answer, not a throw, for something that is not the document', () => {
    for (const junk of ['<html>gateway timeout</html>', '', null, undefined]) {
      const parsed = ecb.parseDaily(junk as string);
      expect(parsed).toEqual({ referenceDate: null, rates: {} });
    }
  });

  it('is the parser freshness.js uses, rather than a second implementation', () => {
    // Delegation is the guarantee. If `freshness.js` grew its own pattern
    // again it could disagree with the consumer, which is the whole defect.
    expect(freshness.extract.ecbXml(SINGLE_QUOTED)).toEqual({ at: '2026-09-02T23:59:59Z' });
    expect(freshness.extract.ecbXml(RESERIALISED)).toEqual({ at: '2026-09-02T23:59:59Z' });
    expect(freshness.extract.ecbXml('<html>nope</html>')).toBeNull();
  });
});

describe('an empty currency ticker says which emptiness it is', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  /**
   * `fetchECBRates` returns `[]` for two different facts. Both render as an
   * absent ticker, so the log line is the only thing that separates them --
   * and they call for different work: an outage is waited out, a shape change
   * is followed. This is the same argument `optionalCount` makes one screen
   * below, about `null` rather than `0`; it had never been applied here.
   */
  it('names the reason when the ECB cannot be reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const https = require('https');
    vi.spyOn(https, 'get').mockImplementation(((...args: unknown[]) => {
      void args;
      const req = {
        on: (evt: string, fn: (e: Error) => void) => {
          if (evt === 'error') setTimeout(() => fn(new Error('ECONNREFUSED')), 0);
          return req;
        },
        destroy: () => {},
      };
      return req;
    }) as never);

    const rates = await economy.fetchECBRates();

    expect(rates).toEqual([]);
    const said = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(said, 'the reason must reach the log').toMatch(/ECB exchange rates unavailable/i);
    expect(said, 'and it must be the transport failure, not a parse failure').toMatch(/ECONNREFUSED/);
    expect(said, 'a transport failure is not a shape change').not.toMatch(/document shape/i);
  });

  it('distinguishes a document it could not read from one it could not fetch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    serving('<html>gateway error</html>');

    const rates = await economy.fetchECBRates();

    expect(rates).toEqual([]);
    const said = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(said, 'a readable-but-unparseable document is its own fact').toMatch(/parsed no rates/i);
    expect(said, 'and it reports what it did receive').toMatch(/\d+ bytes/);
  });
});

describe('the probe cannot report green while the ticker would be empty', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  /**
   * THE SEAM, and the assertion that fails without this change.
   *
   * This is the invariant the two bespoke parsers violated: whenever the
   * freshness probe can date the document, the consumer must be able to read
   * rates from it. Before the fix, `RESERIALISED` — valid XML for identical
   * data — produced a reference date and **zero** rates, so the status page
   * reported the ECB healthy while the currency ticker rendered nothing.
   *
   * It is asserted across both serialisations rather than on the broken one
   * alone, so the live shape is the control: if the probe stopped dating the
   * ordinary document this would fail too, rather than passing on an empty set.
   */
  it('dates a document only when the consumer can read rates from it', async () => {
    for (const [label, xml] of [['live shape (CONTROL)', SINGLE_QUOTED], ['reserialised', RESERIALISED]] as const) {
      vi.restoreAllMocks();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      serving(xml);

      const dated = freshness.extract.ecbXml(xml) !== null;
      const rates = await economy.fetchECBRates();

      expect(dated, `${label}: the probe must be able to date this`).toBe(true);
      expect(rates.length, `${label}: a green probe implies a populated ticker`).toBeGreaterThan(0);
    }
  });

  /**
   * And the probe refuses a document that dates but carries no rates.
   *
   * One parser makes the two sides agree about *readability*; this covers the
   * remaining state, which is reachable without any format change at all — a
   * well-formed envelope with a date and an empty rate set. The consumer would
   * render nothing from it, so the probe must not call it healthy.
   */
  it('refuses a well-formed document that carries no rates', async () => {
    const es = require('../api/shared/eurostat.js');
    const status = require('../api/system-status/index.js');
    const check = { type: 'ecb-xml', url: 'https://example.invalid/eurofxref-daily.xml' };

    const datedButEmpty = [
      "<gesmes:Envelope xmlns:gesmes='http://www.gesmes.org/xml/2002-08-01'>",
      '  <Cube>',
      "    <Cube time='2026-09-02'>",
      '    </Cube>',
      '  </Cube>',
      '</gesmes:Envelope>',
    ].join('\n');

    const original = es.httpText;
    try {
      // CONTROL first: the ordinary document must still probe clean, or the
      // rejection below is a probe that refuses everything.
      es.httpText = () => Promise.resolve(SINGLE_QUOTED);
      await expect(status.probe(check), 'CONTROL: the live shape still probes clean')
        .resolves.toEqual({ at: '2026-09-02T23:59:59Z' });

      es.httpText = () => Promise.resolve(datedButEmpty);
      await expect(status.probe(check)).rejects.toThrow(/no readable rates/i);
    } finally {
      es.httpText = original;
    }
  });

  /**
   * And the whole chain, because "the probe refuses it" is only half the claim.
   *
   * The point of one parser was that a green cannot outlive the ticker. That is
   * a statement about the *published verdict*, not about an internal throw, so
   * it is asserted end-to-end: the real registry entry, through
   * `runRegistryCheck`, into `overallStatus`.
   *
   * `ECB Exchange Rates` is `required: true`, so an unhealthy reading reaches
   * the site verdict rather than being absorbed the way an optional source is.
   */
  it('turns a parse failure into a published red, not just an internal throw', async () => {
    const es = require('../api/shared/eurostat.js');
    const status = require('../api/system-status/index.js');
    const registry = require('../api/shared/statusChecks.js');

    const ecbCheck = registry.CHECKS.find((c: { name: string }) => c.name === 'ECB Exchange Rates');
    expect(ecbCheck, 'the registry entry must exist for this to mean anything').toBeTruthy();
    expect(ecbCheck.required, 'and it must be required, or the verdict cannot move').toBe(true);

    const datedButEmpty = [
      "<gesmes:Envelope xmlns:gesmes='http://www.gesmes.org/xml/2002-08-01'>",
      "  <Cube><Cube time='2026-09-02'></Cube></Cube>",
      '</gesmes:Envelope>',
    ].join('\n');

    const original = es.httpText;
    try {
      // CONTROL: the ordinary document publishes healthy, so the red below is
      // about this document rather than about the probe refusing everything.
      es.httpText = () => Promise.resolve(SINGLE_QUOTED);
      const good = await status.runRegistryCheck(ecbCheck, new Date(), Date.now());
      expect(good.status, 'CONTROL: the live shape is healthy').toBe('healthy');

      es.httpText = () => Promise.resolve(datedButEmpty);
      const bad = await status.runRegistryCheck(ecbCheck, new Date(), Date.now());

      expect(bad.status, 'a document the ticker cannot use is not healthy').toBe('unhealthy');
      expect(status.overallStatus([bad]), 'and it reaches the published verdict')
        .not.toBe('healthy');
    } finally {
      es.httpText = original;
    }
  });
});
