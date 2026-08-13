'use strict';
// A per-instance burst brake. NOT a rate limiter, and it must not be described
// as one.
//
// Vercel functions auto-scale to thousands of concurrent instances, nothing
// pins a given caller to a given instance, and every deployment replaces them
// all - so an attacker opening parallel connections meets a fresh counter each
// time, and the counter resets at times nobody controls. Its whole value is
// that one confused client hammering one warm instance stops early.
//
// The durable control is the Vercel WAF rate-limit rule (free on Hobby, one
// rule per project, keyed on IP). README.md carries the exact command; without
// it this module is the only brake, and it is a weak one.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const MAX_KEYS = 5000;   // bounded so a spray of unique keys cannot grow memory

const hits = new Map();

function prune(now) {
  for (const [k, times] of hits) {
    const live = times.filter((t) => now - t < WINDOW_MS);
    if (live.length) hits.set(k, live);
    else hits.delete(k);
  }
}

/**
 * @returns {{allowed: boolean, retryAfterSeconds: number}}
 */
function check(key, now, max = MAX_PER_WINDOW) {
  if (hits.size > MAX_KEYS) prune(now);
  if (hits.size > MAX_KEYS) hits.clear();

  const times = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= max) {
    const retry = Math.ceil((WINDOW_MS - (now - times[0])) / 1000);
    hits.set(key, times);
    return { allowed: false, retryAfterSeconds: Math.max(1, retry) };
  }
  times.push(now);
  hits.set(key, times);
  return { allowed: true, retryAfterSeconds: 0 };
}

// Vercel overwrites x-forwarded-for at the edge and refuses to forward a
// caller-supplied one, so this value cannot be spoofed from the browser.
function clientKey(req) {
  const h = req.headers || {};
  const raw = h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for'] || '';
  const first = String(raw).split(',')[0].trim();
  return first || 'unknown';
}

function reset() { hits.clear(); }

module.exports = { check, clientKey, reset, WINDOW_MS, MAX_PER_WINDOW };
