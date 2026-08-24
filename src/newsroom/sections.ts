import type { DashboardSection } from '../types';

/** Display names for the dashboard sections an article can belong to. */
export const SECTION_LABELS: Record<DashboardSection, string> = {
  economy: 'Economy',
  trade: 'Trade',
  government: 'Government',
  labour: 'Labour',
  energy: 'Energy',
  property: 'Property',
  environment: 'Environment',
  maritime: 'Maritime',
  business: 'Business',
};
