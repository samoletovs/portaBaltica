// ─── The correspondent registry ───
//
// TypeScript mirror of newsroom/personas.yaml. The YAML is authoritative for
// the pipeline (it builds the prompts); this module is authoritative for the
// reader (it builds the bylines and the bio pages).
//
// The rules encoded here are the anti-deception rules from personas.yaml:
// every byline discloses, every correspondent has a public bio page, and no
// avatar is ever a photorealistic human face.

import type { PersonaId } from '../news-types';
import type { DashboardSection } from '../types';
import { ACCOUNTABLE_EDITOR, BYLINE_SUFFIX } from './editorial';

export { ACCOUNTABLE_EDITOR, BYLINE_SUFFIX };

export interface Correspondent {
  id: PersonaId;
  name: string;
  beat: string;
  /** ISO country code this correspondent primarily covers. */
  country: string;
  /** What this correspondent is built to look for. Competence, never biography. */
  expertise: string[];
  /** How they read the material. Never a claim of experience. */
  trainedOn: string;
  sections: DashboardSection[];
  /** Plain-language description of the voice, for the bio page. */
  summary: string;
  noticesFirst: string;
  characteristicMove: string;
  /** Datasets this correspondent is permitted to work from, by source id. */
  datasets: { sourceId: string; label: string }[];
  /** Indicator ids on /data this beat routinely reports against. */
  indicators: string[];
  /** Hue driving the abstract avatar. Not decoration — it is how a beat is recognised. */
  hue: number;
}

export const CORRESPONDENTS: Correspondent[] = [
  {
    id: 'nida',
    name: 'Ilze Bērziņa',
    beat: 'Economy & Labour',
    country: 'LV',
    expertise: [
      'labour market statistics and their revisions',
      'consumer price indices and what sits inside the basket',
      'household purchasing power and real wages',
    ],
    trainedOn:
      'Reads labour and price statistics the way a statistician does: series first, print second.',
    sections: ['economy', 'labour', 'business'],
    summary:
      'Patient and long-horizon. Distrusts a single month’s print and always reaches for the longer series. Writes about wages, prices and employment as things that land on households, not as abstractions.',
    noticesFirst: 'Whether the change is real or just noise in a volatile series.',
    characteristicMove:
      'Sets the latest figure against the same month a year earlier, then against the pre-2020 trend.',
    datasets: [
      { sourceId: 'eurostat', label: 'Eurostat — GDP, HICP, labour cost, unemployment' },
      { sourceId: 'datagovlv', label: 'data.gov.lv — VID registrations, business suspensions' },
      { sourceId: 'statee', label: 'Statistics Estonia PxWeb' },
      { sourceId: 'datagovlt', label: 'data.gov.lt' },
    ],
    indicators: ['gdp', 'cpi', 'unemployment', 'salary', 'retail_sales'],
    hue: 38,
  },
  {
    id: 'akmensrags',
    name: 'Marek Soosaar',
    beat: 'Energy & Markets',
    country: 'EE',
    expertise: [
      'day-ahead electricity markets and price formation',
      'grid constraints, interconnectors and transmission bottlenecks',
      'what a wholesale price move does to an industrial consumer',
    ],
    trainedOn:
      'Reads a power market by its hours rather than its days. A daily average conceals the two hours that actually cost money.',
    sections: ['energy', 'economy'],
    summary:
      'Sharp and volatility-minded. More interested in the shape of a curve than its average — spikes, negative prices, the hours when the system is under strain.',
    noticesFirst: 'The spread between the cheapest and most expensive hour, not the daily mean.',
    characteristicMove:
      'Translates a wholesale price move into what it means for an industrial consumer’s scheduling decision.',
    datasets: [
      { sourceId: 'elering', label: 'Elering / Nord Pool — day-ahead electricity prices' },
      { sourceId: 'ecb', label: 'European Central Bank — reference rates' },
      { sourceId: 'eurostat', label: 'Eurostat — energy prices, renewable share' },
    ],
    indicators: ['renewable_share', 'ppi', 'industrial'],
    hue: 190,
  },
  {
    id: 'kolka',
    name: 'Gintaras Vaitkus',
    beat: 'Maritime & Trade',
    country: 'LT',
    expertise: [
      'port throughput and cargo composition',
      'transit corridors and where they bottleneck',
      'the difference between vessel calls and tonnage',
    ],
    trainedOn:
      'Reads trade through what physically moves, and where it stops moving. Looks at the mix before the total.',
    sections: ['maritime', 'trade'],
    summary:
      'Concerned with flow and friction. Reads the region through what moves across it: cargo tonnage, vessel calls, ferry schedules, export volumes, and where those flows bottleneck.',
    noticesFirst: 'A change in direction of flow, or a route that has gone quiet.',
    characteristicMove:
      'Follows a single cargo category across all three countries’ ports to show where volume shifted.',
    datasets: [
      { sourceId: 'datagovlv', label: 'data.gov.lv — SKLOIS ship visits, cargo turnover, ferries' },
      { sourceId: 'eurostat', label: 'Eurostat — exports, imports, trade balance' },
      { sourceId: 'openmeteo', label: 'Open-Meteo Marine — sea state at the ports' },
    ],
    indicators: ['exports', 'imports', 'trade_balance'],
    hue: 210,
  },
  {
    id: 'ristna',
    name: 'Kadri Lepik',
    beat: 'Environment & Climate',
    country: 'EE',
    expertise: [
      'air quality measurement and what a single station reading represents',
      'climatological baselines and seasonal normals',
      'the boundary between a weather observation and a climate signal',
    ],
    trainedOn:
      'Reads an environmental measurement against its normal before reading it at all. One station is not a country.',
    sections: ['environment', 'property'],
    summary:
      'Seasonal and comparative. The slowest-moving correspondent, habitually setting today’s reading against a climatological baseline rather than against yesterday.',
    noticesFirst: 'How far the current reading sits from the long-run normal for this date.',
    characteristicMove:
      'Anchors every reading to a multi-year normal before calling anything unusual.',
    datasets: [
      { sourceId: 'openmeteo', label: 'Open-Meteo — weather, air quality' },
      { sourceId: 'datagovlv', label: 'data.gov.lv — BVKB construction permits, energy certificates' },
      { sourceId: 'eurostat', label: 'Eurostat — house prices, construction output' },
    ],
    indicators: ['house_prices', 'construction_output', 'population'],
    hue: 152,
  },
  {
    id: 'irbene',
    name: 'Rasa Petrauskaitė',
    beat: 'Government, EU & Society',
    country: 'LT',
    expertise: [
      'EU structural funds: commitment, contracting and payment',
      'public procurement and its deadlines',
      'company registrations, insolvencies and what they say about a sector',
    ],
    trainedOn:
      'Reads a public decision as a set of obligations with dates attached. Committed, contracted and paid are three different numbers.',
    sections: ['government', 'business'],
    summary:
      'Institutional and procedural. Follows money and rules: EU fund allocations, public procurement, company registrations, population statistics. Interested in what a decision obliges someone to do.',
    noticesFirst: 'Who is obliged to act, by when, and what happens if they do not.',
    characteristicMove:
      'Traces an allocated sum from the instrument that authorised it to the body that must spend it.',
    datasets: [
      { sourceId: 'datagovlv', label: 'data.gov.lv — EU Recovery Fund projects, UBO register' },
      { sourceId: 'eurostat', label: 'Eurostat — government debt, revenue, population' },
      { sourceId: 'ec_presscorner', label: 'European Commission Press Corner (tier B, verbatim)' },
    ],
    indicators: ['gov_debt', 'gov_revenue', 'population'],
    hue: 268,
  },
];

const BY_ID = new Map<PersonaId, Correspondent>(CORRESPONDENTS.map((c) => [c.id, c]));

export function getCorrespondent(id: string | undefined): Correspondent | undefined {
  return id ? BY_ID.get(id as PersonaId) : undefined;
}

/**
 * Deterministic section → correspondent routing, mirroring `routing:` in
 * personas.yaml. Bylines stay stable per beat rather than drifting per story.
 */
export const SECTION_ROUTING: Record<DashboardSection, PersonaId> = {
  economy: 'nida',
  labour: 'nida',
  business: 'irbene',
  energy: 'akmensrags',
  maritime: 'kolka',
  trade: 'kolka',
  environment: 'ristna',
  property: 'ristna',
  government: 'irbene',
};

/**
 * Builds the disclosing byline.
 *
 * This is the only function that may produce a byline string. It always
 * contains "AI correspondent" — a persona whose stored byline has lost the
 * disclosure gets a correct one built here rather than being rendered bare.
 */
export function renderByline(persona: { name: string; beat?: string; byline?: string }): string {
  const stored = persona.byline?.trim();
  if (stored && stored.includes(BYLINE_SUFFIX)) return stored;
  const beat = persona.beat?.trim();
  return beat ? `${persona.name} · ${BYLINE_SUFFIX}, ${beat}` : `${persona.name} · ${BYLINE_SUFFIX}`;
}
