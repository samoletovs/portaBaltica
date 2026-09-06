'use strict';

const { promises: fs } = require('node:fs');
const path = require('node:path');
const { withSecurity } = require('../shared/securityHeaders.js');
const rateLimit = require('../shared/rateLimit.js');

const MAX_MESSAGE = 2000;
const MAX_CONTACT = 200;
const DB_PATH = process.env.FEEDBACK_DB_PATH || '/tmp/portabaltica-feedback.ndjson';

function badRequest(context, message) {
  context.res = {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}

function parseBody(req) {
  if (!req || req.body == null) return null;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  if (typeof req.body === 'object') return req.body;
  return null;
}

async function appendFeedback(record) {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  await fs.appendFile(DB_PATH, JSON.stringify(record) + '\n', 'utf8');
}

const handler = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

  if (req.method !== 'POST') {
    context.res = {
      status: 405,
      headers: { Allow: 'POST', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
    return;
  }

  const payload = parseBody(req);
  if (!payload) return badRequest(context, 'Invalid JSON body');

  const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
  const kind = payload.kind === 'issue' ? 'issue' : payload.kind === 'comment' ? 'comment' : '';
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  const contact = typeof payload.contact === 'string' ? payload.contact.trim() : '';

  if (!slug) return badRequest(context, 'Missing article slug');
  if (!kind) return badRequest(context, 'Feedback kind must be comment or issue');
  if (message.length < 5 || message.length > MAX_MESSAGE) {
    return badRequest(context, `Feedback message must be 5 to ${MAX_MESSAGE} characters`);
  }
  if (contact.length > MAX_CONTACT) {
    return badRequest(context, `Contact must be at most ${MAX_CONTACT} characters`);
  }

  const now = new Date().toISOString();
  const id = `${slug}-${Date.now().toString(36)}`;
  const record = {
    id,
    slug,
    kind,
    message,
    contact: contact || null,
    created_at: now,
    ip:
      (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-client-ip'])) ||
      null,
    user_agent: (req.headers && req.headers['user-agent']) || null,
  };

  try {
    await appendFeedback(record);
  } catch (error) {
    context.log && context.log.error && context.log.error('feedback write failed', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Could not store feedback' }),
    };
    return;
  }

  context.res = {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, id }),
  };
};

module.exports = withSecurity(handler);
