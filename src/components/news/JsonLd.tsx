/**
 * Emits a JSON-LD block.
 *
 * `<` is escaped so a stray closing tag in article text can never break out of
 * the script element. Feed-derived text is untrusted input everywhere else in
 * this system; it is untrusted here too.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null;
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
