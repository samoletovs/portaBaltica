# Upstream text and JSON

`responseText.js` decodes response bytes with one UTF-8 decoder per response.
Network chunks are not character boundaries: coercing each chunk independently
can replace Latvian letters, currency signs or other source text while leaving
JSON syntactically valid. The GET and PxWeb POST readers share this decoder;
the application-shell reader already uses Node's equivalent `setEncoding('utf8')`.

The helper rejects response-stream errors. It does not change URL selection,
HTTP-status handling, deadlines, retries, missing values or response caches.
New GET sources should use `eurostat.js`'s deadline-bounded `httpJson` / `httpText`,
not introduce another transport. Decoded text is not a substitute for the exact
raw bytes and hashes retained by the separate evidence archive.

`tests/upstreamText.test.ts` exercises all byte boundaries of a response with
two-, three- and four-byte characters, interleaved streams, and stream failures.
The property handler regression checks that source authority names reach JSON
unchanged. Run these through `npm test -- tests/upstreamText.test.ts tests/propertyData.test.ts`.

## National maritime fallback

Vessel queries request each country's named ports and its national code, with
all other dimensions still pinned. The existing handler prefers named ports;
when none are returned it serves only the national series as `countryOnly`.
The national aggregate is never added to a port breakdown.

On 2026-09-16 the current `mar_tf_qm` metadata contained Estonia's national
and confidential aggregate codes but none of the four configured named ports.
The national series retained 32 readings from the requested window, latest
2025-Q4 at 7,397 arrivals. The country-only display is appropriate here; an
empty named-port response does not establish that national traffic is absent.
Missing national readings still remain unavailable rather than becoming zeros.
`tests/portNationalFallback.test.tsx` exercises the real URL builder, handler
and rendered country-only disclosure, including named-port and missing controls.
