'use strict';
// The contact endpoint's logic, separated from the Vercel entrypoint so the
// tests can drive it over a plain Node http server with a stubbed delivery
// adapter, and so the delivery adapter is a seam rather than a hard import.

const crypto = require('node:crypto');
const { validate, LIMITS } = require('./validate');
const { compose } = require('./message');
const token = require('./token');
const ratelimit = require('./ratelimit');

// Public wording is deliberately uniform: it never reveals which check failed,
// beyond the field-level messages a person needs in order to fix their input.
const PUBLIC = {
  method_not_allowed: 'Use POST.',
  unsupported_media_type: 'Send JSON.',
  payload_too_large: 'That message is too long.',
  invalid_input: 'Please check the highlighted fields.',
  rejected: 'We could not accept that submission.',
  rate_limited: 'Too many messages from here. Please try again shortly.',
  unconfigured: 'The contact form is not available right now.',
  delivery_failed: 'We could not send that just now.',
};

function fail(res, status, code, extra) {
  const body = { error: Object.assign({ code, message: PUBLIC[code] || PUBLIC.rejected }, extra || {}) };
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
  return false;
}

function readRaw(req, limit) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { resolve({ tooLarge: true }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve({ raw: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => resolve({ raw: '' }));
  });
}

function parseBody(raw, contentType) {
  if (/application\/json/i.test(contentType)) {
    try { return { value: JSON.parse(raw) }; } catch { return { bad: true }; }
  }
  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    const out = {};
    for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
    return { value: out };
  }
  return { unsupported: true };
}

/**
 * @param {object} deps  {config, missing, send, now}  — `send` is the delivery adapter
 */
async function handle(req, res, deps) {
  const { config, missing, send, now } = deps;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'method_not_allowed');
  }

  const contentType = String((req.headers && req.headers['content-type']) || '');
  const declared = Number((req.headers && req.headers['content-length']) || 0);
  if (declared > LIMITS.body) return fail(res, 413, 'payload_too_large');

  // Vercel pre-parses the body; a plain Node server does not. Reading it is
  // wrapped because Vercel's req.body is a lazy getter that throws on
  // malformed JSON rather than yielding undefined.
  let parsed;
  let pre;
  try { pre = req.body; } catch { return fail(res, 400, 'invalid_input', { fieldErrors: {} }); }
  if (pre !== undefined && pre !== null && typeof pre === 'object') {
    parsed = pre;
  } else {
    const got = await readRaw(req, LIMITS.body);
    if (got.tooLarge) return fail(res, 413, 'payload_too_large');
    const p = parseBody(got.raw || '', contentType);
    if (p.unsupported) return fail(res, 415, 'unsupported_media_type');
    if (p.bad) return fail(res, 400, 'invalid_input', { fieldErrors: {} });
    parsed = p.value;
  }

  const gaps = missing(config);
  if (gaps.length) {
    console.error('contact: unconfigured', { missing: gaps });
    return fail(res, 503, 'unconfigured');
  }

  const result = validate(parsed);
  if (!result.ok) {
    if (result.code === 'invalid_input') return fail(res, 400, 'invalid_input', { fieldErrors: result.fieldErrors });
    // A tripped honeypot or an unexpected field is answered exactly like any
    // other refusal, so probing cannot map the checks.
    return fail(res, 400, 'rejected');
  }

  const t = token.verify(config.tokenSecret, parsed.token, now());
  if (!t.ok) return fail(res, 403, 'rejected');

  const gate = ratelimit.check(ratelimit.clientKey(req), now());
  if (!gate.allowed) {
    res.setHeader('Retry-After', String(gate.retryAfterSeconds));
    return fail(res, 429, 'rate_limited');
  }

  const correlationId = crypto.randomUUID();
  const messageId = Date.now().toString(36) + '.' + crypto.randomBytes(8).toString('hex') + '@huntz.ai';
  const message = compose(result.value, config, new Date(now()), messageId);

  try {
    await send(config, message);
  } catch (e) {
    // Never the visitor's name, address or prose - only what a server operator
    // needs to tell a bad credential from a refused recipient.
    console.error('contact: delivery failed', {
      correlationId, stage: e && e.stage, smtpCode: e && e.code, detail: e && e.detail,
    });
    return fail(res, 502, 'delivery_failed', { correlationId });
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ ok: true }));
  return true;
}

module.exports = { handle, PUBLIC, parseBody };
