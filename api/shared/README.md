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
