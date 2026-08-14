'use strict';
// POST /api/contact — delivers one contact-form submission to team@huntz.ai
// through the existing Zoho mailbox.
//
// The visitor never controls where mail goes or who it appears to be from: the
// recipient, the envelope sender and the From header are the constants below.
// The submitted address reaches exactly one header, Reply-To, and only after
// api/_lib/validate.js has held it to an anchored pattern that cannot admit a
// newline, a comma or an angle bracket. The reason is a closed set whose label
// builds the Subject, so no visitor text reaches a header at all.
//
// Nodemailer owns the wire: MIME, the encoding choice (quoted-printable for
// UTF-8, which matters because Zoho advertises no 8BITMIME), dot-stuffing,
// Date and Message-ID.

const nodemailer = require('nodemailer');
const { validate, LIMITS } = require('./_lib/validate');

const MAILBOX = 'team@huntz.ai';

// Zoho rejects a From that is not the authenticated mailbox or one of its
// aliases with "553 Relaying disallowed", so these three are deliberately equal.
const CONFIG = {
  recipient: MAILBOX,
  from: '"Huntz contact form" <' + MAILBOX + '>',
  // Paid Zoho custom-domain mailboxes are on smtppro; free ones on smtp.
  host: process.env.HUNTZ_SMTP_HOST || 'smtppro.zoho.com',
  port: Number(process.env.HUNTZ_SMTP_PORT || 465),
  user: process.env.HUNTZ_SMTP_USER || MAILBOX,
  pass: process.env.HUNTZ_SMTP_PASSWORD || '',
};

// Public wording is uniform: it never reveals which check failed, beyond the
// field messages a person needs in order to fix their own input.
const PUBLIC = {
  method_not_allowed: 'Use POST.',
  unsupported_media_type: 'Send JSON.',
  payload_too_large: 'That message is too long.',
  invalid_input: 'Please check the highlighted fields.',
  rejected: 'We could not accept that submission.',
  unconfigured: 'The contact form is not available right now.',
  delivery_failed: 'We could not send that just now.',
};

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const fail = (res, status, code, extra) =>
  reply(res, status, { error: Object.assign({ code, message: PUBLIC[code] }, extra || {}) });

function readRaw(req, limit) {
  return new Promise((resolve) => {
    // Node never re-emits 'end' on a finished stream, so listening to one would
    // never settle. Belt and braces behind the check above.
    if (req.readableEnded || req.destroyed) { resolve({ raw: '' }); return; }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      // pause(), not destroy(): tearing the socket down here loses the 413
      // envelope and the caller sees a connection reset instead of a refusal.
      // Pausing also applies backpressure, so nothing further is buffered.
      if (size > limit) { req.pause(); resolve({ tooLarge: true }); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve({ raw: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => resolve({ raw: '' }));
  });
}

function makeTransport() {
  return nodemailer.createTransport({
    host: CONFIG.host,
    port: CONFIG.port,
    secure: CONFIG.port === 465,          // implicit TLS on 465, STARTTLS on 587
    // Ignored on the secure path; on 587 it makes the connection fail rather
    // than authenticate in the clear if the peer never offers STARTTLS.
    requireTLS: true,
    auth: { user: CONFIG.user, pass: CONFIG.pass },
    name: 'huntz.ai',                     // EHLO argument, never taken from the request
    // Nodemailer's defaults (2min connect, 30s greeting, 10min socket) all
    // outlast the function's budget, so a stalled mail host would be killed by
    // the platform — and the visitor would get its timeout page instead of the
    // generic envelope below, with nothing written to the operator log.
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
  });
}

async function handle(req, res, deps = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'method_not_allowed');
  }

  // JSON only, and checked before anything reads the body. This is also what
  // stops a cross-origin form: application/json is not a CORS "simple" content
  // type, so a third-party page cannot POST here without a preflight it will
  // not survive. Checking it only when the host had not already parsed the body
  // would leave Vercel's own urlencoded parsing as an unguarded way in.
  const contentType = String((req.headers && req.headers['content-type']) || '');
  if (!/^application\/json\b/i.test(contentType)) {
    return fail(res, 415, 'unsupported_media_type');
  }
  if (Number((req.headers && req.headers['content-length']) || 0) > LIMITS.body) {
    return fail(res, 413, 'payload_too_large');
  }

  // Vercel pre-parses the body; a plain Node server does not. Reading it is
  // wrapped because Vercel's req.body is a lazy getter that throws on malformed
  // JSON rather than yielding undefined.
  let parsed;
  let pre;
  try { pre = req.body; } catch { return fail(res, 400, 'invalid_input', { fieldErrors: {} }); }
  if (pre !== undefined) {
    // The host parsed it, so it has already consumed the stream. Whatever shape
    // it produced is authoritative: validate() refuses anything that is not a
    // plain object, so a JSON scalar becomes a refusal rather than a re-read.
    parsed = pre;
  } else {
    const got = await readRaw(req, LIMITS.body);
    if (got.tooLarge) return fail(res, 413, 'payload_too_large');
    try { parsed = JSON.parse(got.raw || ''); }
    catch { return fail(res, 400, 'invalid_input', { fieldErrors: {} }); }
  }

  // The credential is only needed when the endpoint builds its own transport.
  // A half-provisioned deployment must not look like a working form.
  if (!deps.transport && !CONFIG.pass) {
    console.error('contact: unconfigured (HUNTZ_SMTP_PASSWORD)');
    return fail(res, 503, 'unconfigured');
  }

  let result;
  try {
    result = validate(parsed);
  } catch {
    // Validation is total by construction; this is the backstop that keeps a
    // future edit from turning a hostile body into an unanswered request.
    return fail(res, 400, 'rejected');
  }
  if (!result.ok) {
    if (result.code === 'invalid_input') {
      return fail(res, 400, 'invalid_input', { fieldErrors: result.fieldErrors });
    }
    // A tripped honeypot or an unexpected field is answered exactly like any
    // other refusal, so probing cannot map the checks.
    return fail(res, 400, 'rejected');
  }
  const v = result.value;

  const transport = deps.transport || makeTransport();
  try {
    // Awaited, not fired off: Vercel pauses background work the moment a
    // response is sent.
    await transport.sendMail({
      from: CONFIG.from,
      to: CONFIG.recipient,
      replyTo: v.email,
      subject: 'Huntz contact form: ' + v.reasonLabel,
      text: [
        'New message from the huntz.ai contact form.',
        '',
        'Reason:  ' + v.reasonLabel,
        'Name:    ' + v.name,
        'Email:   ' + v.email,
        '',
        'Message:',
        v.message,
        '',
      ].join('\n'),
    });
  } catch (e) {
    // Never the visitor's name, address or prose: only what an operator needs
    // to tell a bad credential from a refused recipient.
    console.error('contact: delivery failed', { code: e && e.code, responseCode: e && e.responseCode });
    return fail(res, 502, 'delivery_failed');
  } finally {
    if (!deps.transport) transport.close();
  }

  return reply(res, 200, { ok: true });
}

module.exports = (req, res) => handle(req, res);
module.exports.handle = handle;
module.exports.CONFIG = CONFIG;
