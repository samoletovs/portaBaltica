import { Link } from 'react-router-dom';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { BriefingRequest } from './BriefingRequest';
import { PublicBriefingSample } from './PublicBriefingSample';
import { useRef } from 'react';
import { useScrollCollection } from '../../motion/useScrollChoreography';
import { PageIntro } from '../PageIntro';

export default function BriefingsPage() {
  const sample = useRef<HTMLDivElement>(null);
  useScrollCollection(sample, '.public-briefing-measure', 'public-sample');
  const enquiriesOpen = import.meta.env.VITE_BRIEFING_ENQUIRIES_OPEN === 'true';
  usePageMeta({
    title: 'Business briefings | portaBaltica',
    description: 'A public Baltic business briefing sample with source-linked observations on prices, labour costs and retail activity. Compare countries and inspect the evidence behind each reading.',
    canonicalPath: '/briefings',
  });

  return (
    <div className="folio-briefings">
      <PageIntro
        className="briefing-intro"
        title="The Baltic business briefing"
        lead="Costs, hiring and demand. A source-linked starting point for your next planning conversation."
        actions={<>
          <a href="#public-sample" className="site-action site-action-primary text-ui">Read the public sample ↓</a>
          <button type="button" className="site-action briefing-print text-ui" onClick={() => window.print()}>Print this briefing</button>
        </>}
        aside={<dl className="briefing-scope text-ui">
          <div><dt>Coverage</dt><dd>Latvia, Estonia and Lithuania</dd></div>
          <div><dt>Focus</dt><dd>Prices, labour costs and retail activity</dd></div>
          <div><dt>Format</dt><dd>Free, automated public sample</dd></div>
        </dl>}
      />

      <p className="briefing-method text-ui news-subtle">
        This sample is assembled automatically from published observations, not reviewed by a human
        editor. Each measure follows its own publication calendar; compare countries within a measure,
        not across differently dated releases. The figures are evidence to investigate, not a forecast
        or a recommendation for a particular business.
      </p>

      <div id="public-sample" ref={sample}>
        <PublicBriefingSample />
      </div>

      <section className="briefing-next" aria-labelledby="briefing-next-heading">
        <h2 id="briefing-next-heading" className="site-section-title text-title font-semibold news-fg">Keep the context. Go deeper.</h2>
        <div className="briefing-next-links">
          <Link to="/data" className="lab-link text-ui">Scan the full dashboard ↗</Link>
          <Link to="/explore" className="lab-link text-ui">Inspect a measure in Data explorer ↗</Link>
          <Link to="/weekly" className="lab-link text-ui">Read the newsroom’s weekly review ↗</Link>
        </div>
        <p className="text-ui news-subtle">
          The weekly review is separate AI-authored reporting, not a human-reviewed client deliverable.
          Public articles, charts, history and CSV exports remain free.
        </p>
      </section>

      <section className="briefing-bespoke" aria-labelledby="brief-enquiry">
        <div>
          <h2 id="brief-enquiry" className="site-section-title news-fg text-title font-semibold">Bespoke briefings</h2>
          <p className="news-muted text-ui">
            A tailored brief would need an agreed question, source permissions and a named human
            reviewer before delivery. This public sample is not an established paid service: there is
            no checkout, subscription or guaranteed delivery schedule.
          </p>
        </div>
        {enquiriesOpen ? <BriefingRequest /> : (
          <div className="site-panel briefing-enquiry-state">
            <p className="news-fg text-callout font-semibold">Pilot enquiries are not open yet</p>
            <p className="news-muted text-ui">
              No requests or payments are being collected here. The public sample and its evidence
              are available without an account.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
