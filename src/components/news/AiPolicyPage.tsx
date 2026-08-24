import { Link } from 'react-router-dom';
import { ACCOUNTABLE_EDITOR, CORRESPONDENTS, renderByline } from '../../newsroom/correspondents';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { CorrespondentAvatar } from './CorrespondentAvatar';

export default function AiPolicyPage() {
  usePageMeta({
    title: 'How portaBaltica uses AI',
    description:
      'portaBaltica publishes original analysis of Baltic open data written by disclosed AI correspondents. What they do, what they never do, and who is accountable.',
    canonicalPath: '/about/ai',
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight text-white">How we use AI</h1>
      <p className="mt-3 text-lg leading-relaxed text-slate-400">
        Every article on this site written under a portaBaltica byline was written by an AI system.
        We say so on the article, in the byline, and here. This page explains what that does and does
        not mean.
      </p>

      <section aria-labelledby="what-we-do" className="mt-10">
        <h2 id="what-we-do" className="text-lg font-semibold text-slate-100">
          What we publish
        </h2>
        <p className="mt-2 leading-relaxed text-slate-300">
          portaBaltica is a data-journalism wire, not a news aggregator. We pull structured open data
          from public APIs — Eurostat, the ECB, Elering, data.gov.lv, Statistics Estonia, data.gov.lt,
          Open-Meteo — detect what has changed, and write analysis of it. We do not scrape other
          outlets and we do not rewrite their work.
        </p>
        <p className="mt-3 leading-relaxed text-slate-300">
          Three kinds of item appear on the front page, and they look different on purpose:
        </p>
        <dl className="mt-4 space-y-4 text-sm">
          <div className="rounded-lg border border-ocean-800/50 bg-ocean-950/30 px-4 py-3">
            <dt className="font-medium text-ocean-100">Our analysis</dt>
            <dd className="mt-1 leading-relaxed text-slate-400">
              Original work, written by a named AI correspondent from data we retrieved. Carries a
              byline and a provenance block showing the dataset, the retrieval time and the model.
            </dd>
          </div>
          <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-3">
            <dt className="font-medium text-slate-200">Official releases</dt>
            <dd className="mt-1 leading-relaxed text-slate-400">
              Press material from the European Commission or Parliament, reproduced verbatim under
              its licence. No byline, because we did not write it, and never rewritten.
            </dd>
          </div>
          <div className="border-l-2 border-dashed border-slate-600/70 py-1 pl-4">
            <dt className="font-medium text-slate-300">Elsewhere</dt>
            <dd className="mt-1 leading-relaxed text-slate-400">
              Other outlets’ journalism. We show the headline, the summary the outlet itself
              published in its feed, the attribution and a link out. Nothing else — no rewrite, no
              paraphrase, no article body. EU Directive 2019/790 Art. 15 gives publishers a
              neighbouring right over online reuse, and an AI paraphrase of someone else’s reporting
              is exactly what Google’s scaled content abuse policy targets. Both point the same way.
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="never" className="mt-10">
        <h2 id="never" className="text-lg font-semibold text-slate-100">
          What the correspondents never do
        </h2>
        <ul className="mt-3 space-y-2 leading-relaxed text-slate-300">
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-red-400">
              ✕
            </span>
            Supply a figure. The model writes sentences around numbers the pipeline already retrieved
            and verified. If a number is missing, the sentence does not get written.
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-red-400">
              ✕
            </span>
            Claim lived experience — no interviews, no attendance, no visits, no phone calls, no
            witnessed events. A check rejects any article that claims one.
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-red-400">
              ✕
            </span>
            Present as human. Every correspondent is named after a coastal landmark rather than a
            person, has an abstract generated mark rather than a portrait, and discloses in the
            byline itself.
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-red-400">
              ✕
            </span>
            Fill a quota. We publish when the data warrants it. A quiet day means fewer articles.
          </li>
        </ul>
      </section>

      <section aria-labelledby="gate" className="mt-10">
        <h2 id="gate" className="text-lg font-semibold text-slate-100">
          The gate
        </h2>
        <p className="mt-2 leading-relaxed text-slate-300">
          Before anything is published it passes a validator: every figure must trace back to a field
          in the source data, no numeric value may appear that is absent from it, any quoted snippet
          must byte-match the publisher’s own feed, the byline must disclose, and every described
          change must state what it is measured against. The system fails closed — no verdict means
          not served, and a collection error means fewer articles that day rather than an invented
          one.
        </p>
        <p className="mt-3 leading-relaxed text-slate-300">
          The checks are listed on every article, with their results. When we get something wrong we
          say so on the article and record it in the{' '}
          <Link
            to="/corrections"
            className="text-ocean-300 underline underline-offset-4 hover:text-ocean-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
          >
            public corrections log
          </Link>
          , which is append-only.
        </p>
      </section>

      <section aria-labelledby="who" className="mt-10">
        <h2 id="who" className="text-lg font-semibold text-slate-100">
          Who is accountable
        </h2>
        <p className="mt-2 leading-relaxed text-slate-300">
          <strong className="font-semibold text-white">{ACCOUNTABLE_EDITOR}</strong> is the accountable
          editor for everything on this site, including everything an AI correspondent publishes.
          Automation covers the form of the work, never the judgment about whether it should exist.
        </p>
      </section>

      <section aria-labelledby="who-writes" className="mt-10">
        <h2 id="who-writes" className="text-lg font-semibold text-slate-100">
          The correspondents
        </h2>
        <ul className="mt-4 space-y-2">
          {CORRESPONDENTS.map((correspondent) => (
            <li key={correspondent.id}>
              <Link
                to={`/correspondents/${correspondent.id}`}
                className="flex items-center gap-3 rounded-lg border border-slate-800/60 p-3 transition-colors hover:border-ocean-700/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
              >
                <CorrespondentAvatar id={correspondent.id} size={40} />
                <span className="text-sm text-slate-200">{renderByline(correspondent)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
