import type { PortMeasure } from '../types';
import { PanelEmpty, PanelShell, MeasureHeadline, PortBars, PanelNote } from './PortPanelParts';

/**
 * Vessels arriving in each main port, per quarter.
 *
 * This replaces a panel that could only ever show *cancelled and rejected*
 * port calls, because that was the sole vessel-level thing Latvia's maritime
 * single window published as open data — and which then stopped publishing
 * anything at all. Eurostat's `mar_tf_qm` counts arrivals, which is the number
 * a reader assumed they were looking at in the first place, and it is the
 * freshest of the three maritime tables.
 */
export function VesselTrafficPanel({ measure }: { measure: PortMeasure }) {
  const title = 'Vessel Arrivals';

  if (measure.ports.length === 0 || !measure.latest) {
    return <PanelEmpty title={title} reason="No vessel traffic reported for these ports." />;
  }

  return (
    <PanelShell title={title}>
      <MeasureHeadline measure={measure} />
      <PortBars measure={measure} />
      <PanelNote measure={measure} table="mar_tf_qm" />
    </PanelShell>
  );
}
