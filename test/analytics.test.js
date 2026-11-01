'use strict';
// Tests for the PostHog website analytics (2026-11-01): build/analytics.js,
// inlined by build/assemble.py at the end of <head> on every public page, and
// stamped with the Hunt id by api/hunt.js on a resolved /hunt/<id> page.
//
//     npm test          (or: node --test "test/*.test.js")
//
// The script under test is the one that ships: it is read out of the committed
// pages and run in a vm against a small stand-in DOM, with PostHog's own
// loader stub running unchanged. Nothing here reaches PostHog; array.js is
// never fetched, so these tests cannot send an event.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const analytics = require('../api/_lib/analytics');
const home = require('../api/home');
const hunt = require('../api/hunt');

// ---------------------------------------------------------------- which pages

/** Public pages, and the two function templates api/home.js serves. Each carries the script once. */
const CARRIERS = [
  'index.html',
  'about.html',
  'accountability-challenges.html',
  'blog.html',
  'blog/best-accountability-apps-2026.html',
  'blog/why-you-dont-achieve-your-goals.html',
  'contact.html',
  'faq.html',
  'how-it-works.html',
  'privacy.html',
  'terms.html',
  'api/_lib/home-fallback.html',
];

/** Pages that handle invitation tokens, auth codes, pairing signatures or payout returns. Never. */
const POSTHOG_MARKER = /posthog\.init\(|\/static\/array\.js|data-hz-hunt-id/;
const OPT_OUT = [
  'api/_lib/hunt-fallback.html',
  'auth/callback.html',
  'mailbox/gmail-action/pair.html',
  'payouts/return.html',
  'payouts/refresh.html',
];

/** Every inline script that initialises PostHog, as its full tag (the Hunt page's carries a data attribute). */
const scriptsIn = (html) => [...html.matchAll(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g)]
  .map((m) => m[0]).filter((tag) => tag.includes('posthog.init('));
const bodyOf = (scriptTag) => scriptTag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
const SHIPPED = bodyOf(scriptsIn(read('index.html'))[0]);

test('every public page, and the generated home template, carries the analytics script exactly once', () => {
  for (const rel of CARRIERS) {
    const html = read(rel);
    assert.equal(scriptsIn(html).length, 1, `${rel}: analytics script count`);
    assert.equal(html.split('posthog.init(').length - 1, 1, `${rel}: posthog.init count`);
    assert.equal(html.split('/static/array.js').length - 1, 1, `${rel}: array.js loader count`);
    // At the end of <head>, so the page body and its other scripts are untouched.
    assert.ok(html.indexOf('posthog.init(') < html.indexOf('</head>'), `${rel}: script is in <head>`);
    assert.equal(html.split('</head>').length - 1, 1, `${rel}: one </head>`);
  }
});

test('every carrier serves byte-identical script text, and it is the text api/_lib/analytics.js holds', () => {
  for (const rel of CARRIERS) {
    assert.equal(scriptsIn(read(rel))[0], analytics.ANALYTICS_SCRIPT, `${rel}: drifted from api/_lib/analytics.js`);
  }
});

test('pages that handle tokens, codes, signatures or payouts never carry analytics', () => {
  for (const rel of OPT_OUT) {
    assert.doesNotMatch(read(rel), POSTHOG_MARKER, `${rel}: must not load or initialise PostHog`);
  }
  // (The privacy policy text names PostHog, so the check is for the script, not the word.)
  const artifact = path.join(ROOT, 'build/huntz-landing.artifact.html');
  if (fs.existsSync(artifact)) assert.doesNotMatch(fs.readFileSync(artifact, 'utf8'), POSTHOG_MARKER, 'the Claude artifact stays clean');
});

test('every html file in the repo is classified, so a new page cannot ship unreviewed', () => {
  const found = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'build', 'test', 'scripts', 'assets'].includes(e.name)) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (f.endsWith('.html')) found.push(path.relative(ROOT, f));
    }
  })(ROOT);
  const classified = new Set([...CARRIERS, ...OPT_OUT, 'api/_lib/hunt-card.html']);
  const stray = found.filter((f) => !classified.has(f)).sort();
  assert.deepEqual(stray, [], 'classify new html files in CARRIERS or OPT_OUT, deliberately');
});

test('the only Content-Security-Policy headers belong to pages that run no analytics', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const withCsp = vercel.headers.filter((r) => r.headers.some((h) => h.key === 'Content-Security-Policy')).map((r) => r.source);
  assert.deepEqual(withCsp.sort(), ['/auth/callback', '/mailbox/gmail-action/pair', '/payouts/(return|refresh)']);
});

test('the markup the script keys on exists on the pages it runs on', () => {
  const homeHtml = read('index.html');
  for (const needle of ['id="hz-nav"', 'id="hz-hero"', 'id="hunts"', 'id="cta"', '<footer', 'aria-modal="true"', 'data-hunt-link', 'data-appstore-badge']) {
    assert.ok(homeHtml.includes(needle), `index.html lacks ${needle}`);
  }
  for (const rel of ['about.html', 'faq.html', 'contact.html', 'how-it-works.html']) {
    const html = read(rel);
    for (const needle of ['<header', 'data-hz-desknav', '<aside data-cta', 'data-hz-footernav', 'aria-modal="true"']) {
      assert.ok(html.includes(needle), `${rel} lacks ${needle}`);
    }
  }
  assert.ok(read('contact.html').includes('id="hz-contact-done"'), 'contact success panel');
});

// ---------------------------------------------------------- served by functions

const response = (body, status = 200) => ({ status, json: async () => body });
async function render(handler, fetchImpl, url, extras = {}) {
  const result = { headers: {} };
  await handler({ url }, { setHeader: (k, v) => { result.headers[k] = v; }, end: (body) => { result.body = body; } },
    { fetchImpl, now: new Date('2026-10-01T00:00:00Z'), ...extras });
  return result;
}
const DETAIL = {
  title: 'Read 12 Books', creatorDisplayName: 'Jordan', startAt: '2026-10-05T15:00:00.000Z', timeZone: 'America/New_York',
  duration: { windowCount: 14, windowUnitLabel: 'day' }, lengthLabel: null,
  ruleSummary: { proofWindowCount: 14, windowUnitLabel: 'day' }, coverArtUrl: '/v1/hunts/read-12-books/cover-art?v=asset-1',
};

test('api/home serves the homepage with the analytics script exactly once, live cards or fallback', async () => {
  const item = { id: 'public-hunt', title: 'Read with Jordan', startAt: '2026-10-20T07:00:00Z', timeZone: 'America/Los_Angeles',
    enrollmentStatus: 'OPEN', visibility: 'PUBLIC', duration: { windowCount: 21, windowUnitLabel: 'day' },
    summaryLabel: 'Reflection each day', stakeRange: { minMinor: '2000', maxMinor: '50000' } };
  const live = await render(home.handle, async () => response({ items: [item], nextCursor: null }), '/');
  const outage = await render(home.handle, async () => response({}, 503), '/');
  for (const r of [live, outage]) {
    assert.equal(scriptsIn(r.body).length, 1);
    assert.equal(r.body.split('posthog.init(').length - 1, 1);
  }
  assert.match(live.body, /data-hunt-link="" href="https:\/\/huntz\.ai\/hunt\/public-hunt"/);
});

test('api/hunt stamps the validated Hunt id on a resolved page and nowhere else', async () => {
  const ok = await render(hunt.handle, async () => response(DETAIL), '/hunt/read-12-books?ref=SECRET_REF&via=SECRET_VIA&code=7ZQK9M3H');
  assert.equal(scriptsIn(ok.body).length, 1);
  assert.match(ok.body, /<script data-hz-hunt-id="read-12-books">\n/);
  assert.equal(ok.body.match(/<script data-hz-hunt-id=/g).length, 1, 'the id is stamped on one tag');
  assert.doesNotMatch(ok.body, /SECRET_REF|SECRET_VIA/, 'referral and share tokens are never rendered');
  assert.ok(ok.body.indexOf('posthog.init(') < ok.body.indexOf('</head>'));
  // The script text is the same text the static pages carry.
  assert.equal(bodyOf(scriptsIn(ok.body)[0]), SHIPPED);

  const jsonLdHunt = await render(hunt.handle, async (url) => new URL(url).pathname === '/v1/hunts'
    ? response({ items: [{ id: 'read-12-books', title: 'Read 12 Books', startAt: DETAIL.startAt, timeZone: DETAIL.timeZone,
        enrollmentStatus: 'OPEN', duration: DETAIL.duration, stakeRange: { minMinor: '2000' } }], nextCursor: null })
    : response({ ...DETAIL, visibility: 'PUBLIC', enrollmentStatus: 'OPEN' }), '/hunt/read-12-books');
  assert.match(jsonLdHunt.body, /name="robots" content="index, follow"/, 'this case is the indexable branch');
  assert.equal(scriptsIn(jsonLdHunt.body).length, 1, 'an indexable Hunt page also gets exactly one');

  const fallback = read('api/_lib/hunt-fallback.html');
  for (const url of ['/hunt/read-12-books', '/hunt', '/hunt/bad%2Fid', '/hunt/' + 'a'.repeat(200)]) {
    const r = await render(hunt.handle, async () => response({}, 404), url);
    assert.equal(r.body, fallback, `${url}: unresolved links keep the fallback byte for byte`);
    assert.doesNotMatch(r.body, POSTHOG_MARKER);
  }
});

test('the Hunt id is attribute-escaped even though it was already validated', () => {
  assert.match(hunt.analyticsScriptFor('read-12-books'), /^<script data-hz-hunt-id="read-12-books">\n/);
  assert.match(hunt.analyticsScriptFor('a"><img src=x>'), /^<script data-hz-hunt-id="a&quot;&gt;&lt;img src=x&gt;">\n/);
  assert.equal(hunt.analyticsScriptFor('x').split('<script').length - 1, 1);
});

// ---------------------------------------------------------- the one token

test('the project token is one value: the build constant, the api module and every page agree', () => {
  const py = read('build/assemble.py');
  const fromPython = [...py.matchAll(/^POSTHOG_PROJECT_TOKEN = "([^"]+)"$/gm)].map((m) => m[1]);
  assert.equal(fromPython.length, 1, 'defined once in build/assemble.py');
  assert.match(fromPython[0], /^phc_[A-Za-z0-9]{20,64}$/, 'a PostHog project token, never a personal API key');
  assert.equal(analytics.POSTHOG_PROJECT_TOKEN, fromPython[0], 'api/_lib/analytics.js drifted from build/assemble.py');
  for (const rel of CARRIERS) {
    const tokens = [...read(rel).matchAll(/posthog\.init\('([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(tokens, [fromPython[0]], `${rel}: token`);
  }
  // Nowhere else in the repo's source: not in the script source, the functions or the tests.
  assert.ok(!read('build/analytics.js').includes(fromPython[0]));
  for (const rel of ['api/hunt.js', 'api/home.js', 'api/sitemap.js', 'api/contact.js']) assert.ok(!read(rel).includes(fromPython[0]), rel);
});

// ---------------------------------------------------------- a stand-in browser

/** Matches the handful of selector shapes the script uses: tag, #id, [attr], [attr="v"], combined. */
function matchesSimple(el, sel) {
  const m = /^([a-z][a-z0-9]*)?(#[\w-]+)?((?:\[[^\]]+\])*)$/i.exec(sel);
  if (!m) throw new Error('stand-in DOM cannot match selector: ' + sel);
  if (m[1] && el.tag !== m[1].toLowerCase()) return false;
  if (m[2] && el.attrs.id !== m[2].slice(1)) return false;
  for (const a of (m[3] || '').match(/\[[^\]]+\]/g) || []) {
    const [, name, quoted, bare] = /^\[([\w-]+)(?:=(?:"([^"]*)"|([^\]"]*)))?\]$/.exec(a);
    const value = quoted !== undefined ? quoted : bare;
    if (!(name in el.attrs)) return false;
    if (value !== undefined && el.attrs[name] !== value) return false;
  }
  return true;
}
class El {
  constructor(tag, attrs = {}, parent = null) {
    this.tag = tag; this.attrs = attrs; this.parentElement = parent; this.nodeType = 1; this.children = [];
    if (parent) parent.children.push(this);
    if ('hidden' in attrs) this._hidden = attrs.hidden;
  }
  getAttribute(n) { return n in this.attrs ? String(this.attrs[n]) : null; }
  hasAttribute(n) { return n in this.attrs; }
  matches(sel) { return sel.split(',').some((part) => matchesSimple(this, part.trim())); }
  closest(sel) { for (let e = this; e; e = e.parentElement) if (e.matches(sel)) return e; return null; }
  querySelector(sel) {
    for (const c of this.children) { if (c.matches(sel)) return c; const d = c.querySelector(sel); if (d) return d; }
    return null;
  }
  get id() { return this.attrs.id; }
  get hidden() { return Boolean(this._hidden); }
  set hidden(v) { this._hidden = v; }
}

/** Runs `script` as a page would, on `hostname`, and returns what it did. */
function run(script, { hostname = 'www.huntz.ai', pathname = '/', dnt, gpc, huntId, readyState = 'complete', elements = {} } = {}) {
  const handlers = {};
  const observers = [];
  const doc = {
    readyState,
    currentScript: { getAttribute: (n) => (n === 'data-hz-hunt-id' && huntId ? huntId : null) },
    addEventListener(type, fn, capture) { (handlers[type] = handlers[type] || []).push({ fn, capture }); },
    getElementById: (id) => elements[id] || null,
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }],
  };
  const ctx = {
    document: doc,
    location: { hostname, pathname, href: `https://${hostname}${pathname}`, origin: `https://${hostname}` },
    navigator: { doNotTrack: dnt, globalPrivacyControl: gpc },
    URL, Date, Object, Array, Boolean, String, RegExp,
    MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe(target, opts) { this.target = target; this.opts = opts; } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  const posthog = ctx.posthog;
  const calls = () => JSON.parse(JSON.stringify(posthog || [])).filter((c) => c[0] === 'capture').map(([, name, props, opts]) => ({ name, props, opts }));
  return {
    ctx, doc, observers, handlers, calls,
    initArgs: () => (posthog && posthog._i[0] ? JSON.parse(JSON.stringify({ token: posthog._i[0][0], config: posthog._i[0][1] })) : null),
    config: () => (posthog && posthog._i[0] ? posthog._i[0][1] : null),
    fire(type, target) { for (const h of handlers[type] || []) h.fn({ target, preventDefault() {} }); },
  };
}

test('hostname guard: PostHog starts on huntz.ai and www.huntz.ai only', () => {
  for (const hostname of ['huntz.ai', 'www.huntz.ai']) {
    const r = run(SHIPPED, { hostname });
    assert.ok(r.initArgs(), `${hostname}: initialised`);
    assert.ok(r.handlers.click && r.handlers.submit, `${hostname}: listeners attached`);
  }
  for (const hostname of ['localhost', '127.0.0.1', 'huntz-website-git-feat-x-huntz-inc.vercel.app', 'huntz.ai.evil.example',
    'evilhuntz.ai', 'api.huntz.ai', 'HUNTZ.AI.', '']) {
    const r = run(SHIPPED, { hostname });
    assert.equal(r.initArgs(), null, `${hostname}: must not initialise`);
    assert.equal(r.ctx.posthog, undefined, `${hostname}: no loader stub, so no script request`);
    assert.deepEqual(r.handlers, {}, `${hostname}: no listeners`);
    assert.equal(r.observers.length, 0);
  }
  assert.match(SHIPPED, /var HOSTS = \['huntz\.ai', 'www\.huntz\.ai'\];/);
});

test('Do Not Track and Global Privacy Control stop the script before PostHog loads', () => {
  for (const signal of [{ dnt: '1' }, { dnt: 1 }, { dnt: 'yes' }, { gpc: true }]) {
    const r = run(SHIPPED, signal);
    assert.equal(r.ctx.posthog, undefined, JSON.stringify(signal));
    assert.deepEqual(r.handlers, {});
  }
  for (const signal of [{ dnt: '0' }, { dnt: 'unspecified' }, { dnt: null }, { gpc: false }, {}]) {
    assert.ok(run(SHIPPED, signal).initArgs(), JSON.stringify(signal) + ' still runs');
  }
});

test('init options: persistent anonymous id, person profiles, nothing automatic beyond pageviews', () => {
  const r = run(SHIPPED);
  const config = r.config();
  assert.equal(r.initArgs().token, analytics.POSTHOG_PROJECT_TOKEN);
  assert.deepEqual(Object.keys(config).sort(), [
    'advanced_disable_flags', 'api_host', 'autocapture', 'before_send', 'capture_pageleave', 'capture_pageview',
    'cross_subdomain_cookie', 'custom_personal_data_properties', 'defaults', 'disable_session_recording', 'mask_personal_data_properties',
    'persistence', 'person_profiles', 'respect_dnt']);
  assert.equal(config.api_host, 'https://us.i.posthog.com');
  assert.equal(config.capture_pageview, true);
  assert.equal(config.capture_pageleave, true);
  assert.equal(config.autocapture, false);
  assert.equal(config.persistence, 'localStorage+cookie');
  assert.equal(config.cross_subdomain_cookie, false, 'the cookie stays on the page host, never .huntz.ai');
  assert.equal(config.person_profiles, 'always');
  assert.equal(config.respect_dnt, true);
  assert.equal(config.disable_session_recording, true);
  assert.equal(config.advanced_disable_flags, true);
  assert.equal(config.mask_personal_data_properties, true);
  assert.deepEqual(JSON.parse(JSON.stringify(config.custom_personal_data_properties)), ['ref', 'via', 'code']);
  assert.match(config.defaults, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof config.before_send, 'function');
  // No memory persistence and no cookieless mode, anywhere in the shipped bytes.
  assert.doesNotMatch(SHIPPED, /persistence:\s*'memory'|cookieless/);
  // The loader is PostHog's own, fetched asynchronously from its asset host.
  assert.match(SHIPPED, /p\.async=!0/);
  assert.match(SHIPPED, /api_host\.replace\("\.i\.posthog\.com","-assets\.i\.posthog\.com"\)\+"\/static\/array\.js"/);
});

test('the script never identifies anyone and never reads what a visitor typed', () => {
  assert.doesNotMatch(SHIPPED, /\.identify\(|\.alias\(|\.setPersonProperties\(|\.reset\(|\.value\b|innerText|textContent/);
  assert.doesNotMatch(SHIPPED, /onclick|on[a-z]+=["']/i, 'handlers are delegated listeners, not inline attributes');
  assert.doesNotMatch(SHIPPED, /\u2014|\u2013/, 'no em or en dashes');
  assert.equal(SHIPPED.split("addEventListener('click'").length - 1, 1, 'one delegated click listener');
  assert.equal(SHIPPED.split("addEventListener('submit'").length - 1, 1, 'one delegated submit listener');
  for (const n of ['website_cta_clicked', 'website_hunt_viewed', 'website_waitlist_submitted', 'website_contact_submitted']) {
    assert.equal(SHIPPED.split(`'${n}'`).length - 1, 1, `${n} is sent from exactly one place`);
  }
});

// ---------------------------------------------------------- before_send

test('before_send strips the query and fragment from invitation, sign-in, pairing and payout URLs, wherever they appear', () => {
  const { before_send: scrub } = run(SHIPPED).config();
  const event = scrub({
    event: '$pageview',
    properties: {
      $current_url: 'https://www.huntz.ai/hunt/abc?ref=TOKEN_REF&via=TOKEN_VIA&code=7ZQK9M3H&utm_source=tiktok#frag',
      $referrer: 'https://huntz.ai/hunt/abc?ref=TOKEN_REF',
      $session_entry_url: 'http://localhost:3000/hunt?ref=TOKEN_REF',
      utm_source: 'tiktok',
      $set: { $current_url: 'https://huntz.ai/auth/callback?code=AUTH_CODE' },
      $set_once: { $initial_current_url: 'https://huntz.ai/mailbox/gmail-action/pair?signature=SIG', $initial_referrer: '$direct' },
    },
    $set_once: { $initial_current_url: 'https://www.huntz.ai/payouts/return?account=acct_1' },
  });
  const wire = JSON.stringify(event);
  assert.doesNotMatch(wire, /TOKEN_REF|TOKEN_VIA|7ZQK9M3H|AUTH_CODE|SIG|acct_1|frag/);
  assert.equal(event.properties.$current_url, 'https://www.huntz.ai/hunt/abc');
  assert.equal(event.properties.$set.$current_url, 'https://huntz.ai/auth/callback');
  assert.equal(event.properties.utm_source, 'tiktok', 'campaign properties are separate and untouched');
  assert.equal(event.properties.$set_once.$initial_referrer, '$direct');
  // Marketing URLs keep their campaign query: that is how UTM reporting works.
  const kept = scrub({ properties: { $current_url: 'https://www.huntz.ai/faq?utm_source=tiktok&utm_campaign=launch', href: '/hunt/x' } });
  assert.equal(kept.properties.$current_url, 'https://www.huntz.ai/faq?utm_source=tiktok&utm_campaign=launch');
  assert.equal(kept.properties.href, '/hunt/x');
});

// ---------------------------------------------------------- events

/** A page with the structure the script classifies by, built like the real ones. */
function site() {
  const body = new El('body');
  const mk = (tag, attrs, parent) => new El(tag, attrs, parent || body);
  const a = (href, parent, attrs = {}) => mk('a', { href, ...attrs }, parent);
  const hero = mk('section', { id: 'hz-hero' });
  const nav = mk('div', { id: 'hz-nav' });
  const hunts = mk('section', { id: 'hunts' });
  const cta = mk('section', { id: 'cta' });
  const footer = mk('footer');
  const drawer = mk('div', { 'aria-modal': 'true' });
  const header = mk('header');
  const plate = mk('aside', { 'data-cta': '' });
  const plateFooter = mk('nav', { 'data-hz-footernav': '' }, plate);
  const STORE = 'https://apps.apple.com/app/id6802558635';
  return {
    body,
    heroBadge: a(STORE, hero, { 'data-appstore-badge': '' }),
    heroAndroid: a('#waitlist', hero, { 'data-android-link': '' }),
    navPill: a(STORE, nav),
    navLink: a('#mechanic', nav),
    finalBadge: a(STORE, cta),
    huntCard: a('https://huntz.ai/hunt/07bfc657-8dba-4a48-9842-63ea34d0f5e3?code=7ZQK9M3H', hunts, { 'data-hunt-link': '' }),
    footerTerms: a('/terms', footer),
    footerHunts: a('#hunts', footer),
    drawerApp: a(STORE, drawer),
    drawerFaq: a('/faq', drawer),
    headerPill: a(STORE, header, { 'data-hz-desknav': '' }),
    plateApp: a(STORE, plate),
    plateAndroid: a('/#waitlist', plate),
    plateFooterFaq: a('/faq', plateFooter),
    inCopyApp: a(STORE, mk('main')),
    inCopyLink: a('/faq', mk('p')),
    mailto: a('mailto:team@huntz.ai', footer),
    deepLink: a('huntz:///hunt/abc', mk('main')),
    external: a('https://example.com/x?y=1', mk('main')),
    text: { nodeType: 3, parentElement: null },
  };
}
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('download clicks: website_cta_clicked with cta, location and href, plus person properties', () => {
  const s = site();
  const r = run(SHIPPED);
  const expected = [
    ['heroBadge', 'hero'], ['navPill', 'nav'], ['finalBadge', 'final'], ['drawerApp', 'drawer'],
    ['headerPill', 'nav'], ['plateApp', 'plate'], ['inCopyApp', 'content'],
  ];
  for (const [key, where] of expected) {
    const before = r.calls().length;
    r.fire('click', s[key]);
    const call = r.calls()[before];
    assert.ok(call, `${key}: an event was sent`);
    assert.equal(call.name, 'website_cta_clicked');
    assert.equal(call.props.cta, 'download_app', key);
    assert.equal(call.props.location, where, key);
    assert.equal(call.props.href, 'https://apps.apple.com/app/id6802558635');
    assert.deepEqual(call.props.$set, { clicked_download_app: true, last_download_app_click_location: where }, key);
    assert.deepEqual(Object.keys(call.props.$set_once), ['first_download_app_click_at']);
    assert.match(call.props.$set_once.first_download_app_click_at, ISO);
    assert.deepEqual(call.opts, { transport: 'sendBeacon', send_instantly: true }, 'survives the page leaving');
    assert.deepEqual(Object.keys(call.props).sort(), ['$set', '$set_once', 'cta', 'href', 'location']);
  }
});

test('the Android notify link records the same person properties under its own names', () => {
  const s = site();
  const r = run(SHIPPED);
  r.fire('click', s.heroAndroid);
  r.fire('click', s.plateAndroid);
  const [hero, plate] = r.calls();
  assert.equal(hero.props.cta, 'android_notify');
  assert.equal(hero.props.location, 'hero');
  assert.equal(hero.props.href, '/#waitlist');
  assert.deepEqual(hero.props.$set, { clicked_android_notify: true, last_android_notify_click_location: 'hero' });
  assert.match(hero.props.$set_once.first_android_notify_click_at, ISO);
  assert.equal(plate.props.location, 'plate');
  assert.equal(plate.props.href, '/#waitlist');
});

test('before the App Store switch is on the same links are join_waitlist, with their own person properties', () => {
  const src = read('build/analytics.js').replace(/^\/\*[\s\S]*?\*\/\n/, '')
    .replace('__POSTHOG_TOKEN__', analytics.POSTHOG_PROJECT_TOKEN).replace('__WAITLIST_CTA__', 'join_waitlist').replace('__WAITLIST_FORM__', 'waitlist');
  const s = site();
  const r = run(src);
  r.fire('click', s.heroAndroid);
  const [call] = r.calls();
  assert.equal(call.props.cta, 'join_waitlist');
  assert.deepEqual(call.props.$set, { clicked_join_waitlist: true, last_join_waitlist_click_location: 'hero' });
  assert.match(call.props.$set_once.first_join_waitlist_click_at, ISO);
  const f = new El('form', {}, s.body); new El('input', { type: 'email' }, f);
  r.fire('submit', f);
  assert.deepEqual(r.calls()[1].props, { form: 'waitlist' });
});

test('Hunt cards, route links and footer links are tracked without person properties', () => {
  const s = site();
  const r = run(SHIPPED);
  const cases = [
    ['huntCard', 'hunt_card', 'hunts', 'https://huntz.ai/hunt/07bfc657-8dba-4a48-9842-63ea34d0f5e3'],
    ['navLink', 'nav', 'nav', '/#mechanic'],
    ['footerTerms', 'nav', 'footer', '/terms'],
    ['footerHunts', 'nav', 'footer', '/#hunts'],
    ['drawerFaq', 'nav', 'drawer', '/faq'],
    ['plateFooterFaq', 'nav', 'footer', '/faq'],
  ];
  for (const [key, cta, where, href] of cases) {
    const before = r.calls().length;
    r.fire('click', s[key]);
    const call = r.calls()[before];
    assert.deepEqual(call.props, { cta, location: where, href }, key);
  }
  assert.doesNotMatch(JSON.stringify(r.calls()), /7ZQK9M3H/, 'the Hunt code in a card link is dropped with the rest of the query');
});

test('clicks that are not CTAs send nothing: copy links, mailto, app deep links, external sites, bare text', () => {
  const s = site();
  const r = run(SHIPPED);
  for (const key of ['inCopyLink', 'mailto', 'deepLink', 'external', 'text']) r.fire('click', s[key]);
  r.fire('click', null);
  assert.deepEqual(r.calls(), []);
});

test('a click on an element inside a link is attributed to the link', () => {
  const s = site();
  const r = run(SHIPPED);
  const img = new El('img', {}, s.heroBadge);
  r.fire('click', img);
  assert.equal(r.calls()[0].props.cta, 'download_app');
});

test('the email form reports that it was submitted, never the address', () => {
  const s = site();
  const r = run(SHIPPED);
  const f = new El('form', {}, s.body);
  new El('input', { type: 'email', value: 'someone@example.com' }, f);
  r.fire('submit', f);
  const [call] = r.calls();
  assert.equal(call.name, 'website_waitlist_submitted');
  assert.deepEqual(call.props, { form: 'android_notify' });
  assert.doesNotMatch(JSON.stringify(call), /example\.com/);
  // The contact form has no email-only trigger here: it is reported when it succeeds.
  const contact = new El('form', { id: 'hz-contact' }, s.body);
  new El('input', { type: 'email' }, contact);
  r.fire('submit', contact);
  assert.equal(r.calls().length, 1);
  // A form without an email field is not a waitlist form.
  r.fire('submit', new El('form', {}, s.body));
  assert.equal(r.calls().length, 1);
});

test('the contact form is reported when its success panel is revealed, not when it is attempted', () => {
  const done = new El('div', { id: 'hz-contact-done', hidden: true });
  const r = run(SHIPPED, { pathname: '/contact', elements: { 'hz-contact-done': done } });
  assert.equal(r.observers.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(r.observers[0].opts)), { attributes: true, attributeFilter: ['hidden'] });
  r.observers[0].cb();                       // still hidden: an attribute changed, but not to visible
  assert.deepEqual(r.calls(), []);
  done.hidden = false;
  r.observers[0].cb();
  assert.deepEqual(r.calls().map((c) => [c.name, c.props]), [['website_contact_submitted', { form: 'contact' }]]);
  // Pages without the panel, and a document still loading, are both fine.
  assert.equal(run(SHIPPED).observers.length, 0);
  const early = run(SHIPPED, { readyState: 'loading', elements: { 'hz-contact-done': done } });
  assert.equal(early.observers.length, 0);
  early.fire('DOMContentLoaded');
  assert.equal(early.observers.length, 1);
});

test('a resolved Hunt page reports one view with the id and path, and nothing else is added', () => {
  const r = run(SHIPPED, { pathname: '/hunt/read-12-books', huntId: 'read-12-books' });
  assert.deepEqual(r.calls().map((c) => [c.name, c.props]), [['website_hunt_viewed', { huntId: 'read-12-books', path: '/hunt/read-12-books' }]]);
  assert.deepEqual(run(SHIPPED, { pathname: '/hunt/read-12-books' }).calls(), [], 'no stamp, no event');
  for (const bad of ['', 'a/b', 'x'.repeat(129), 'bad id', '<x>', 'a?b']) {
    assert.deepEqual(run(SHIPPED, { huntId: bad }).calls(), [], JSON.stringify(bad));
  }
});

test('a page whose analytics throw still behaves: a failing capture is swallowed', () => {
  const s = site();
  const r = run(SHIPPED);
  r.ctx.posthog.capture = () => { throw new Error('blocked'); };
  assert.doesNotThrow(() => r.fire('click', s.heroBadge));
  r.ctx.posthog = undefined;
  assert.doesNotThrow(() => r.fire('click', s.heroBadge));
});

// ---------------------------------------------------------- build wiring

test('the build ties the waitlist wording to the App Store switch, and keeps the script out of the artifact', () => {
  const py = read('build/assemble.py');
  assert.match(py, /"__WAITLIST_CTA__", "android_notify" if APP_STORE_URL else "join_waitlist"/);
  assert.match(py, /"__WAITLIST_FORM__", "android_notify" if APP_STORE_URL else "waitlist"/);
  // with_analytics is called for the public pages only.
  const calls = py.match(/with_analytics\(/g).length;
  assert.equal(calls, 1 /* def */ + 5 /* home, legal+content loops, blog article, blog index */);
  for (const optOut of ['hunt_page', 'auth_page', 'payout_page', 'gmail-pair-page', 'fragment']) {
    assert.doesNotMatch(py, new RegExp('with_analytics\\([^)]*' + optOut));
  }
});

test('README documents the events, the guards and the person properties', () => {
  const readme = read('README.md');
  const start = readme.indexOf('\n## Analytics');
  assert.ok(start > 0, 'an Analytics section exists');
  const rest = readme.slice(start + 1);
  const end = rest.indexOf('\n## ', 5);
  const section = end > 0 ? rest.slice(0, end) : rest;
  for (const needle of ['website_cta_clicked', 'website_hunt_viewed', 'website_waitlist_submitted', 'website_contact_submitted',
    'huntz.ai', 'www.huntz.ai', 'Do Not Track', 'clicked_download_app', 'first_download_app_click_at', 'last_download_app_click_location',
    'clicked_android_notify', 'clicked_join_waitlist', 'persistent', 'person']) {
    assert.ok(section.includes(needle), `README Analytics section lacks ${needle}`);
  }
  assert.doesNotMatch(section, /\u2014|\u2013/, 'no em or en dashes');
});
