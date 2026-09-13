'use strict';

const { withSecurity } = require('../shared/securityHeaders.js');
const rateLimit = require('../shared/rateLimit.js');

const SERVICE_URL = 'https://portabaltica-func.azurewebsites.net/api/article-feedback';
const MAX_RELAY_BYTES = 16384;
const DEADLINE_MS = 20000;
const FIELDS = ['id', 'slug', 'kind', 'message', 'contact'];

function reply(context, status, body, headers) {
  context.res = {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers),
    body: JSON.stringify(body),
  };
}

const handler = async function (context, req) {
  const limited = rateLimit.check(req);
  if (limited) {
    context.res = limited;
    context.res.headers = Object.assign({}, limited.headers, { 'Cache-Control': 'no-store' });
    return;
  }
  if (req.method !== 'POST') {
    reply(context, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
    return;
  }
  const type = req.headers && (req.headers['content-type'] || req.headers['Content-Type']);
  if (typeof type !== 'string' || type.split(';')[0].trim().toLowerCase() !== 'application/json') {
    reply(context, 415, { error: 'Content-Type must be application/json.' });
    return;
  }
  let payload;
  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_RELAY_BYTES) {
      reply(context, 413, { error: 'Feedback request is missing or too large.' });
      return;
    }
    payload = JSON.parse(raw);
  } catch {
    reply(context, 400, { error: 'Invalid JSON body.' });
    return;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    reply(context, 400, { error: 'A JSON object is required.' });
    return;
  }
  const clean = Object.fromEntries(FIELDS.filter(field => Object.hasOwn(payload, field)).map(field => [field, payload[field]]));
  try {
    const upstream = await fetch(SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clean),
      signal: AbortSignal.timeout(DEADLINE_MS),
      redirect: 'error',
    });
    if (![202, 400, 404, 409, 413, 415, 429, 503].includes(upstream.status)) {
      throw new Error(`Feedback service returned HTTP ${upstream.status}`);
    }
    const body = await upstream.json();
    if (upstream.status === 202) {
      if (body?.ok !== true || typeof body.id !== 'string' || body.id !== clean.id) {
        throw new Error('Feedback service did not confirm this submission.');
      }
      reply(context, 202, { ok: true, id: body.id });
      return;
    }
    if (typeof body?.error !== 'string' || body.error.length > 250) {
      throw new Error('Invalid feedback error response.');
    }
    const retry = upstream.headers.get('retry-after');
    reply(context, upstream.status, { error: body.error },
      retry && /^\d{1,6}$/.test(retry) ? { 'Retry-After': retry } : undefined);
  } catch (error) {
    if (context.log && context.log.error) context.log.error('Feedback receipt not confirmed', error);
    reply(context, 503, { error: 'Could not confirm feedback was saved. Please retry.' });
  }
};

module.exports = withSecurity(handler);
