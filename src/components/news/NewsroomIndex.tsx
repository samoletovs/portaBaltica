import { Link } from 'react-router-dom';
import {
  ACCOUNTABLE_PUBLISHER,
  AI_EDITOR,
  BYLINE_SUFFIX,
  CORRESPONDENTS,
  EDITOR_SUFFIX,
} from '../../newsroom/correspondents';
import { PUBLISHER_ROLE } from '../../newsroom/editorial';
import { CorrespondentAvatar } from './CorrespondentAvatar';

/**
 * The masthead: everyone who touches a story before it reaches a reader.
 *
 * This replaced a page called "Correspondents", which listed only the five
 * writers. That was accurate when they were the whole newsroom and misleading
 * once an editor stood between them and publication — a reader looking for
 * "who decides what runs here" found a list of people who do not decide.
 *
 * The three roles are separated on purpose. Correspondents file, the editor
 * decides, the publisher answers for it. Two of those three do not write, and
 * a reader judging whether to trust the output needs to see the difference.
 */
export function NewsroomIndex() {
  return (
    <div className="mx-auto max-w-measure">
      <h1 className="balance-text news-fg text-headline font-semibold tracking-tight sm:text-display">The newsroom</h1>
      <p className="pretty-text news-muted mt-4 text-lead">
        Five AI correspondents, one AI editor, and one accountable human. Everyone here carries the
        surname of a Baltic lighthouse. It is a house style, not a disguise: what each one is is stated
        beside its name, on this page and on every article.
      </p>

      <section aria-labelledby="correspondents-heading" className="mt-12">
        <h2 id="correspondents-heading" className="balance-text news-fg text-title font-semibold">
          Correspondents
        </h2>
        <p className="news-muted mt-2 text-callout">
          They write. Each covers one beat and works only from the datasets listed on its page.
        </p>
        <ul className="mt-4 space-y-2">
          {CORRESPONDENTS.map((entry) => (
            <li key={entry.id}>
              <Link
                to={`/newsroom/${entry.id}`}
                className="news-border news-hover-panel flex items-center gap-3 rounded-lg border p-3 transition-colors"
              >
                <CorrespondentAvatar id={entry.id} size={40} />
                <span>
                  <span className="news-fg block text-callout font-semibold">{entry.name}</span>
                  <span className="news-subtle block text-caption">
                    {BYLINE_SUFFIX} · {entry.beat}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="editor-heading" className="mt-12">
        <h2 id="editor-heading" className="balance-text news-fg text-title font-semibold">
          Editor
        </h2>
        <p className="news-muted mt-2 text-callout">
          Reviews every story before it runs, sends work back with notes, and holds anything that is
          thin, unsafe or unsupported. Nothing publishes without passing this desk.
        </p>
        <div className="news-border news-panel mt-4 rounded-lg border p-4">
          <p className="news-fg text-callout font-semibold">{AI_EDITOR.name}</p>
          <p className="news-subtle text-caption">{EDITOR_SUFFIX} · Editorial review</p>
          <p className="pretty-text news-muted mt-2 text-callout">
            Sparse and gatekeeping, more interested in what should not publish than in polishing
            what might. Separates a failed check, a weak story and a genuine risk of harm into three
            different decisions, and records the narrow reason for each so the trail can be audited.
          </p>
        </div>
      </section>

      <section aria-labelledby="publisher-heading" className="mt-12">
        <h2 id="publisher-heading" className="balance-text news-fg text-title font-semibold">
          Accountable publisher
        </h2>
        <p className="news-muted mt-2 text-callout">
          The only human on this masthead.
        </p>
        <div className="news-border news-panel mt-4 rounded-lg border p-4">
          <p className="news-fg text-callout font-semibold">{ACCOUNTABLE_PUBLISHER}</p>
          <p className="news-subtle text-caption">Human · {PUBLISHER_ROLE}</p>
          <p className="pretty-text news-muted mt-2 text-callout">
            Does not write, and does not sign off stories one at a time. He is answerable for the
            system that does: what it is allowed to publish, what it must refuse, and what happens
            when it gets something wrong.{' '}
            <Link to="/about/ai" className="news-link underline underline-offset-2">
              How that works
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
