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
    <div className="mx-auto max-w-2xl">
      <h1 className="news-fg text-3xl font-semibold tracking-tight">The newsroom</h1>
      <p className="news-muted mt-3 text-lg leading-relaxed">
        Five AI correspondents, one AI editor, and one accountable human. Everyone here carries the
        surname of a Baltic lighthouse. It is a house style, not a disguise: what each one is is stated
        beside its name, on this page and on every article.
      </p>

      <section aria-labelledby="correspondents-heading" className="mt-10">
        <h2 id="correspondents-heading" className="news-fg text-sm font-semibold">
          Correspondents
        </h2>
        <p className="news-subtle mt-1 text-sm leading-relaxed">
          They write. Each covers one beat and works only from the datasets listed on its page.
        </p>
        <ul className="mt-4 space-y-2">
          {CORRESPONDENTS.map((entry) => (
            <li key={entry.id}>
              <Link
                to={`/newsroom/${entry.id}`}
                className="news-border news-focus news-hover-panel flex items-center gap-3 rounded-lg border p-3 transition-colors"
              >
                <CorrespondentAvatar id={entry.id} size={40} />
                <span>
                  <span className="news-fg block text-sm font-medium">{entry.name}</span>
                  <span className="news-subtle block text-xs">
                    {BYLINE_SUFFIX} · {entry.beat}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="editor-heading" className="mt-10">
        <h2 id="editor-heading" className="news-fg text-sm font-semibold">
          Editor
        </h2>
        <p className="news-subtle mt-1 text-sm leading-relaxed">
          Reviews every story before it runs, sends work back with notes, and holds anything that is
          thin, unsafe or unsupported. Nothing publishes without passing this desk.
        </p>
        <div className="news-border news-panel mt-4 rounded-lg border p-4">
          <p className="news-fg text-sm font-medium">{AI_EDITOR.name}</p>
          <p className="news-subtle text-xs">{EDITOR_SUFFIX} · Editorial review</p>
          <p className="news-muted mt-2 text-sm leading-relaxed">
            Sparse and gatekeeping, more interested in what should not publish than in polishing
            what might. Separates a failed check, a weak story and a genuine risk of harm into three
            different decisions, and records the narrow reason for each so the trail can be audited.
          </p>
        </div>
      </section>

      <section aria-labelledby="publisher-heading" className="mt-10">
        <h2 id="publisher-heading" className="news-fg text-sm font-semibold">
          Accountable publisher
        </h2>
        <p className="news-subtle mt-1 text-sm leading-relaxed">
          The only human on this masthead.
        </p>
        <div className="news-border news-panel mt-4 rounded-lg border p-4">
          <p className="news-fg text-sm font-medium">{ACCOUNTABLE_PUBLISHER}</p>
          <p className="news-subtle text-xs">Human · {PUBLISHER_ROLE}</p>
          <p className="news-muted mt-2 text-sm leading-relaxed">
            Does not write, and does not sign off stories one at a time. He is answerable for the
            system that does: what it is allowed to publish, what it must refuse, and what happens
            when it gets something wrong.{' '}
            <Link to="/about/ai" className="news-link news-focus underline underline-offset-2">
              How that works
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
