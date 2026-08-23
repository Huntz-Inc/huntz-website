'use strict';
// Tests for the apex host-scoped redirect and the association file.
//
//     npm test          (or: node --test "test/*.test.js")
//
// build/check.py already runs a routing matrix, but it runs it in Python's regex
// engine. Vercel evaluates these patterns in JavaScript, via path-to-regexp, so
// the same matrix is repeated here in the engine that actually decides. A
// divergence between the two would be invisible until production.
//
// The stakes: huntz.ai is the signed Associated Domain, so the apex has to serve
// the association file and the two universal-link paths itself, while ordinary
// apex marketing traffic keeps redirecting to the canonical www host. If the
// host condition ever matched www as well, every www request would redirect to
// itself and the marketing site would go down.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

const APEX = 'huntz.ai';
const WWW = 'www.huntz.ai';

const redirects = vercel.redirects || [];

// Vercel's `has` value is a regex. Whether it is applied as a bare search or
// wrapped as ^(?:value)$ is not something the docs state outright, so the rule is
// required to behave identically under both readings. Writing the value with
// explicit anchors is what makes that true, and this is the test that keeps it
// that way.
const SEMANTICS = {
  'unanchored search': (value, host) => new RegExp(value).test(host),
  'wrapped as ^(?:v)$': (value, host) => new RegExp(`^(?:${value})$`).test(host),
};

// path-to-regexp compiles a literal-plus-group source against the pathname,
// tolerating one trailing delimiter. The query string never participates.
function sourceMatch(source, pathname) {
  return new RegExp(`^${source}[/#?]?$`).exec(pathname) || new RegExp(`^${source}$`).exec(pathname);
}

function outcome(host, pathname, hostMatches) {
  for (const rule of redirects) {
    const cond = (rule.has || []).find((h) => h.type === 'host');
    if (cond && !hostMatches(cond.value, host)) continue;
    const m = sourceMatch(rule.source, pathname);
    if (m) return rule.destination.replace('$1', m[1]);
  }
  return 'SERVE';
}

const MATRIX = [
  // Served by the apex itself. Apple fetches the first two and follows no
  // redirects; the last three are the associated universal-link paths, and an
  // auth callback in particular must never be bounced to another origin while
  // it is carrying a single-use code.
  [APEX, '/.well-known/apple-app-site-association', 'SERVE'],
  [APEX, '/apple-app-site-association', 'SERVE'],
  [APEX, '/hunt', 'SERVE'],
  [APEX, '/hunt/test-hunt', 'SERVE'],
  [APEX, '/hunt/test-hunt/', 'SERVE'],
  [APEX, '/auth/callback', 'SERVE'],
  // A trailing slash must not push a path back into the cross-host redirect -
  // least of all the auth callback, which would carry its code to another origin.
  [APEX, '/auth/callback/', 'SERVE'],
  [APEX, '/apple-app-site-association/', 'SERVE'],
  // The apex-served pages load these. /auth/callback ships a CSP whose 'self' is
  // the apex, so bounced to www they are refused and the page renders unstyled.
  [APEX, '/assets/fonts.601bc53b.css', 'SERVE'],
  [APEX, '/favicon.ico', 'SERVE'],
  [APEX, '/favicon-48x48.png', 'SERVE'],
  [APEX, '/icon-192.png', 'SERVE'],
  [APEX, '/icon-512.png', 'SERVE'],
  [APEX, '/apple-touch-icon.png', 'SERVE'],
  // Ordinary apex marketing traffic still reaches the canonical host.
  [APEX, '/', 'https://www.huntz.ai/'],
  [APEX, '/about', 'https://www.huntz.ai/about'],
  [APEX, '/how-it-works', 'https://www.huntz.ai/how-it-works'],
  [APEX, '/faq', 'https://www.huntz.ai/faq'],
  [APEX, '/blog', 'https://www.huntz.ai/blog'],
  [APEX, '/blog/best-accountability-apps-2026', 'https://www.huntz.ai/blog/best-accountability-apps-2026'],
  [APEX, '/blog/why-you-dont-achieve-your-goals', 'https://www.huntz.ai/blog/why-you-dont-achieve-your-goals'],
  [APEX, '/about', 'https://www.huntz.ai/about'],
  [APEX, '/contact', 'https://www.huntz.ai/contact'],
  [APEX, '/terms', 'https://www.huntz.ai/terms'],
  [APEX, '/privacy', 'https://www.huntz.ai/privacy'],
  [APEX, '/accountability-challenges', 'https://www.huntz.ai/accountability-challenges'],
  [APEX, '/sitemap.xml', 'https://www.huntz.ai/sitemap.xml'],
  [APEX, '/robots.txt', 'https://www.huntz.ai/robots.txt'],
  // Near-misses must not inherit an exemption.
  [APEX, '/hunts/foo', 'https://www.huntz.ai/hunts/foo'],
  [APEX, '/apple-app-site-association-x', 'https://www.huntz.ai/apple-app-site-association-x'],
  [APEX, '/auth/callbackx', 'https://www.huntz.ai/auth/callbackx'],
  [APEX, '/auth/other', 'https://www.huntz.ai/auth/other'],
  [APEX, '/assetsx/a.css', 'https://www.huntz.ai/assetsx/a.css'],
  [APEX, '/iconography.png', 'https://www.huntz.ai/iconography.png'],
  [APEX, '/api/contact', 'https://www.huntz.ai/api/contact'],
  // www is canonical and is never redirected, whatever the path.
  [WWW, '/', 'SERVE'],
  [WWW, '/about', 'SERVE'],
  [WWW, '/blog', 'SERVE'],
  [WWW, '/hunt/test-hunt', 'SERVE'],
  [WWW, '/auth/callback', 'SERVE'],
  [WWW, '/.well-known/apple-app-site-association', 'SERVE'],
];

test('exactly one apex redirect rule is configured', () => {
  assert.equal(redirects.length, 1, 'a second rule would change evaluation order');
  assert.equal(redirects[0].permanent, true, 'the apex redirect should stay a 308');
});

for (const [label, hostMatches] of Object.entries(SEMANTICS)) {
  test(`routing matrix holds when the host condition is treated as ${label}`, () => {
    for (const [host, pathname, expected] of MATRIX) {
      assert.equal(outcome(host, pathname, hostMatches), expected, `${host}${pathname}`);
    }
  });
}

test('www is never redirected, so the canonical host cannot loop', () => {
  for (const [label, hostMatches] of Object.entries(SEMANTICS)) {
    for (const p of ['/', '/about', '/x/y/z', '/hunt/a', '/auth/callback', '/anything?q=1']) {
      assert.equal(outcome(WWW, p, hostMatches), 'SERVE', `${label} ${p}`);
    }
  }
});

test('the association file is not reachable by any redirect or rewrite', () => {
  for (const aasa of ['/.well-known/apple-app-site-association', '/apple-app-site-association']) {
    for (const host of [APEX, WWW]) {
      for (const hostMatches of Object.values(SEMANTICS)) {
        assert.equal(outcome(host, aasa, hostMatches), 'SERVE', `${host}${aasa}`);
      }
    }
    for (const rw of vercel.rewrites || []) {
      // path-to-regexp params as a regex: ":n*" spans segments, ":n+" needs at
      // least one, a bare ":n" is exactly one.
      const src = rw.source
        .replace(/:[A-Za-z_]\w*\*/g, '.*')
        .replace(/:[A-Za-z_]\w*\+/g, '.+')
        .replace(/:[A-Za-z_]\w*/g, '[^/]+');
      assert.equal(new RegExp(`^${src}$`).test(aasa), false, `rewrite ${rw.source} moves ${aasa}`);
    }
  }
});

test('the association file names the app identifier from the signed profile', () => {
  const copies = ['.well-known/apple-app-site-association', 'apple-app-site-association']
    .map((p) => fs.readFileSync(path.join(ROOT, p), 'utf8'));
  assert.equal(copies[0], copies[1], 'the two copies must not drift');

  const aasa = JSON.parse(copies[0]);
  const [detail] = aasa.applinks.details;
  assert.deepEqual(detail.appIDs, ['JVTW9DH25L.ai.huntz.app']);

  // Evaluate the components the way Apple does rather than grepping, so this
  // asserts real matching behaviour. "*" spans any characters; a component with
  // no "?" key matches regardless of query string.
  const matches = (pathname) =>
    detail.components.some((c) => {
      const rx = [...c['/']].map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
      return new RegExp(`^${rx}$`).test(pathname) && !c.exclude;
    });

  for (const p of ['/hunt', '/hunt/abc123', '/hunt/01HZY9K3', '/auth/callback']) {
    assert.equal(matches(p), true, `${p} must be associated`);
  }
  for (const p of ['/', '/about', '/blog', '/blog/best-accountability-apps-2026', '/contact',
                   '/faq', '/terms', '/privacy', '/hunts/abc', '/auth', '/auth/other',
                   '/auth/callbackx', '/.well-known/apple-app-site-association']) {
    assert.equal(matches(p), false, `${p} must NOT be associated`);
  }
});
