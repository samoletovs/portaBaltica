import { Link } from 'react-router-dom';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { BriefingRequest } from './BriefingRequest';

const QUESTIONS = [
  {
    title: 'Costs and hiring',
    question: 'How are inflation and labour costs changing across the markets where we operate?',
    path: '/data/labour',
    link: 'Compare labour indicators',
  },
  {
    title: 'Demand and trade',
    question: 'Which demand and trade indicators should we check before our next planning meeting?',
    path: '/data/trade',
    link: 'Explore trade indicators',
  },
  {
    title: 'Country comparison',
    question: 'Are we comparing the same measure, unit and reporting period in Latvia, Estonia and Lithuania?',
    path: '/data/economy',
    link: 'Compare the three economies',
  },
] as const;

export default function BriefingsPage() {
  const enquiriesOpen = import.meta.env.VITE_BRIEFING_ENQUIRIES_OPEN === 'true';
  usePageMeta({
    title: 'Business briefings | portaBaltica',
    description: 'Help shape a Baltic business briefing for costs, hiring and demand decisions. Explore the free evidence and the scope of our discovery pilot.',
    canonicalPath: '/briefings',
  });

  return (
    <div className="mx-auto max-w-measure">
      <p className="news-subtle text-caption font-semibold uppercase tracking-widest">Business briefings / discovery pilot</p>
      <h1 className="balance-text news-fg mt-3 text-display font-semibold tracking-tight">
        Baltic context for your next business decision
      </h1>
      <p className="pretty-text news-muted mt-4 text-prose">
        For analysts and small businesses comparing Latvia, Estonia and Lithuania.
        We are testing whether a focused, source-linked brief can save you time preparing a
        budget review, hiring plan or market comparison.
      </p>
      <p className="news-muted mt-4 text-ui">
        This is a research preview, not an established paid service. There is no checkout,
        subscription or guaranteed delivery schedule. Our articles, dashboard, history and
        CSV exports remain free.
      </p>
      <section className="mt-12" aria-labelledby="brief-questions">
        <h2 id="brief-questions" className="news-fg text-title font-semibold">Start with a decision, not another dashboard</h2>
        <ul className="mt-6 space-y-6">
          {QUESTIONS.map((item) => (
            <li key={item.title} className="news-border border-b pb-6">
              <h3 className="news-fg text-callout font-semibold">{item.title}</h3>
              <p className="news-muted mt-2 text-prose">{item.question}</p>
              <p className="mt-3 text-ui"><Link to={item.path} className="news-link underline underline-offset-4">{item.link}</Link></p>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-12" aria-labelledby="brief-scope">
        <h2 id="brief-scope" className="news-fg text-title font-semibold">What a pilot would need to deliver</h2>
        <ul className="news-muted mt-4 list-disc space-y-3 pl-6 text-prose">
          <li>A concise answer to an agreed question, with a named human reviewer before delivery.</li>
          <li>Source links, observation periods, units and comparisons you can check yourself.</li>
          <li>A clear separation between measured changes, possible explanations and what the data cannot answer.</li>
          <li>Agreed scope, timing and a one-off price before any paid work begins.</li>
        </ul>
        <p className="news-muted mt-4 text-ui">
          We would charge for research, review and preparation, not ownership of public statistics.
          Eurostat and ECB data are available free from their publishers. Source permissions must be
          cleared before inclusion in a commercial brief. This is not investment, legal or tax advice.
        </p>
        <p className="mt-4 text-ui">
          <Link to="/weekly" className="news-link underline underline-offset-4">Read the latest public weekly review</Link>
        </p>
        <p className="news-muted mt-2 text-ui">
          The public review is an example of our current automated reporting, not a sample of a
          human-reviewed client deliverable.{' '}
          <Link to="/about/ai" className="news-link underline underline-offset-4">Read how we use AI</Link>.
        </p>
      </section>
      <section className="mt-12" aria-labelledby="brief-enquiry">
        <h2 id="brief-enquiry" className="news-fg text-title font-semibold">Help shape the pilot</h2>
        {enquiriesOpen ? <BriefingRequest /> : (
          <div className="news-border news-panel mt-4 rounded-lg border p-4">
            <p className="news-fg text-callout font-semibold">Pilot enquiries are not open yet</p>
            <p className="news-muted mt-2 text-ui">
              We are setting up and testing the contact channel. No requests or payments are being
              collected here. You can explore the evidence now and check this page for availability.
            </p>
            <p className="mt-3 text-ui"><Link to="/data" className="news-link underline underline-offset-4">Use the free dashboard</Link></p>
          </div>
        )}
      </section>
    </div>
  );
}
