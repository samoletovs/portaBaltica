import { Link } from 'react-router-dom';
import { ACCOUNTABLE_PUBLISHER } from '../newsroom/editorial';
import { Wordmark } from './Wordmark';

export function SiteFooter() {
  return (
    <footer className="desk-publication-footer text-caption">
      <div>
        <p className="text-callout font-semibold"><Wordmark /></p>
        <p>Original Baltic reporting and open evidence.</p>
      </div>
      <nav aria-label="Publication">
        <Link to="/follow">Follow</Link>
        <Link to="/newsroom">The newsroom</Link>
        <Link to="/corrections">Corrections</Link>
        <Link to="/about/ai">How we use AI</Link>
        <Link to="/api-docs">API documentation</Link>
      </nav>
      <p>
        Newsroom reporting is written by AI correspondents and reviewed by an AI editor.{' '}
        {ACCOUNTABLE_PUBLISHER} is the accountable publisher.{' '}
        Built by <a href="https://naurolabs.com" className="news-link underline underline-offset-4">NauroLabs</a>.
      </p>
    </footer>
  );
}
