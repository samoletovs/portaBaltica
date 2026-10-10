import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import retention from '../../newsroom/feedback-retention.json';
import { fetchArticleFeedbackSummary, type ArticleFeedbackSummary } from '../api';

const FIELD_CLASS = 'site-input w-full px-3 py-2 text-ui';
const RETENTION_DAYS = retention.definition.actions.baseBlob.delete.daysAfterModificationGreaterThan;
type Status = { kind: 'idle' | 'sending' } | { kind: 'saved'; id: string } | { kind: 'error'; message: string };
type SummaryState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; summary: ArticleFeedbackSummary };

function isFeedbackSummary(value: unknown): value is ArticleFeedbackSummary {
  if (!value || typeof value !== 'object' || !('available' in value)
    || !('count' in value) || !('average' in value)) return false;
  if (value.available === true) {
    return Number.isInteger(value.count) && typeof value.count === 'number' && value.count >= 5
      && typeof value.average === 'number' && Number.isFinite(value.average)
      && value.average >= 1 && value.average <= 5;
  }
  return value.available === false && value.count === null && value.average === null;
}

export function FeedbackForm({ slug }: { slug: string }) {
  return <FeedbackFields key={slug} slug={slug} />;
}

function FeedbackFields({ slug }: { slug: string }) {
  const fieldId = useId();
  const [kind, setKind] = useState<'comment' | 'issue'>('comment');
  const [rating, setRating] = useState('');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [summaryState, setSummaryState] = useState<SummaryState>({ kind: 'loading' });
  const submission = useRef<{ body: string; id: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const sending = status.kind === 'sending';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    const request = new AbortController();
    setSummaryState({ kind: 'loading' });
    void fetchArticleFeedbackSummary(slug, request.signal).then(summary => {
      if (!request.signal.aborted) setSummaryState({ kind: 'ready', summary });
    }).catch(() => {
      if (!request.signal.aborted) setSummaryState({ kind: 'error' });
    });
    return () => request.abort();
  }, [slug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const text = message.trim();
    const score = Number(rating);
    if (!Number.isInteger(score) || score < 1 || score > 5
      || (text.length > 0 && text.length < 5) || text.length > 2000 || contact.trim().length > 200) {
      setStatus({ kind: 'error', message: 'Choose a rating from 1 to 5; comments must be 5 to 2000 characters when provided, and contact must be at most 200.' });
      return;
    }
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
      setStatus({ kind: 'error', message: 'This browser cannot create a submission reference. Please use a current browser.' });
      return;
    }
    const payload = { slug, kind, rating: score, message: text, contact: contact.trim() || null };
    const body = JSON.stringify(payload);
    if (submission.current?.body !== body) submission.current = { body, id: crypto.randomUUID() };
    const id = submission.current.id;
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), 30000);
    setStatus({ kind: 'sending' });
    try {
      const response = await fetch('/api/article-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
        signal: request.signal,
      });
      if (response.status !== 200) throw new Error('Feedback was not confirmed.');
      const receipt: unknown = await response.json();
      if (!receipt || typeof receipt !== 'object' || !('ok' in receipt) || receipt.ok !== true
        || !('id' in receipt) || receipt.id !== id
        || !('summary' in receipt) || (receipt.summary !== null && !isFeedbackSummary(receipt.summary))) {
        throw new Error('Invalid feedback receipt.');
      }
      if (!mounted.current) return;
      setStatus({ kind: 'saved', id });
      if (receipt.summary !== null) setSummaryState({ kind: 'ready', summary: receipt.summary });
      setRating('');
      setMessage('');
      setContact('');
      submission.current = null;
    } catch {
      if (mounted.current) setStatus({
        kind: 'error',
        message: 'Could not confirm feedback was saved. Your text is still here; please try again later.',
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return (
    <section className="news-border mt-8 border-t pt-4 print:hidden" aria-label="Article feedback">
      <h2 className="site-section-title news-fg text-title font-semibold">Feedback</h2>
      <p className="news-muted mt-2 text-ui">Tell us what worked, what was unclear, or report an issue in this article.</p>
      <p aria-live="polite" className="news-muted mt-2 text-ui">
        {summaryState.kind === 'loading' ? 'Loading reader ratings…'
          : summaryState.kind === 'error' ? 'Reader ratings are temporarily unavailable.'
            : summaryState.summary.available
            ? `Average usefulness: ${summaryState.summary.average.toFixed(1)} out of 5 from ${summaryState.summary.count} ratings.`
              : 'A reader rating summary will appear after five ratings.'}
      </p>
      <p id={`${fieldId}-privacy`} className="news-subtle mt-2 text-caption">
        Feedback is stored privately for editorial review and scheduled for deletion after {RETENTION_DAYS} days.
        Azure recovery copies may remain temporarily after deletion. Do not include confidential information.
        Only an aggregate rating is shown publicly. Contact details are optional and are not added to a mailing list.
      </p>
      <form onSubmit={submit} aria-describedby={`${fieldId}-privacy`} className="mt-4">
        <fieldset disabled={sending} aria-label="Feedback details" className="min-w-0 space-y-4">
          <div>
            <label htmlFor={`${fieldId}-kind`} className="news-fg block text-ui font-semibold">Feedback type</label>
            <select id={`${fieldId}-kind`} className={FIELD_CLASS} value={kind} onChange={event => {
              if (event.target.value === 'comment' || event.target.value === 'issue') {
                setKind(event.target.value);
                setStatus({ kind: 'idle' });
              }
            }}>
              <option value="comment">Comment</option>
              <option value="issue">Report issue</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${fieldId}-rating`} className="news-fg block text-ui font-semibold">How useful was this article?</label>
            <select id={`${fieldId}-rating`} className={FIELD_CLASS} value={rating} required onChange={event => {
              setRating(event.target.value);
              setStatus({ kind: 'idle' });
            }}>
              <option value="">Choose a rating</option>
              <option value="1">1 — Not useful</option>
              <option value="2">2 — A little useful</option>
              <option value="3">3 — Somewhat useful</option>
              <option value="4">4 — Very useful</option>
              <option value="5">5 — Extremely useful</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${fieldId}-message`} className="news-fg block text-ui font-semibold">Your comments (optional)</label>
            <textarea id={`${fieldId}-message`} className={FIELD_CLASS} rows={4} minLength={5} maxLength={2000}
              value={message} onChange={event => { setMessage(event.target.value); setStatus({ kind: 'idle' }); }} />
          </div>
          <div>
            <label htmlFor={`${fieldId}-contact`} className="news-fg block text-ui font-semibold">Contact (optional)</label>
            <input id={`${fieldId}-contact`} className={FIELD_CLASS} type="text" maxLength={200}
              value={contact} onChange={event => { setContact(event.target.value); setStatus({ kind: 'idle' }); }} />
          </div>
          <button type="submit" className="site-action site-action-primary text-ui">
            {sending ? 'Sending…' : 'Send feedback'}
          </button>
        </fieldset>
      </form>
      <p role="status" aria-atomic="true" className="news-fg mt-3 break-words text-ui">
        {status.kind === 'sending' ? 'Sending feedback…'
          : status.kind === 'saved' ? `Thanks — your feedback was saved. Reference: ${status.id}` : ''}
      </p>
      {status.kind === 'error' && <p role="alert" className="news-warning mt-3 text-ui">{status.message}</p>}
    </section>
  );
}
