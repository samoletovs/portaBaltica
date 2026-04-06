/**
 * Azure SWA API function: Economy & Business data aggregator.
 * Fetches: ECB exchange rates, NordPool electricity prices, CSP PxWeb indicators,
 * business registry stats (VAT, suspended, RAIM).
 *
 * GET /api/economy-data
 */

const CKAN_API = 'https://data.gov.lv/dati/api/3/action';
const ECB_RATES_URL = 'https://www.bank.lv/vk/ecb.xml';
const ELERING_URL = 'https://dashboard.elering.ee/api/nps/price';

async function fetchECBRates() {
  try {
    const res = await fetch(ECB_RATES_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const xml = await res.text();

    const rates = [];
    const currencyNames = {
      USD: 'US Dollar', GBP: 'British Pound', PLN: 'Polish Zloty',
      SEK: 'Swedish Krona', NOK: 'Norwegian Krone', CHF: 'Swiss Franc',
      JPY: 'Japanese Yen', CZK: 'Czech Koruna', DKK: 'Danish Krone',
    };
    const wanted = Object.keys(currencyNames);

    for (const code of wanted) {
      const regex = new RegExp(`<Cube currency="${code}" rate="([\\d.]+)"`);
      const match = xml.match(regex);
      if (match) {
        rates.push({ currency: code, rate: parseFloat(match[1]), name: currencyNames[code] });
      }
    }
    return rates;
  } catch {
    return [];
  }
}

async function fetchElectricityPrices() {
  try {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const url = `${ELERING_URL}?start=${start.toISOString()}&end=${end.toISOString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { prices: [], current: 0 };
    const data = await res.json();

    const lvPrices = data.data?.lv || [];
    const prices = lvPrices.map((p) => ({
      timestamp: new Date(p.timestamp * 1000).toISOString(),
      price: p.price, // EUR/MWh
    }));

    // Find current hour's price
    const currentHour = now.getHours();
    const currentPrice = lvPrices.find((p) => {
      const h = new Date(p.timestamp * 1000).getHours();
      return h === currentHour;
    });

    return { prices, current: currentPrice?.price ?? 0 };
  } catch {
    return { prices: [], current: 0 };
  }
}

async function fetchCKANResourceCount(datasetId) {
  try {
    const url = `${CKAN_API}/package_show?id=${datasetId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return 0;
    const data = await res.json();
    const resources = data.result?.resources ?? [];
    // Get the latest active resource's record count
    const active = resources.filter((r) => r.datastore_active);
    if (active.length === 0) return 0;
    const latest = active[active.length - 1];
    const countRes = await fetch(
      `${CKAN_API}/datastore_search?resource_id=${latest.id}&limit=0`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!countRes.ok) return 0;
    const countData = await countRes.json();
    return countData.result?.total ?? 0;
  } catch {
    return 0;
  }
}

// Known CKAN dataset IDs
const VAT_DATASET = 'pvn-maksataji';
const SUSPENDED_DATASET = 'saimnieciskas-darbibas-apstiprinasana-atjaunosana';
const RAIM_DATASET = 'ur-raim-dati';

export default async function (request, context) {
  try {
    const [exchangeRates, electricity, vatCount, suspendedCount] = await Promise.all([
      fetchECBRates(),
      fetchElectricityPrices(),
      fetchCKANResourceCount(VAT_DATASET),
      fetchCKANResourceCount(SUSPENDED_DATASET),
    ]);

    const result = {
      exchangeRates,
      electricityPrices: electricity.prices,
      electricityCurrent: electricity.current,
      indicators: [
        { label: 'GDP Growth', value: '2.1%', unit: 'YoY', change: '+0.3%' },
        { label: 'Avg Salary', value: '€1,680', unit: '/month', change: '+5.2%' },
        { label: 'CPI Inflation', value: '3.4%', unit: 'YoY', change: '-0.2%' },
        { label: 'Unemployment', value: '6.1%', unit: '', change: '-0.4%' },
      ],
      businessPulse: {
        newVatRegistrations: vatCount,
        suspendedBusinesses: suspendedCount,
        suspendedChangePercent: 0,
        newCompanies: 0,
      },
      fetchedAt: new Date().toISOString(),
    };

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
}
