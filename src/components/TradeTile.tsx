import { IndicatorCard } from './IndicatorCard';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';
import { FreightModalSplit } from './FreightModalSplit';
import { TradePartnersPanel } from './TradePartnersPanel';
import { TileHeader } from './TileHeader';

export function TradeTile() {
  const { countryLabel, flag } = useCountry();
  return (
    <section>
      <TileHeader title="Trade & tourism" meta={`${flag} ${countryLabel} · Eurostat`} />

      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <IndicatorCard id="exports" title="Exports" unit="M EUR" />
          <IndicatorCard id="imports" title="Imports" unit="M EUR" />
          <IndicatorCard id="trade_balance" title="Trade balance" unit="M EUR" />
          <IndicatorCard id="ppi" title="Producer prices" unit="% YoY" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <IndicatorCard id="hotel_occupancy" title="Hotel occupancy" unit="%" />
          <IndicatorCard id="tourist_arrivals" title="Tourist arrivals" unit="thousands" />
        </div>

        {/* Partner and commodity detail behind the export and import headlines
            above. Those come from Eurostat and are totals; this is CSP's CN-8
            customs data and is the only thing on the tile that can say to whom
            and of what. Latvia only, and it says so — the source is a national
            dataset and does not follow the country selector. */}
        <TradePartnersPanel />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BalticCompareChart indicator="exports" title="Exports of goods" compact />
          <BalticCompareChart indicator="imports" title="Imports of goods" compact />
          <BalticCompareChart indicator="trade_balance" title="Trade balance across the Baltics" compact />
          {/* Replaces the goods-balance and services-balance charts. Those were
              two of five balance-of-payments series on one tile saying versions
              of the same thing; this says something none of them did, and
              something most readers would guess the wrong way round. */}
          <FreightModalSplit compact />
          {/* Rail and road volumes behind the modal split above. Both in
              tonne-kilometres would be the comparable pair, but `road_freight`
              is the tonnes-lifted series and belongs here on its own terms —
              how much is carried is a different question from how far. */}
          <BalticCompareChart indicator="rail_freight" title="Rail freight volume" compact />
          <BalticCompareChart indicator="road_freight" title="Road freight lifted" compact />
          <BalticCompareChart indicator="transport_services" title="Transport services balance" compact />
          <BalticCompareChart indicator="financial_services" title="Financial services balance" compact />
          <BalticCompareChart indicator="tourism_foreign" title="Nights spent by foreign visitors" compact />
          <BalticCompareChart indicator="tourism" title="Tourist arrivals across the Baltics" compact />
          <BalticCompareChart indicator="air_passengers" title="Air passengers carried" compact />
        </div>
      </div>
    </section>
  );
}