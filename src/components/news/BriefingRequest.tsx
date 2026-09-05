import { useState, type FormEvent } from 'react';

export const BRIEFING_EMAIL = 'portabaltica@naurolabs.com';

const FIELD_CLASS = 'news-border news-panel news-fg w-full rounded-lg border px-3 py-2 text-ui';

export function BriefingRequest() {
  const [country, setCountry] = useState('All three Baltic countries');
  const [topic, setTopic] = useState('Costs and hiring');
  const [question, setQuestion] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const decision = question.trim();
    if (decision.length < 10 || decision.length > 600) {
      setError('Describe your business question in 10 to 600 characters.');
      setDraft('');
      return;
    }
    setError('');
    setDraft([
      'Hello portaBaltica,',
      '',
      'I would like to discuss a business briefing pilot.',
      `Country coverage: ${country}`,
      `Focus: ${topic}`,
      '',
      'The decision I am researching:',
      decision,
      '',
      'Please confirm whether you can help, the scope, delivery timing and price before any work begins.',
      'This is an enquiry, not an order or a newsletter subscription.',
    ].join('\n'));
  }

  return (
    <div>
      <form onSubmit={prepare} className="mt-4 space-y-4">
        <div>
          <label htmlFor="brief-country" className="news-fg block text-ui font-semibold">Country coverage</label>
          <select id="brief-country" className={FIELD_CLASS} value={country} onChange={(event) => {
            setCountry(event.target.value);
            setDraft('');
          }}>
            {['All three Baltic countries', 'Latvia', 'Estonia', 'Lithuania'].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="brief-topic" className="news-fg block text-ui font-semibold">Focus</label>
          <select id="brief-topic" className={FIELD_CLASS} value={topic} onChange={(event) => {
            setTopic(event.target.value);
            setDraft('');
          }}>
            {['Costs and hiring', 'Demand and trade', 'Country comparison'].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="brief-question" className="news-fg block text-ui font-semibold">
            What business decision are you researching?
          </label>
          <textarea id="brief-question" className={FIELD_CLASS} rows={4} required minLength={10} maxLength={600}
            aria-describedby="brief-privacy brief-error" aria-invalid={Boolean(error)} value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
              setDraft('');
              setError('');
            }} />
          <p id="brief-privacy" className="news-muted mt-2 text-ui">
            Do not include confidential business information or personal details. These fields stay
            in this page until you choose to send an email. They are not saved when you leave.
          </p>
          <p id="brief-error" role={error ? 'alert' : undefined} className="news-warning mt-2 text-ui">{error}</p>
        </div>
        <button type="submit" className="news-border news-accent-panel news-fg rounded-lg border px-4 py-2 text-ui font-semibold">
          Prepare enquiry
        </button>
      </form>
      {draft && (
        <section className="news-border mt-6 border-t pt-4" aria-label="Prepared enquiry">
          <p role="status" className="news-fg text-ui">Draft ready. Nothing has been sent.</p>
          <p className="mt-3 text-ui">
            <a className="news-link underline underline-offset-4"
              href={`mailto:${BRIEFING_EMAIL}?subject=${encodeURIComponent('Business briefing pilot enquiry')}&body=${encodeURIComponent(draft)}`}>
              Open email draft
            </a>
          </p>
          <label htmlFor="brief-draft" className="news-muted mt-4 block text-ui">
            If your mail app does not open, copy this draft and email {BRIEFING_EMAIL}.
          </label>
          <textarea id="brief-draft" readOnly rows={10} value={draft} className={FIELD_CLASS} />
          <p className="news-muted mt-3 text-ui">
            Sending starts a conversation, not a paid order. We do not add enquirers to a mailing list.
          </p>
        </section>
      )}
    </div>
  );
}
