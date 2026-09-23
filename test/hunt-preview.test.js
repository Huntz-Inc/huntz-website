'use strict';
// Tests for api/hunt.js: the per-Hunt Open Graph/Twitter preview function
// that now owns /hunt and /hunt/:path+ (vercel.json). No test makes a real
// network call: the upstream API fetch is always injected via deps.fetchImpl,
// so these run offline and cannot depend on api.huntz.ai's actual behaviour.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');

const ROOT = path.join(__dirname, '..');
const huntFn = require('../api/hunt');

const FALLBACK_HTML = fs.readFileSync(path.join(ROOT, 'api/_lib/hunt-fallback.html'), 'utf8');

const VALID_DETAIL = Object.freeze({
  title: 'Read 12 Books',
  creatorDisplayName: 'Jordan',
  startAt: '2026-10-05T15:00:00.000Z',
  timeZone: 'America/New_York',
  duration: { windowCount: 14, windowUnitLabel: 'day' },
  lengthLabel: null,
  ruleSummary: Object.freeze({ proofWindowCount: 14, windowUnitLabel: 'day' }),
  coverArtUrl: '/v1/hunts/read-12-books/cover-art?v=asset-1',
});

// All relative to VALID_DETAIL.startAt (2026-10-05T15:00:00.000Z in America/New_York,
// i.e. 11:00 local on Oct 5) and its 14-day window. Verified independently with
// huntFn.localDayNumber/formatEndDate before being hard-coded here.
const NOW_BEFORE_START = new Date('2026-10-01T00:00:00.000Z');
const NOW_AT_START = new Date(VALID_DETAIL.startAt);
const NOW_SAME_LOCAL_DAY_BEFORE_START = new Date('2026-10-05T14:59:00.000Z'); // 1 minute before start, same local day
const NOW_DAY_5 = new Date('2026-10-09T18:00:00.000Z'); // 14:00 local on Oct 9 = day 5
const NOW_DAY_15_JUST_ENDED = new Date('2026-10-19T12:00:00.000Z'); // 08:00 local on Oct 19 = day 15, one past day 14
const NOW_WELL_AFTER_END = new Date('2026-11-01T12:00:00.000Z');

function jsonResponse(status, body) {
  return { status, json: async () => body };
}

/** Boots the real handler on an ephemeral port, mirroring test/helpers.js's startServer for contact.js. */
async function startServer(deps = {}) {
  const server = http.createServer((req, res) => {
    huntFn.handle(req, res, deps).catch((e) => {
      res.statusCode = 500;
      res.end(String(e && e.stack));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    close: () => new Promise((r) => server.close(r)),
    get: async (p) => {
      const res = await fetch(base + p);
      const text = await res.text();
      return { status: res.status, headers: res.headers, text };
    },
  };
}

// --------------------------------------------------------------- fallback

test('bare /hunt never attempts a lookup and serves the exact fallback bytes, uncached', async () => {
  let called = false;
  const server = await startServer({
    fetchImpl: async () => {
      called = true;
      return jsonResponse(200, VALID_DETAIL);
    },
  });
  try {
    const r = await server.get('/hunt');
    assert.equal(r.status, 200);
    assert.equal(r.text, FALLBACK_HTML);
    assert.equal(called, false, 'a bare /hunt has no id to resolve, so no fetch should be attempted');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  } finally {
    await server.close();
  }
});

test('a deeper path than /hunt/<one segment> is not treated as an id', async () => {
  let called = false;
  const server = await startServer({ fetchImpl: async () => { called = true; return jsonResponse(200, VALID_DETAIL); } });
  try {
    const r = await server.get('/hunt/abc123/extra');
    assert.equal(r.text, FALLBACK_HTML);
    assert.equal(called, false);
  } finally {
    await server.close();
  }
});

for (const [label, huntId] of [
  ['containing a slash-adjacent traversal segment', '..'],
  ['a bare dot', '.'],
  ['an unsafe character', 'abc?123'],
  ['too long (129 chars)', 'a'.repeat(129)],
]) {
  test(`an id that is ${label} is refused before any fetch is attempted`, async () => {
    let called = false;
    const server = await startServer({ fetchImpl: async () => { called = true; return jsonResponse(200, VALID_DETAIL); } });
    try {
      const r = await server.get('/hunt/' + encodeURIComponent(huntId));
      assert.equal(r.text, FALLBACK_HTML);
      assert.equal(called, false, `${label} should never reach the API`);
    } finally {
      await server.close();
    }
  });
}

for (const status of [404, 429, 500, 503]) {
  test(`a ${status} from the API falls back to the exact generic page`, async () => {
    const server = await startServer({ fetchImpl: async () => jsonResponse(status, { error: { code: 'x' } }) });
    try {
      const r = await server.get('/hunt/read-12-books');
      assert.equal(r.status, 200);
      assert.equal(r.text, FALLBACK_HTML);
      assert.equal(r.headers.get('cache-control'), 'no-store');
    } finally {
      await server.close();
    }
  });
}

test('a network error from the API falls back rather than throwing', async () => {
  const server = await startServer({ fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  try {
    const r = await server.get('/hunt/read-12-books');
    assert.equal(r.status, 200);
    assert.equal(r.text, FALLBACK_HTML);
  } finally {
    await server.close();
  }
});

test('a 200 with a malformed JSON body falls back rather than throwing', async () => {
  const server = await startServer({
    fetchImpl: async () => ({ status: 200, json: async () => { throw new SyntaxError('bad json'); } }),
  });
  try {
    const r = await server.get('/hunt/read-12-books');
    assert.equal(r.text, FALLBACK_HTML);
  } finally {
    await server.close();
  }
});

test('a 200 with no usable title falls back', async () => {
  const server = await startServer({ fetchImpl: async () => jsonResponse(200, { ...VALID_DETAIL, title: '' }) });
  try {
    const r = await server.get('/hunt/read-12-books');
    assert.equal(r.text, FALLBACK_HTML);
  } finally {
    await server.close();
  }
});

test('a lookup slower than the configured timeout falls back, and the upstream call is aborted', async (t) => {
  let aborted = false;
  const server = await startServer({
    timeoutMs: 30,
    fetchImpl: (url, opts) =>
      new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          aborted = true;
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
  });
  try {
    const started = Date.now();
    const r = await server.get('/hunt/read-12-books');
    assert.equal(r.text, FALLBACK_HTML);
    assert.ok(Date.now() - started < 1000, 'the request should not wait anywhere near the real 1.5s default');
    assert.equal(aborted, true, 'the fetch should have been aborted, not merely ignored');
  } finally {
    await server.close();
  }
});

test('when api/_lib/hunt-fallback.html cannot be read, an embedded safe fallback is served instead of a crash', async () => {
  // deps.fallbackHtml stands in for a failed fs.readFileSync inside the
  // module; this proves handle() never depends on it succeeding.
  const server = await startServer({ fallbackHtml: '<!doctype html><title>stand-in</title>' });
  try {
    const r = await server.get('/hunt');
    assert.equal(r.status, 200);
    assert.equal(r.text, '<!doctype html><title>stand-in</title>');
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------- success

test('a resolved Hunt gets per-Hunt meta; everything past <body> is untouched', async () => {
  const calls = [];
  const server = await startServer({
    now: NOW_BEFORE_START,
    fetchImpl: async (url) => {
      calls.push(url);
      return jsonResponse(200, VALID_DETAIL);
    },
  });
  try {
    const r = await server.get('/hunt/read-12-books?ref=' + 'a'.repeat(20) + '&via=' + 'b'.repeat(32) + '&code=7ZQK9M3H');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'public, s-maxage=300, stale-while-revalidate=600');

    assert.match(r.text, /<title>Read 12 Books \| Huntz<\/title>/);
    assert.match(r.text, /<meta name="description" content="Hosted by Jordan\. Starts October 5, 2026\. 14 days\.">/);
    assert.match(r.text, /<meta property="og:title" content="Read 12 Books \| Huntz">/);
    assert.match(r.text, /<meta property="og:description" content="Hosted by Jordan\. Starts October 5, 2026\. 14 days\.">/);
    assert.match(r.text, /<meta property="og:url" content="https:\/\/www\.huntz\.ai\/hunt\/read-12-books">/);
    assert.match(r.text, /<meta property="og:image" content="https:\/\/api\.huntz\.ai\/v1\/hunts\/read-12-books\/cover-art\?v=asset-1">/);

    // Untouched: robots, site_name, og:type, twitter:card, and everything from <body> on.
    assert.match(r.text, /<meta name="robots" content="noindex">/);
    assert.match(r.text, /<meta property="og:site_name" content="Huntz">/);
    assert.match(r.text, /<meta property="og:type" content="website">/);
    assert.match(r.text, /<meta name="twitter:card" content="summary_large_image">/);
    const fallbackBody = FALLBACK_HTML.slice(FALLBACK_HTML.indexOf('<body>'));
    const gotBody = r.text.slice(r.text.indexOf('<body>'));
    assert.equal(gotBody, fallbackBody);

    // code is forwarded; ref/via are never sent to the API.
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^https:\/\/api\.huntz\.ai\/v1\/hunts\/read-12-books\?code=7ZQK9M3H$/);
    assert.doesNotMatch(calls[0], /ref=/);
    assert.doesNotMatch(calls[0], /via=/);
  } finally {
    await server.close();
  }
});

test('a malformed code is dropped from the upstream call, and the lookup still proceeds', async () => {
  const calls = [];
  const server = await startServer({
    fetchImpl: async (url) => {
      calls.push(url);
      return jsonResponse(200, VALID_DETAIL);
    },
  });
  try {
    const r = await server.get('/hunt/read-12-books?code=not-a-real-code');
    assert.match(r.text, /<title>Read 12 Books \| Huntz<\/title>/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'https://api.huntz.ai/v1/hunts/read-12-books');
  } finally {
    await server.close();
  }
});

test('a trailing slash on the id resolves the same Hunt', async () => {
  const server = await startServer({ fetchImpl: async () => jsonResponse(200, VALID_DETAIL) });
  try {
    const r = await server.get('/hunt/read-12-books/');
    assert.match(r.text, /<title>Read 12 Books \| Huntz<\/title>/);
  } finally {
    await server.close();
  }
});

test('a decoded id round-trips through encodeURIComponent into the upstream URL and og:url', async () => {
  const calls = [];
  const server = await startServer({ fetchImpl: async (url) => { calls.push(url); return jsonResponse(200, VALID_DETAIL); } });
  try {
    const r = await server.get('/hunt/' + encodeURIComponent('hunt.id~2026'));
    assert.equal(calls[0], 'https://api.huntz.ai/v1/hunts/hunt.id~2026');
    assert.match(r.text, /<meta property="og:url" content="https:\/\/www\.huntz\.ai\/hunt\/hunt\.id~2026">/);
  } finally {
    await server.close();
  }
});

// --------------------------------------------------------------- escaping

test('a title/host carrying HTML metacharacters is escaped, not injected', async () => {
  const hostile = {
    ...VALID_DETAIL,
    title: '<script>alert(1)</script> & "quoted" \'thing\'',
    creatorDisplayName: 'A & B <Co>',
  };
  const server = await startServer({ fetchImpl: async () => jsonResponse(200, hostile) });
  try {
    const r = await server.get('/hunt/read-12-books');
    assert.doesNotMatch(r.text, /<script>alert\(1\)<\/script>/);
    assert.match(r.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quoted&quot; &#39;thing&#39;/);
    assert.match(r.text, /Hosted by A &amp; B &lt;Co&gt;\./);
  } finally {
    await server.close();
  }
});

test('a "$"-bearing title cannot corrupt an unrelated tag via String.replace substitution patterns', async () => {
  const hostile = { ...VALID_DETAIL, title: 'Save $$1 a day ($& everyone wins)' };
  const server = await startServer({ fetchImpl: async () => jsonResponse(200, hostile) });
  try {
    const r = await server.get('/hunt/read-12-books');
    assert.match(r.text, /<title>Save \$\$1 a day \(\$&amp; everyone wins\) \| Huntz<\/title>/);
    // The rest of the head must still be intact; a "$&"-triggered corruption
    // would typically duplicate or eat the following tag.
    assert.match(r.text, /<meta property="og:type" content="website">/);
  } finally {
    await server.close();
  }
});

// -------------------------------------------------------------- cover art

test('no coverArtUrl leaves the generic og:image untouched', async () => {
  const server = await startServer({ fetchImpl: async () => jsonResponse(200, { ...VALID_DETAIL, coverArtUrl: null }) });
  try {
    const r = await server.get('/hunt/read-12-books');
    assert.match(r.text, /<meta property="og:image" content="https:\/\/www\.huntz\.ai\/og-image\.jpg">/);
  } finally {
    await server.close();
  }
});

test('a protocol-relative coverArtUrl cannot smuggle in a foreign og:image host', async () => {
  const server = await startServer({
    fetchImpl: async () => jsonResponse(200, { ...VALID_DETAIL, coverArtUrl: '//evil.example/x.jpg' }),
  });
  try {
    const r = await server.get('/hunt/read-12-books');
    assert.doesNotMatch(r.text, /evil\.example/);
    assert.match(r.text, /<meta property="og:image" content="https:\/\/www\.huntz\.ai\/og-image\.jpg">/);
  } finally {
    await server.close();
  }
});

test('a fully-qualified foreign coverArtUrl is refused the same way', async () => {
  const server = await startServer({
    fetchImpl: async () => jsonResponse(200, { ...VALID_DETAIL, coverArtUrl: 'https://evil.example/x.jpg' }),
  });
  try {
    const r = await server.get('/hunt/read-12-books');
    assert.doesNotMatch(r.text, /evil\.example/);
  } finally {
    await server.close();
  }
});

test('buildCoverArtUrl resolves a relative path against the API origin, cache-buster included', () => {
  const url = huntFn.buildCoverArtUrl('/v1/hunts/x/cover-art?v=asset-9', 'https://api.huntz.ai');
  assert.equal(url, 'https://api.huntz.ai/v1/hunts/x/cover-art?v=asset-9');
});

// --------------------------------------------------------------- duration

test('duration falls back to windowCount + pluralized windowUnitLabel when lengthLabel is absent', () => {
  assert.equal(
    huntFn
      .buildDescription(
        { ...VALID_DETAIL, lengthLabel: null, duration: { windowCount: 1, windowUnitLabel: 'day' } },
        NOW_BEFORE_START,
      )
      .endsWith('1 day.'),
    true,
  );
  assert.equal(
    huntFn
      .buildDescription(
        { ...VALID_DETAIL, lengthLabel: null, duration: { windowCount: 6, windowUnitLabel: 'check-in' } },
        NOW_BEFORE_START,
      )
      .endsWith('6 check-ins.'),
    true,
  );
});

test('lengthLabel wins over a raw windowCount when both are present', () => {
  const desc = huntFn.buildDescription(
    { ...VALID_DETAIL, lengthLabel: '4 weeks', duration: { windowCount: 12, windowUnitLabel: 'check-in' } },
    NOW_BEFORE_START,
  );
  assert.match(desc, /4 weeks\.$/);
  assert.doesNotMatch(desc, /check-in/);
});

test('a null duration and null lengthLabel omit the duration clause without breaking the sentence', () => {
  const desc = huntFn.buildDescription({ ...VALID_DETAIL, duration: null, lengthLabel: null }, NOW_BEFORE_START);
  assert.equal(desc, 'Hosted by Jordan. Starts October 5, 2026.');
});

// ------------------------------------------------------------------ tense

test('before the start: "Starts {date}. {n} days."', () => {
  const desc = huntFn.buildDescription(VALID_DETAIL, NOW_BEFORE_START);
  assert.equal(desc, 'Hosted by Jordan. Starts October 5, 2026. 14 days.');
});

test('one minute before the start, on the same local day, is still "Starts", not "Started"', () => {
  const desc = huntFn.buildDescription(VALID_DETAIL, NOW_SAME_LOCAL_DAY_BEFORE_START);
  assert.equal(desc, 'Hosted by Jordan. Starts October 5, 2026. 14 days.');
});

test('boundary: at the exact start instant, the Hunt has started and reads Day 1', () => {
  const desc = huntFn.buildDescription(VALID_DETAIL, NOW_AT_START);
  assert.equal(desc, 'Hosted by Jordan. Started October 5, 2026. Day 1 of 14.');
});

test('while running: "Started {date}. Day {k} of {n}." for a daily cadence', () => {
  const desc = huntFn.buildDescription(VALID_DETAIL, NOW_DAY_5);
  assert.equal(desc, 'Hosted by Jordan. Started October 5, 2026. Day 5 of 14.');
});

test('after the end: "Ended {date}.", with no duration clause appended', () => {
  const atEnd = huntFn.buildDescription(VALID_DETAIL, NOW_DAY_15_JUST_ENDED);
  const wellAfter = huntFn.buildDescription(VALID_DETAIL, NOW_WELL_AFTER_END);
  assert.equal(atEnd, 'Hosted by Jordan. Ended October 18, 2026.');
  assert.equal(wellAfter, 'Hosted by Jordan. Ended October 18, 2026.');
});

test('a running check-in (non-daily) cadence falls back to the plain duration sentence, not a guessed Day k', () => {
  const checkin = {
    ...VALID_DETAIL,
    duration: { windowCount: 6, windowUnitLabel: 'check-in' },
    ruleSummary: { proofWindowCount: 6, windowUnitLabel: 'check-in' },
    lengthLabel: '6 weeks',
  };
  const desc = huntFn.buildDescription(checkin, NOW_DAY_5);
  assert.equal(desc, 'Hosted by Jordan. Started October 5, 2026. 6 weeks.');
  assert.doesNotMatch(desc, /Day \d/);
});

test('a running check-in cadence with no lengthLabel falls back to windowCount + pluralized unit', () => {
  const checkin = {
    ...VALID_DETAIL,
    duration: { windowCount: 6, windowUnitLabel: 'check-in' },
    ruleSummary: { proofWindowCount: 6, windowUnitLabel: 'check-in' },
    lengthLabel: null,
  };
  const desc = huntFn.buildDescription(checkin, NOW_DAY_5);
  assert.equal(desc, 'Hosted by Jordan. Started October 5, 2026. 6 check-ins.');
});

test('a running daily Hunt with an unresolvable time zone falls back rather than guessing a day number', () => {
  const desc = huntFn.buildDescription({ ...VALID_DETAIL, timeZone: 'Not/AZone' }, NOW_DAY_5);
  assert.equal(desc, 'Hosted by Jordan. Started October 5, 2026. 14 days.');
});

test('a running Hunt with no day count anywhere still names the start, without a false Day k or duration claim', () => {
  const noCount = { ...VALID_DETAIL, duration: null, lengthLabel: null, ruleSummary: { ...VALID_DETAIL.ruleSummary, proofWindowCount: null } };
  const desc = huntFn.buildDescription(noCount, NOW_DAY_5);
  assert.equal(desc, 'Hosted by Jordan. Started October 5, 2026.');
});

test('dayCount and cadenceUnit prefer ruleSummary over duration when both are present', () => {
  const detail = { ruleSummary: { proofWindowCount: 14, windowUnitLabel: 'day' }, duration: { windowCount: 99, windowUnitLabel: 'check-in' } };
  assert.equal(huntFn.dayCount(detail), 14);
  assert.equal(huntFn.cadenceUnit(detail), 'day');
});

test('localDayNumber is DST-safe: whole local calendar days, not a fixed 24h offset', () => {
  // America/New_York falls back from EDT to EST on 2026-11-01. A fixed 24h
  // step across that boundary would land on the wrong local calendar day.
  const start = '2026-10-31T04:00:00.000Z'; // Oct 31, 00:00 EDT (day 1)
  const nextLocalMidnight = '2026-11-01T05:00:00.000Z'; // Nov 1, 00:00 EST (day 2, 25h later in UTC)
  assert.equal(huntFn.localDayNumber(start, 'America/New_York', new Date(nextLocalMidnight)), 2);
});

test('an end-to-end request for a running Hunt reflects Day k of n in the served meta', async () => {
  const server = await startServer({ now: NOW_DAY_5, fetchImpl: async () => jsonResponse(200, VALID_DETAIL) });
  try {
    const r = await server.get('/hunt/read-12-books');
    assert.match(r.text, /<meta name="description" content="Hosted by Jordan\. Started October 5, 2026\. Day 5 of 14\.">/);
    assert.match(r.text, /<meta property="og:description" content="Hosted by Jordan\. Started October 5, 2026\. Day 5 of 14\.">/);
  } finally {
    await server.close();
  }
});

test('an end-to-end request for an ended Hunt reflects "Ended {date}." in the served meta', async () => {
  const server = await startServer({ now: NOW_WELL_AFTER_END, fetchImpl: async () => jsonResponse(200, VALID_DETAIL) });
  try {
    const r = await server.get('/hunt/read-12-books');
    assert.match(r.text, /<meta name="description" content="Hosted by Jordan\. Ended October 18, 2026\.">/);
  } finally {
    await server.close();
  }
});

// ------------------------------------------------------------ AASA safety

test('the new rewrites do not intersect either association-file path', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const huntRewrites = vercel.rewrites.filter((r) => r.destination === '/api/hunt');
  assert.equal(huntRewrites.length, 2);
  for (const aasa of ['/.well-known/apple-app-site-association', '/apple-app-site-association']) {
    for (const rw of huntRewrites) {
      const src = rw.source
        .replace(/:[A-Za-z_]\w*\+/g, '.+')
        .replace(/:[A-Za-z_]\w*/g, '[^/]+');
      assert.equal(new RegExp(`^${src}$`).test(aasa), false, `${rw.source} must not match ${aasa}`);
    }
  }
  // Untouched, byte for byte, by this change.
  const waa = fs.readFileSync(path.join(ROOT, '.well-known/apple-app-site-association'), 'utf8');
  const root = fs.readFileSync(path.join(ROOT, 'apple-app-site-association'), 'utf8');
  assert.equal(waa, root);
  assert.match(waa, /"appIDs":\s*\[\s*"JVTW9DH25L\.ai\.huntz\.app"\s*\]/);
});

test('hunt.html no longer exists at the repo root (it would shadow api/hunt.js at the bare /hunt clean URL)', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'hunt.html')), false);
});
