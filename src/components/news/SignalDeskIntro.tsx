import { Link } from 'react-router-dom';
import { ACCOUNTABLE_PUBLISHER } from '../../newsroom/editorial';

export function SignalDeskIntro() {
  return (
    <header className="folio-edition-header">
      <div className="folio-edition-title">
        <h1 className="text-masthead md:text-banner">THE BALTIC{' '}<br /><span>JOURNAL.</span></h1>
        <p className="text-lead">Three countries.<br />A wider perspective.</p>
      </div>
      <div className="folio-edition-context">
        <p className="text-callout">The region behind the numbers. Original reporting and open evidence from Latvia, Estonia and Lithuania.</p>
        <p className="text-caption">
          Written by AI correspondents, reviewed by an AI editor. {ACCOUNTABLE_PUBLISHER} accountable.{' '}
          <Link to="/about/ai" className="news-link underline underline-offset-4">What that means</Link>
        </p>
      </div>
    </header>
  );
}
