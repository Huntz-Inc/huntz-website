'use strict';
// GET /hunt, GET /hunt/:id: per-Hunt Open Graph/Twitter preview for invite
// links (vercel.json rewrites both paths here, ahead of the filesystem).
//
// Invite links are built by apps/mobile/src/lib/huntShare.ts's huntPublicUrl:
// always https://huntz.ai/hunt/<id>, with any of ?code=, ?via=, ?ref=
// appended. This function resolves the Hunt the same way the app parses that
// same link (huntShare.ts's huntDeepLink): the id is the one path segment
// after /hunt/, and an optional Hunt code rides in ?code=. ?ref= (the
// referral token) and ?via= (the share-attribution token) are NEVER read
// here: not forwarded to the API, not logged, not rendered, because neither
// is this endpoint's to see. They are bearer-credit-shaped values meant only
// for the app itself.
//
// FALLBACK IS THE DEFAULT. Whenever the Hunt cannot be resolved (no id in
// the URL, an id shape the app could never have issued, a non-200 from the
// API (a running Hunt currently 404s until a server fix ships; a canceled
// Hunt 404s forever; a code-gated Hunt 404s without its code), the API being
// unreachable, or a lookup slower than ~1.5s), this serves the exact same
// bytes the old static hunt.html served for every invitation. Only a
// confirmed 200 with a usable body changes anything, and even then only the
// <title>/description/og:* meta: the body, nav, waitlist CTA and the
// id-display script are byte-identical to the fallback in every case (see
// build/assemble.py's HUNT_FALLBACK_PATH comment and build/check.py).
//
// Every value that reaches the page is escaped (escapeHtml) and every tag
// swap uses a replacer FUNCTION, not a template string, so a Hunt title that
// happens to contain "$&" or "$1" cannot corrupt an unrelated tag: String
// replace() treats "$"-sequences specially only in a string replacement.

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://www.huntz.ai';
const API_ORIGIN = process.env.HUNTZ_API_URL || 'https://api.huntz.ai';
const TIMEOUT_MS = 1500;

// Mirrors apps/mobile/src/lib/huntShare.ts's SAFE_HUNT_ID exactly, so this
// only ever attempts to resolve an id shape the app itself could have issued.
const SAFE_HUNT_ID = /^[A-Za-z0-9._~-]{1,128}$/u;

// Mirrors huntShare.ts's HUNT_CODE_CANONICAL: Crockford base32 (no I/L/O/U),
// exactly 8 symbols, the canonical, dashless form normalizeHuntCode() puts
// in a real link's ?code=. A malformed code is DROPPED, not refused: per
// huntDeepLink's own comment, the code is an address, not authorization, and
// a PUBLIC Hunt's lookup still resolves without it.
const HUNT_CODE_CANONICAL = /^[0-9A-HJKMNP-TV-Z]{8}$/u;

const FALLBACK_PATH = path.join(process.cwd(), 'api', '_lib', 'hunt-fallback.html');

// Reached only if the deployment somehow shipped without
// api/_lib/hunt-fallback.html bundled (see vercel.json's
// functions["api/hunt.js"].includeFiles). Belt and suspenders, never
// expected in production. Kept honest against the same non-negotiables
// build/check.py asserts on the real file: noindex, no canonical, the real
// waitlist CTA, no claim Huntz cannot make in a limited beta.
const HARD_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hunt invitation | Huntz</title>
<meta name="description" content="This Hunt invitation opens in the Huntz app. Huntz is in limited beta - join the waitlist, then reopen your invitation once you have the app.">
<meta name="robots" content="noindex">
<meta property="og:site_name" content="Huntz">
<meta property="og:title" content="Hunt invitation | Huntz">
<meta property="og:description" content="This Hunt invitation opens in the Huntz app. Huntz is in limited beta - join the waitlist, then reopen your invitation once you have the app.">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:image" content="${SITE_URL}/og-image.jpg">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
<h1>You&#8217;ve been invited to a Hunt.</h1>
<p>Huntz is in limited beta, so this invitation can&#8217;t open on the web yet.</p>
<p><a href="/#waitlist">Join the waitlist</a></p>
</body>
</html>
`;

let cachedFallbackHtml = null;

function loadFallbackHtml() {
  if (cachedFallbackHtml !== null) return cachedFallbackHtml;
  try {
    cachedFallbackHtml = fs.readFileSync(FALLBACK_PATH, 'utf8');
  } catch (e) {
    console.error('hunt: could not read api/_lib/hunt-fallback.html, serving the embedded fallback', {
      message: e && e.message,
    });
    cachedFallbackHtml = HARD_FALLBACK_HTML;
  }
  return cachedFallbackHtml;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** An opaque server id safe to put in a path. Mirrors challengeShare.ts's safeRouteId: "." and ".."
 * pass the character class but resolve away as path segments, turning a fetch for
 * /v1/hunts/.. into a request for a different resource entirely. */
function safeHuntId(value) {
  if (typeof value !== 'string' || !SAFE_HUNT_ID.test(value)) return null;
  if (value === '.' || value === '..') return null;
  return value;
}

function safeHuntCode(value) {
  return typeof value === 'string' && HUNT_CODE_CANONICAL.test(value) ? value : null;
}

/**
 * Parse the ORIGINAL request path. A Vercel rewrite hands the destination the
 * original path in req.url (the browser never sees anything change), so this
 * reads it the same way hunt.html's own inline script reads location.pathname:
 * exactly one segment after /hunt/, optional trailing slash. ?ref= and ?via=
 * are deliberately never read past this point.
 */
function parseHuntRequest(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl || '/', 'http://huntz.internal');
  } catch {
    return { huntId: null, code: null };
  }
  const match = /^\/hunt\/([^/]+)\/?$/u.exec(url.pathname);
  if (!match) return { huntId: null, code: null };
  let decoded;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return { huntId: null, code: null };
  }
  return {
    huntId: safeHuntId(decoded),
    code: safeHuntCode(url.searchParams.get('code')),
  };
}

/**
 * GET {apiOrigin}/v1/hunts/{huntId}[?code=], aborted after timeoutMs. Returns
 * the parsed body on an exact 200 with a usable title, or null for every
 * other outcome (non-200, timeout, network error, malformed JSON, unexpected
 * shape). null is the caller's one signal to fall back.
 */
async function fetchHuntDetail(huntId, code, deps) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const timeoutMs = deps.timeoutMs || TIMEOUT_MS;
  const apiOrigin = deps.apiOrigin || API_ORIGIN;

  const url = new URL('/v1/hunts/' + encodeURIComponent(huntId), apiOrigin);
  if (code) url.searchParams.set('code', code);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res || res.status !== 200) return null;
    const body = await res.json();
    if (!body || typeof body !== 'object') return null;
    if (typeof body.title !== 'string' || body.title.length === 0) return null;
    return body;
  } catch {
    // Network error, abort (timeout), or a body that was not valid JSON.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pluralize(word, n) {
  if (n === 1) return word;
  return /[sxz]$|[cs]h$/iu.test(word) ? word + 'es' : word + 's';
}

/** The Hunt's own start date, in words, in the Hunt's own time zone, never the visitor's. */
function formatStartDate(startAt, timeZone) {
  if (typeof startAt !== 'string') return null;
  const parsed = new Date(startAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const format = (tz) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: tz }).format(
      parsed,
    );
  const zone = typeof timeZone === 'string' && timeZone.trim().length > 0 ? timeZone : 'UTC';
  try {
    return format(zone);
  } catch {
    // An unexpected/invalid IANA zone in the payload must not fail the whole page.
    try {
      return format('UTC');
    } catch {
      return null;
    }
  }
}

/**
 * "14 days" for a daily Hunt; the Hunt's calendar length ("4 weeks") for a
 * check-in cadence. HuntDetailDto.lengthLabel is present only then, and
 * reads better than a raw check-in count (packages/contracts/openapi.json).
 */
function formatDuration(duration, lengthLabel) {
  if (typeof lengthLabel === 'string' && lengthLabel.trim().length > 0) return lengthLabel.trim();
  if (
    duration &&
    typeof duration.windowCount === 'number' &&
    duration.windowCount > 0 &&
    typeof duration.windowUnitLabel === 'string' &&
    duration.windowUnitLabel.trim().length > 0
  ) {
    return duration.windowCount + ' ' + pluralize(duration.windowUnitLabel.trim(), duration.windowCount);
  }
  return null;
}

/** Host, start date in words, duration. Never the host-authored blurb (HuntDetailDto.description). */
function buildDescription(detail) {
  const parts = [];
  if (typeof detail.creatorDisplayName === 'string' && detail.creatorDisplayName.trim().length > 0) {
    parts.push('Hosted by ' + detail.creatorDisplayName.trim() + '.');
  }
  const dateWords = formatStartDate(detail.startAt, detail.timeZone);
  if (dateWords) parts.push('Starts ' + dateWords + '.');
  const durationWords = formatDuration(detail.duration, detail.lengthLabel);
  if (durationWords) parts.push(durationWords + '.');
  return parts.length > 0 ? parts.join(' ') : 'Open this Hunt in the Huntz app.';
}

/**
 * HuntDetailDto.coverArtUrl is a relative, validated-media-pipeline path
 * (e.g. "/v1/hunts/{id}/cover-art?v=<assetId>"); resolve it against the API
 * origin and refuse anything that would resolve somewhere else.
 */
function buildCoverArtUrl(coverArtUrl, apiOrigin) {
  if (typeof coverArtUrl !== 'string' || !coverArtUrl.startsWith('/')) return null;
  try {
    const base = new URL(apiOrigin);
    const resolved = new URL(coverArtUrl, base);
    return resolved.origin === base.origin ? resolved.toString() : null;
  } catch {
    return null;
  }
}

/** Swap one tag's text/attribute value using a replacer function; see the file header on why. */
function replaceTag(html, pattern, value) {
  return html.replace(pattern, (_match, open, close) => open + value + close);
}

function renderHuntHtml(fallbackHtml, huntId, detail, apiOrigin) {
  const title = escapeHtml(detail.title) + ' | Huntz';
  const description = escapeHtml(buildDescription(detail));
  const ogUrl = escapeHtml(SITE_URL + '/hunt/' + encodeURIComponent(huntId));
  const coverArt = buildCoverArtUrl(detail.coverArtUrl, apiOrigin);

  let html = fallbackHtml;
  html = replaceTag(html, /(<title>)[\s\S]*?(<\/title>)/, title);
  html = replaceTag(html, /(<meta name="description" content=")[^"]*(")/, description);
  html = replaceTag(html, /(<meta property="og:title" content=")[^"]*(")/, title);
  html = replaceTag(html, /(<meta property="og:description" content=")[^"]*(")/, description);
  html = replaceTag(html, /(<meta property="og:url" content=")[^"]*(")/, ogUrl);
  if (coverArt) {
    html = replaceTag(html, /(<meta property="og:image" content=")[^"]*(")/, escapeHtml(coverArt));
  }
  return html;
}

function sendHtml(res, html, cacheControl) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.end(html);
}

// Never cached: a non-200 today (the running-Hunt 404 the brief calls out,
// a transient timeout, a 429) must not keep serving the generic page after
// the API is fixed or the failure clears.
function sendFallback(res, deps) {
  sendHtml(res, (deps && deps.fallbackHtml) || loadFallbackHtml(), 'no-store');
}

async function handle(req, res, deps = {}) {
  try {
    const { huntId, code } = parseHuntRequest(req.url);
    if (!huntId) {
      sendFallback(res, deps);
      return;
    }
    const detail = await fetchHuntDetail(huntId, code, deps);
    if (!detail) {
      sendFallback(res, deps);
      return;
    }
    const apiOrigin = deps.apiOrigin || API_ORIGIN;
    const html = renderHuntHtml((deps && deps.fallbackHtml) || loadFallbackHtml(), huntId, detail, apiOrigin);
    sendHtml(res, html, 'public, s-maxage=300, stale-while-revalidate=600');
  } catch (e) {
    console.error('hunt: unexpected error, serving the fallback', { message: e && e.message });
    try {
      sendFallback(res, deps);
    } catch {
      // Response already sent or the socket is gone; nothing more to do.
    }
  }
}

module.exports = (req, res) => handle(req, res);
module.exports.handle = handle;
module.exports.parseHuntRequest = parseHuntRequest;
module.exports.safeHuntId = safeHuntId;
module.exports.safeHuntCode = safeHuntCode;
module.exports.escapeHtml = escapeHtml;
module.exports.buildDescription = buildDescription;
module.exports.buildCoverArtUrl = buildCoverArtUrl;
module.exports.renderHuntHtml = renderHuntHtml;
module.exports.API_ORIGIN = API_ORIGIN;
module.exports.SITE_URL = SITE_URL;
