'use strict';

const { withSecurity } = require('../shared/securityHeaders.js');
const rateLimit = require('../shared/rateLimit.js');

const SERVICE_URL = 'https://portabaltica-func.azurewebsites.net/api/article-feedback';
const MAX_RELAY_BYTES = 16384;
const DEADLINE_MS = 20000;
const FIELDS = ['id', 'slug', 'kind', 'rating', 'message', 'contact'];

function validSummary(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 3 || typeof body.available !== 'boolean') return false;
  if (!body.available) return body.count === null && body.average === null;
  return Number.isInteger(body.count) && body.count >= 5
    && typeof body.average === 'number' && Number.isFinite(body.average)
    && body.average >= 1 && body.average <= 5;
}

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
  if (req.method !== 'GET' && req.method !== 'POST') {
    reply(context, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' });
    return;
  }
  if (req.method === 'GET') {
    const slug = req.query && req.query.slug;
    if (typeof slug !== 'string' || !slug || slug.length > 250) {
      reply(context, 400, { error: 'A valid article slug is required.' });
      return;
    }
    try {
      const upstream = await fetch(`${SERVICE_URL}?slug=${encodeURIComponent(slug)}`, {
        method: 'GET',
        signal: AbortSignal.timeout(DEADLINE_MS),
        redirect: 'error',
      });
      if (![200, 400, 404, 503].includes(upstream.status)) {
        throw new Error(`Feedback service returned HTTP ${upstream.status}`);
      }
      const body = await upstream.json();
      if (upstream.status === 200) {
        if (!validSummary(body)) throw new Error('Invalid feedback summary.');
        reply(context, 200, body);
        return;
      }
      if (typeof body?.error !== 'string' || body.error.length > 250) {
        throw new Error('Invalid feedback error response.');
      }
      reply(context, upstream.status, { error: body.error });
    } catch (error) {
      if (context.log && context.log.error) context.log.error('Feedback summary not confirmed', error);
      reply(context, 503, { error: 'Could not load the feedback summary.' });
    }
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
      if (body?.ok !== true || typeof body.id !== 'string' || body.id !== clean.id
        || body.rating !== clean.rating
        || (body.summary !== undefined && body.summary !== null && !validSummary(body.summary))) {
        throw new Error('Feedback service did not confirm this submission.');
      }
      reply(context, 200, { ok: true, id: body.id, summary: body.summary || null });
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
