import { useParams } from 'react-router-dom';
import { ResearchWorkspace } from './ResearchWorkspace';

export function IndicatorPage() {
  const { id } = useParams<{ id: string }>();
  return <main id="main"><ResearchWorkspace indicatorId={id ?? ''} /></main>;
}
