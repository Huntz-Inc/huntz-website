'use strict';
// Server-side validation. Every rule here is enforced again on the server even
// though the browser checks first, and every limit is measured in UTF-8 OCTETS
// rather than String.length, which counts UTF-16 code units and matches neither
// the RFC 5321 line limit nor any real mailbox constraint.

// Reason is a closed set. The email Subject is built from these labels, so no
// visitor text ever reaches a header and RFC 2047 encoding is never needed.
const REASONS = new Map([
  ['create-a-hunt', 'I want to create a Hunt'],
  ['partnership', 'Partnership'],
  ['press', 'Press'],
  ['general-question', 'General question'],
  ['website-issue', 'Website issue'],
]);

const FIELDS = ['name', 'email', 'reason', 'message', 'token', 'company'];
const HONEYPOT = 'company';

const LIMITS = { name: 100, email: 254, reason: 40, message: 5000, token: 200, body: 16384 };

// WHATWG's <input type=email> production. It is anchored and built from
// explicit character classes, so it structurally cannot admit CR, LF, NUL,
// comma, angle brackets, quotes or whitespace: the address-splicing attacks
// ("a@b.com, attacker@evil.com") die here rather than in a later sanitizer.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// C0 controls and DEL, minus tab and the newlines prose is allowed to contain.
// NUL is rejected rather than stripped: a validator that removes it inspects a
// different string than any downstream consumer that truncates at it.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const bytes = (s) => Buffer.byteLength(String(s), 'utf8');

function emailOk(v) {
  if (typeof v !== 'string' || !EMAIL_RE.test(v)) return false;
  if (bytes(v) > LIMITS.email) return false;
  const at = v.lastIndexOf('@');
  if (bytes(v.slice(0, at)) > 64) return false;      // RFC 5321 local-part
  return v.slice(at + 1).includes('.');              // WHATWG would allow a@localhost
}

// Single-line fields cannot carry line breaks into the message body layout.
const flatten = (v) => v.replace(/\s+/g, ' ').trim();

/**
 * @returns {{ok: true, value: object} | {ok: false, code: string, fieldErrors: object}}
 */
function validate(raw) {
  const fieldErrors = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'invalid_body', fieldErrors: {} };
  }
  for (const k of Object.keys(raw)) {
    if (!FIELDS.includes(k)) return { ok: false, code: 'unexpected_field', fieldErrors: {} };
  }

  // Hidden from people, irresistible to form-filling bots. Only an absent or
  // empty string passes: anything else, including a non-string, is refused.
  // String() is never called on it, because an object whose own toString is a
  // non-callable value has no ToPrimitive path and would throw here.
  const trap = raw[HONEYPOT];
  if (trap !== undefined && !(typeof trap === 'string' && trap.trim() === '')) {
    return { ok: false, code: 'rejected', fieldErrors: {} };
  }

  const name = typeof raw.name === 'string' ? flatten(raw.name) : '';
  if (!name) fieldErrors.name = 'Tell us your name.';
  else if (bytes(name) > LIMITS.name) fieldErrors.name = 'That name is too long.';
  else if (CONTROL_RE.test(name)) fieldErrors.name = 'That name contains characters we cannot accept.';

  const email = typeof raw.email === 'string' ? raw.email.trim() : '';
  if (!email) fieldErrors.email = 'We need an email address to reply to.';
  else if (!emailOk(email)) fieldErrors.email = 'That email address does not look right.';

  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (!reason) fieldErrors.reason = 'Pick a reason.';
  else if (bytes(reason) > LIMITS.reason || !REASONS.has(reason)) fieldErrors.reason = 'Pick a reason from the list.';

  const message = typeof raw.message === 'string' ? raw.message.replace(/\r\n?/g, '\n').trim() : '';
  if (!message) fieldErrors.message = 'Add a message.';
  else if (bytes(message) > LIMITS.message) fieldErrors.message = 'That message is too long. Please trim it a little.';
  else if (CONTROL_RE.test(message)) fieldErrors.message = 'That message contains characters we cannot accept.';

  if (Object.keys(fieldErrors).length) return { ok: false, code: 'invalid_input', fieldErrors };

  return { ok: true, value: { name, email, reason, reasonLabel: REASONS.get(reason), message } };
}

module.exports = { validate, REASONS, LIMITS, FIELDS, HONEYPOT, EMAIL_RE, emailOk, bytes, CONTROL_RE };
