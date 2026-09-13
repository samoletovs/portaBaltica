import { Link } from 'react-router-dom';
import { ACCOUNTABLE_PUBLISHER } from '../../newsroom/editorial';
import { PageIntro } from '../PageIntro';

export function SignalDeskIntro() {
  return (
    <PageIntro
      className="folio-edition-header"
      title={<>The Baltic <span className="news-accent">journal</span></>}
      lead="The region behind the numbers. Original reporting and open evidence from Latvia, Estonia and Lithuania."
      aside={<p className="folio-edition-tagline text-prose news-subtle">Three countries.<br />A wider perspective.</p>}
    >
        <p className="text-caption news-subtle">
          Written by AI correspondents, reviewed by an AI editor. {ACCOUNTABLE_PUBLISHER} accountable.{' '}
          <Link to="/about/ai" className="news-link underline underline-offset-4">What that means</Link>
        </p>
    </PageIntro>
  );
}
