import { Link } from 'react-router-dom';
import type { Persona } from '../../news-types';
import { getCorrespondent, renderByline } from '../../newsroom/correspondents';
import { CorrespondentAvatar } from './CorrespondentAvatar';

interface Props {
  persona: Pick<Persona, 'id' | 'name' | 'byline'> & { beat?: string };
  /** Compact form for feed cards; full form carries the avatar and links to the bio. */
  variant?: 'compact' | 'full';
  timestamp?: string;
}

/**
 * The byline, which always discloses.
 *
 * `renderByline` is the single source of the string and it guarantees the
 * phrase "AI correspondent" is in it. A feed summary that arrives with the
 * disclosure stripped gets a correct byline built from the persona rather than
 * being rendered bare — the reader is never left guessing what wrote this.
 *
 * The AI-use policy states this in public as an absolute: "every byline reads
 * '· AI correspondent', always, without exception." There is deliberately no
 * prop, flag or variant that can suppress it.
 *
 * Feed summaries carry no beat, so it is resolved from the registry: the beat
 * belongs to the correspondent, not to the article.
 */
export function Byline({ persona, variant = 'compact', timestamp }: Props) {
  const beat = persona.beat ?? getCorrespondent(persona.id)?.beat;
  const text = renderByline({ name: persona.name, beat, byline: persona.byline });
  const when = timestamp ? new Date(timestamp) : null;

  if (variant === 'compact') {
    return (
      <p className="news-subtle text-xs">
        <span className="news-muted">{text}</span>
        {when && (
          <>
            {' · '}
            <time dateTime={timestamp}>{when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</time>
          </>
        )}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <CorrespondentAvatar id={persona.id} size={44} />
      <div className="min-w-0">
        <Link
          to={`/newsroom/${persona.id}`}
          className="news-link news-focus text-sm font-medium underline underline-offset-4"
        >
          {text}
        </Link>
        <p className="news-subtle text-xs">
          Written by an AI system from open data.{' '}
          <Link to="/about/ai" className="news-hover underline underline-offset-2">
            How this works
          </Link>
          {when && (
            <>
              {' · '}
              <time dateTime={timestamp}>
                {when.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </time>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
