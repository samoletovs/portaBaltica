import { useSearchParams } from 'react-router-dom';
import { ResearchWorkspace } from './ResearchWorkspace';
import { DASHBOARD_SECTIONS, type DashboardSection } from '../sections';
import { usePageMeta } from '../newsroom/usePageMeta';

const SECTORS: ReadonlySet<string> = new Set(DASHBOARD_SECTIONS);

export function DataExplorerPage() {
  const [params] = useSearchParams();
  const requested = params.get('section');
  const section = requested && SECTORS.has(requested) ? requested as DashboardSection : 'all';
  usePageMeta({
    title: 'Data explorer | portaBaltica',
    description: 'Explore one Baltic indicator in depth: compare countries, inspect reporting periods, switch between charts and exact values, and download source-linked data.',
    canonicalPath: '/explore',
  });
  return <main id="main"><ResearchWorkspace section={section} /></main>;
}
