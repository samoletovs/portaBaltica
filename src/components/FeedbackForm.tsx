import { useState, type FormEvent } from 'react';

const FIELD_CLASS = 'news-border news-panel news-fg w-full rounded-lg border px-3 py-2 text-ui';

export function FeedbackForm({ slug }: { slug: string }) {
  const [kind, setKind] = useState<'comment' | 'issue'>('comment');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (text.length < 5 || text.length > 2000) {
      setError('Feedback must be 5 to 2000 characters.');
      setSent(false);
      return;
    }
    setError('');
    setSent(false);
    setSending(true);
    try {
      const response = await fetch('/api/article-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          kind,
          message: text,
          contact: contact.trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error(`submit failed: ${response.status}`);
      setSent(true);
      setMessage('');
      setContact('');
    } catch {
      setError('Could not send feedback right now. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="news-border mt-8 border-t pt-4" aria-label="Article feedback">
      <h2 className="news-fg text-title font-semibold">Feedback</h2>
      <p className="news-muted mt-2 text-ui">
        Tell us what worked, what was unclear, or report an issue in this article.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <label htmlFor={`feedback-kind-${slug}`} className="news-fg block text-ui font-semibold">
            Feedback type
          </label>
          <select
            id={`feedback-kind-${slug}`}
            className={FIELD_CLASS}
            value={kind}
            onChange={(event) => setKind(event.target.value === 'issue' ? 'issue' : 'comment')}
          >
            <option value="comment">Comment</option>
            <option value="issue">Report issue</option>
          </select>
        </div>
        <div>
          <label htmlFor={`feedback-message-${slug}`} className="news-fg block text-ui font-semibold">
            Your feedback
          </label>
          <textarea
            id={`feedback-message-${slug}`}
            className={FIELD_CLASS}
            rows={4}
            required
            minLength={5}
            maxLength={2000}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setError('');
            }}
          />
        </div>
        <div>
          <label htmlFor={`feedback-contact-${slug}`} className="news-fg block text-ui font-semibold">
            Contact (optional)
          </label>
          <input
            id={`feedback-contact-${slug}`}
            className={FIELD_CLASS}
            type="text"
            maxLength={200}
            value={contact}
            onChange={(event) => setContact(event.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={sending}
          className="news-border news-accent-panel news-fg min-h-11 rounded-lg border px-4 py-2 text-ui font-semibold disabled:opacity-60"
        >
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </form>
      <p role={error ? 'alert' : sent ? 'status' : undefined} className="mt-3 text-ui">
        {error || (sent ? 'Thanks — your feedback was received for review.' : '')}
      </p>
    </section>
  );
}
