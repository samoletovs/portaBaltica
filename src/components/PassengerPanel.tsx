import type { PortMeasure } from '../types';
import { PanelEmpty, PanelShell, MeasureHeadline, PortBars, PanelNote, DormantPorts } from './PortPanelParts';

/**
 * Sea passengers embarked and disembarked at each main port, per quarter.
 *
 * Excludes cruise passengers, which is a property of Eurostat's table rather
 * than a choice made here.
 *
 * Only ports that reported in the displayed quarter are drawn. Riga has filed
 * nothing since 2021, when the Stockholm route ended, so it is absent rather
 * than pinned at zero — and the distinction matters, because Eurostat does
 * publish real zeroes elsewhere and those *are* shown. Carrying a port's
 * last-known figure forward next to current ones would be the worse failure:
 * a four-year-old number formatted identically to this quarter's.
 *
 * `DormantPorts` then says which ports that removed, and when each last
 * reported. Silently dropping Latvia's main passenger port leaves a reader
 * believing Ventspils is the whole story.
 */
export function PassengerPanel({ measure }: { measure: PortMeasure }) {
  const title = 'Passenger Traffic';

  if (measure.ports.length === 0 || !measure.latest) {
    return <PanelEmpty title={title} reason="No sea passenger traffic reported for these ports." />;
  }

  return (
    <PanelShell title={title}>
      <MeasureHeadline measure={measure} />
      <PortBars measure={measure} />
      <DormantPorts measure={measure} />
      <p className="text-caption text-slate-500 mt-2">Excludes cruise passengers.</p>
      <PanelNote measure={measure} table="mar_pa_qm" />
    </PanelShell>
  );
}
