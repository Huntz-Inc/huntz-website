'use strict';
// A short-lived, server-signed form token.
//
// What it is: a cost-raising layer. The page has no server render, so the form
// fetches a token before it can submit. A scripted POST discovered by crawling
// the HTML - the dominant contact-spam pattern - now has to make a second
// request and wait, and it cannot mint its own token without the secret.
//
// What it is NOT: a rate limit. It is stateless, so a token cannot be marked
// used, and one token can legitimately be replayed until it expires. Durable
// per-IP limiting lives at the edge, in the Vercel WAF rule documented in
// README.md, not here.
//
// Deliberately NOT bound to the client IP. Binding looks stronger and is worse:
// a phone handing over from cellular to Wi-Fi mid-form, a CGNAT pool
// rebalancing, or an ISP egress pool load-balancing per connection all change
// the address between the GET and the POST, and each one would reject a real
// person with an error they cannot act on.

const crypto = require('node:crypto');

const VERSION = '1';
const MIN_AGE_MS = 3000;          // no human completes this form in under 3s
const MAX_AGE_MS = 30 * 60 * 1000;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Fixed-width, unambiguous payload: no delimiter can appear inside a field, so
// two different inputs can never produce the same signed string.
const payload = (issuedAt) => 'hzc.' + VERSION + '.' + String(issuedAt);

function sign(secret, issuedAt) {
  return b64url(crypto.createHmac('sha256', secret).update(payload(issuedAt)).digest());
}

function mint(secret, now) {
  const issuedAt = now;
  return VERSION + '.' + issuedAt + '.' + sign(secret, issuedAt);
}

/**
 * @returns {{ok: true} | {ok: false, reason: 'malformed'|'bad_signature'|'too_fast'|'expired'}}
 */
function verify(secret, token, now) {
  if (typeof token !== 'string' || token.length > 200) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION || !/^\d{1,15}$/.test(parts[1])) {
    return { ok: false, reason: 'malformed' };
  }
  const issuedAt = Number(parts[1]);
  const expected = Buffer.from(sign(secret, issuedAt), 'utf8');
  const got = Buffer.from(parts[2], 'utf8');
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
    return { ok: false, reason: 'bad_signature' };
  }
  const age = now - issuedAt;
  // A clock-skewed future token is treated as too fast, not as valid.
  if (age < MIN_AGE_MS) return { ok: false, reason: 'too_fast' };
  if (age > MAX_AGE_MS) return { ok: false, reason: 'expired' };
  return { ok: true };
}

module.exports = { mint, verify, sign, VERSION, MIN_AGE_MS, MAX_AGE_MS };
