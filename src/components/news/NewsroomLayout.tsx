import { Link, Outlet, useLocation } from 'react-router-dom';
import { ACCOUNTABLE_PUBLISHER } from '../../newsroom/editorial';

export function NewsroomLayout() {
  const { pathname } = useLocation();
  const isFrontPage = pathname === '/';

  return (
    <div className="desk-newsroom">
      <main id="main" className={isFrontPage ? 'desk-front-page' : 'desk-reading-page'}>
        {!isFrontPage && pathname !== '/briefings' && (
          <p className="desk-disclosure text-caption">
            Written by AI correspondents, reviewed by an AI editor. {ACCOUNTABLE_PUBLISHER} accountable.{' '}
            <Link to="/about/ai" className="news-link underline underline-offset-4">What that means</Link>
          </p>
        )}
        <Outlet />
      </main>
    </div>
  );
}
