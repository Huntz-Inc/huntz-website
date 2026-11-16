'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { fetchPublicHunts, CACHE_CONTROL, stakeLabel } = require('../api/_lib/public-hunts');
const home = require('../api/home');
const hunt = require('../api/hunt');
const sitemap = require('../api/sitemap');

const now = new Date('2026-10-01T00:00:00Z');
const item = {
  id: 'public-hunt', title: 'Read with Jordan', description: 'Read and reflect daily.',
  creatorDisplayName: 'Jordan', startAt: '2026-10-20T07:00:00Z', timeZone: 'America/Los_Angeles',
  enrollmentStatus: 'OPEN', visibility: 'PUBLIC', duration: { windowCount: 21, windowUnitLabel: 'day' },
  summaryLabel: 'Reflection each day', stakeRange: { minMinor: '2500', maxMinor: '50000' },
  coverArtUrl: '/v1/hunts/public-hunt/cover-art?v=asset-1',
  participantCount: 978654321, poolTotalMinor: '876543219',
};
const response = (body, status = 200) => ({ status, json: async () => body });
const page = (items, nextCursor = null) => response({ items, nextCursor });
const homeHtml = fs.readFileSync('index.html', 'utf8');
const fallback = fs.readFileSync('api/_lib/hunt-fallback.html', 'utf8');
const card = fs.readFileSync('api/_lib/hunt-card.html', 'utf8');
const baseSitemap = fs.readFileSync('sitemap.xml', 'utf8');
const rail = (html) => html.split('<!-- HUNT_RAIL_START -->')[1].split('<!-- HUNT_RAIL_END -->')[0];

async function render(handler, fetchImpl, url = '/', extras = {}) {
  const result = { headers: {} };
  await handler({ url }, { setHeader: (key, value) => { result.headers[key] = value; },
    end: (body) => { result.body = body; } }, { fetchImpl, now, ...extras });
  return result;
}
function upstream(detail = item, listed = [item]) {
  return async (url) => new URL(url).pathname === '/v1/hunts' ? page(listed) : response(detail);
}

test('Discover follows every cursor, sends only public GETs and sorts/deduplicates cards', async () => {
  const calls = [];
  const hunts = await fetchPublicHunts({ now, fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(new URL(url).pathname, '/v1/hunts');
    assert.deepEqual(options.headers, { accept: 'application/json' });
    assert.equal(options.redirect, 'error');
    if (calls.length === 1) return page([{ ...item, id: 'later', startAt: '2026-11-01' }], 'opaque+/=&cursor');
    assert.equal(new URL(url).searchParams.get('cursor'), 'opaque+/=&cursor');
    return page([item, item]);
  } });
  assert.equal(calls.length, 2);
  assert.deepEqual(hunts.map((h) => h.id), ['public-hunt', 'later']);
});

test('Discover never returns hidden, unpublished, canceled, closed or invalid entries', async () => {
  const excluded = [
    { visibility: 'UNLISTED' }, { visibility: 'UNLISTED_CODE' }, { requiresCode: true },
    { codeRequired: true }, { lifecycleState: 'DRAFT' }, { lifecycleState: 'CANCELED' },
    { enrollmentStatus: 'CLOSED' }, { enrollmentStatus: 'UPCOMING' },
    { enrollmentClosesAt: now.toISOString() }, { enrollmentClosesAt: 'invalid' },
    { canceledAt: now.toISOString() }, { id: '..' }, { id: 'bad/id' }, { startAt: 'invalid' },
  ].map((change, i) => ({ ...item, id: 'excluded-' + i, ...change }));
  const fetchImpl = async () => page([item, ...excluded]);
  const list = await fetchPublicHunts({ fetchImpl, now });
  assert.deepEqual(list.map((h) => h.id), [item.id]);
  const homeResult = await render(home.handle, fetchImpl);
  const sitemapResult = await render(sitemap.handle, fetchImpl);
  assert.doesNotMatch(rail(homeResult.body) + sitemapResult.body, /excluded-/);
});

test('an omitted visibility on the public list DTO is allowed, never on detail indexing', async () => {
  const cardDto = { ...item }; delete cardDto.visibility;
  assert.equal((await fetchPublicHunts({ fetchImpl: async () => page([cardDto]) })).length, 1);
  const result = await render(hunt.handle, upstream(cardDto), '/hunt/public-hunt');
  assert.match(result.body, /name="robots" content="noindex"/);
});

test('failed pagination, malformed pages, looping cursors and network errors fail closed', async () => {
  for (const fail of [async () => response({}, 503), async () => response({ items: [] }),
    async () => response({ items: null, nextCursor: null }), async () => { throw Error('offline'); }]) {
    let calls = 0;
    assert.equal(await fetchPublicHunts({ fetchImpl: async () => ++calls === 1 ? page([item], 'next') : fail() }), null);
  }
  assert.equal(await fetchPublicHunts({ fetchImpl: async () => page([item], 'same') }), null);
  let aborted = false;
  assert.equal(await fetchPublicHunts({ listTimeoutMs: 5, fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(Error('aborted')); });
  }) }), null);
  assert.equal(aborted, true);
});

test('live homepage uses the same card design, shows every listed Hunt and uses apex links', async () => {
  const result = await render(home.handle, async () => page(Array.from({ length: 7 }, (_, i) => ({ ...item, id: 'hunt-' + i }))));
  const content = rail(result.body);
  assert.equal((content.match(/data-plate=""/g) || []).length, 7);
  assert.equal((content.match(/href="https:\/\/huntz.ai\/hunt\/hunt-/g) || []).length, 7);
  for (const value of ['REFLECTION EACH DAY', '21 DAYS', 'FROM $25', 'OCT 20']) assert.ok(content.includes(value));
  assert.equal(result.headers['Cache-Control'], CACHE_CONTROL);
  assert.doesNotMatch(content, /978654321|876543219|participantCount|poolTotalMinor/);
  assert.equal(result.body.split('<!-- HUNT_RAIL_START -->')[0], homeHtml.split('<!-- HUNT_RAIL_START -->')[0]);
  assert.equal(result.body.split('<!-- HUNT_RAIL_END -->')[1], homeHtml.split('<!-- HUNT_RAIL_END -->')[1]);
  const staticLinks = [...rail(homeHtml).matchAll(/data-hunt-link="" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(staticLinks.length, 3);
  assert.ok(staticLinks.every((url) => url.startsWith('https://huntz.ai/hunt/')));
});

test('live homepage has no card cap: twelve listed Hunts render twelve cards in start order', async () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ ...item, id: 'hunt-' + String(i).padStart(2, '0'),
    startAt: new Date(Date.parse('2026-10-20T07:00:00Z') + (11 - i) * 86400000).toISOString() }));
  const result = await render(home.handle, async () => page(items));
  const content = rail(result.body);
  assert.equal((content.match(/data-plate=""/g) || []).length, 12);
  const ids = [...content.matchAll(/href="https:\/\/huntz.ai\/hunt\/(hunt-\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, items.map((h) => h.id).reverse());
  assert.ok(content.includes('HUNT 12'));
});

test('homepage outage preserves static cards byte for byte; successful empty list removes them', async () => {
  const failed = await render(home.handle, async () => response({}, 503));
  assert.equal(failed.body, homeHtml);
  assert.equal(failed.headers['Cache-Control'], 'no-store');
  const empty = await render(home.handle, async () => page([]));
  assert.match(rail(empty.body), /No Hunts are open right now/);
  assert.doesNotMatch(rail(empty.body), /data-hunt-link|data-plate/);
});

test('card copy is escaped, template expressions stay literal, and replacement dollars survive', () => {
  const output = home.renderCard(card, { ...item, title: '<img src=x onerror=alert(1)> {{ $& }} & "Hi"',
    summaryLabel: 'Read\u2014daily!', stakeRange: { minMinor: '1000' } }, 0);
  assert.doesNotMatch(output, /<img|\{\{|\u2014|daily!|FROM \$10/);
  assert.match(output, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(output, /\$&amp;/);
  assert.match(output, /FROM \$25/);
  assert.equal(home.escapeTemplateText('{{x}}').replace(/&#8203;/g, '\u200b').includes('{{'), false);
});

test('sitemap includes every page of Discover and drops removed Hunts on regeneration', async () => {
  const first = await render(sitemap.handle, async (url) => new URL(url).searchParams.has('cursor')
    ? page([{ ...item, id: 'second' }]) : page([item], 'next'));
  assert.match(first.body, /https:\/\/huntz.ai\/hunt\/public-hunt/);
  assert.match(first.body, /https:\/\/huntz.ai\/hunt\/second/);
  assert.ok(first.body.includes('<loc>https://www.huntz.ai/about</loc>'));
  const closed = await render(sitemap.handle, async () => page([]));
  assert.equal(closed.body, baseSitemap);
  const outage = await render(sitemap.handle, async () => response({}, 500));
  assert.equal(outage.body, baseSitemap);
  assert.equal(outage.headers['Cache-Control'], 'no-store');
});

test('PUBLIC open detail confirmed in Discover is crawlable with canonical, OG, JSON-LD and details', async () => {
  const calls = [];
  const result = await render(hunt.handle, async (url, options) => {
    calls.push(url); assert.equal(options.headers.authorization, undefined);
    return upstream()(url);
  }, '/hunt/public-hunt?ref=SECRET_REF&via=SECRET_VIA');
  assert.match(result.body, /name="robots" content="index, follow"/);
  assert.match(result.body, /rel="canonical" href="https:\/\/huntz.ai\/hunt\/public-hunt"/);
  assert.match(result.body, /name="description" content="Read and reflect daily\."/);
  for (const value of ['21 days', 'Reflection each day', 'October 20, 2026', 'From $25', 'Jordan']) assert.ok(result.body.includes(value));
  assert.doesNotMatch(result.body + calls.join(''), /SECRET_REF|SECRET_VIA|[?&](?:ref|via)=|978654321|876543219/);
  const schema = JSON.parse(result.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema['@type'], 'Event'); assert.equal(schema.organizer.name, 'Jordan');
  assert.equal(schema.startDate, item.startAt); assert.equal(schema.offers.price, '25.00');
  assert.equal(schema.image, 'https://api.huntz.ai' + item.coverArtUrl);
  assert.equal(result.headers['Cache-Control'], CACHE_CONTROL);
});

test('unlisted, code-bearing, closed, draft and absent-list detail pages never become indexable', async () => {
  for (const change of [{ visibility: 'UNLISTED' }, { visibility: 'UNLISTED_CODE' },
    { enrollmentStatus: 'CLOSED' }, { lifecycleState: 'CANCELED' }, { lifecycleState: 'DRAFT' }]) {
    const result = await render(hunt.handle, upstream({ ...item, ...change }), '/hunt/public-hunt');
    assert.match(result.body, /name="robots" content="noindex"/);
    assert.doesNotMatch(result.body, /rel="canonical"|application\/ld\+json/);
    assert.equal(result.headers['Cache-Control'], 'no-store');
  }
  for (const fetchImpl of [upstream(item, []), async (url) => new URL(url).pathname === '/v1/hunts' ? response({}, 503) : response(item)]) {
    const result = await render(hunt.handle, fetchImpl, '/hunt/public-hunt');
    assert.match(result.body, /name="robots" content="noindex"/);
  }
  const coded = await render(hunt.handle, upstream(), '/hunt/public-hunt?code=7ZQK9M3H');
  assert.doesNotMatch(coded.body, /rel="canonical"|application\/ld\+json/);
  assert.match(coded.body, /huntz:\/\/\/hunt\/public-hunt\?code=7ZQK9M3H/);
});

const UA_IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_INSTAGRAM_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.28.116 (iPhone14,5; iOS 17_5_1; en_US; en-US; scale=3.00; 1170x2532; 618927349) NW/3';
const UA_TIKTOK_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.1.0 JsSdk/2.0 NetType/WIFI BytedanceWebview/d8a21c6';
const UA_FACEBOOK_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/465.0.0.38.109;FBBV/600000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]';
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const SCRIPT_RE = /<script>(\(function\(\)\{var ua=navigator\.userAgent;[\s\S]*?)<\/script>/;

/** Runs the page's inline script against a minimal DOM holding the scheme button and the in-app block. */
function runOpenScript(body, ua, { clipboard, execCopy = false } = {}) {
  const script = body.match(SCRIPT_RE)[1];
  const link = body.match(/data-hunt-inapp hidden data-hunt-link="([^"]*)"/)[1];
  const scheme = { hidden: true, style: {}, attrs: { href: 'huntz:///hunt/x' }, listeners: {}, navigated: 0,
    removeAttribute(n) { delete this.attrs[n]; }, setAttribute(n, v) { this.attrs[n] = v; },
    addEventListener(t, f) { this.listeners[t] = f; },
    click() { const e = { prevented: false, preventDefault() { this.prevented = true; } };
      if (this.listeners.click) this.listeners.click(e); if (!e.prevented && this.attrs.href) this.navigated += 1; return e; } };
  const parts = {
    '[data-hunt-inapp-line]': { textContent: '' },
    '[data-hunt-copy]': { textContent: '', listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } },
    '[data-hunt-link-text]': { hidden: true },
  };
  const box = { hidden: true, className: '', scrolled: 0, scrollIntoView() { this.scrolled += 1; }, querySelector: (sel) => parts[sel] || null, getAttribute: (n) => (n === 'data-hunt-link' ? link : null) };
  const copied = [];
  const timers = [];
  const document = {
    body: { appendChild() {}, removeChild() {} },
    querySelector: (sel) => (sel === '[data-hunt-open]' ? scheme : sel === '[data-hunt-inapp]' ? box : null),
    createElement: () => ({ style: {}, setAttribute() {}, select() {}, set value(v) { copied.push(v); } }),
    execCommand: () => execCopy,
  };
  const navigator = { userAgent: ua };
  if (clipboard) navigator.clipboard = { writeText: (v) => clipboard(v, copied) };
  vm.runInNewContext(script, { navigator, document, setTimeout: (f) => timers.push(f), clearTimeout() {} });
  return { schemeEl: scheme, boxEl: box, scheme: !scheme.hidden, block: !box.hidden, line: parts['[data-hunt-inapp-line]'].textContent,
    copy: parts['[data-hunt-copy]'], get linkText() { return !parts['[data-hunt-link-text]'].hidden; }, copied, timers, link };
}

test('iPhone only app button executes without reading query strings or navigating', async () => {
  const result = await render(hunt.handle, upstream(), '/hunt/public-hunt');
  assert.match(result.body, /data-hunt-open hidden href="huntz:\/\/\/hunt\/public-hunt"/);
  const script = result.body.match(SCRIPT_RE)[1];
  assert.doesNotMatch(script, /location|referrer|document\.cookie|Storage|URLSearchParams|[^\x00-\x7f]/);
  for (const ua of ['iPhone', 'iPad', 'Macintosh', 'Android']) {
    assert.equal(runOpenScript(result.body, ua).scheme, ua === 'iPhone', ua);
  }
});

test('served HTML has no x-safari anchor and carries the hidden in-app block with the link and code', async () => {
  const plain = await render(hunt.handle, upstream(), '/hunt/public-hunt');
  assert.doesNotMatch(plain.body, /x-safari/);
  assert.match(plain.body, /data-hunt-inapp hidden data-hunt-link="https:\/\/huntz\.ai\/hunt\/public-hunt"/);
  const coded = await render(hunt.handle, upstream(), '/hunt/public-hunt?code=7ZQK9M3H&ref=zzrefzz&via=zzviazz');
  assert.match(coded.body, /<a data-hunt-open hidden href="huntz:\/\/\/hunt\/public-hunt\?code=7ZQK9M3H"/);
  assert.match(coded.body, /data-hunt-inapp hidden data-hunt-link="https:\/\/huntz\.ai\/hunt\/public-hunt\?code=7ZQK9M3H"/);
  assert.doesNotMatch(coded.body, /zzrefzz|zzviazz|x-safari/);
});

test('in-app browsers get the app button AND the instruction block and Copy link', async () => {
  const { body } = await render(hunt.handle, upstream(), '/hunt/public-hunt?code=7ZQK9M3H');
  assert.match(body, /Open this page in Safari to continue/);
  assert.match(body, /Or paste the link into Safari yourself\./);
  const line = (app, menu) => app + ' opens links in its own browser, which cannot open apps. Tap the ••• menu at the top right and choose ' + menu + ', then tap Open in the Huntz app.';
  for (const [ua, app, menu] of [[UA_INSTAGRAM_IOS, 'Instagram', 'Open in external browser'], [UA_TIKTOK_IOS, 'TikTok', 'Open in browser'],
    [UA_FACEBOOK_IOS, 'Facebook', 'Open in external browser']]) {
    const out = runOpenScript(body, ua);
    assert.deepEqual([out.scheme, out.block, out.line], [true, true, line(app, menu)], app);
  }
});

test('in-app: tapping Open in the Huntz app never navigates, scrolls to the card and highlights it for 2 seconds', async () => {
  const { body } = await render(hunt.handle, upstream(), '/hunt/public-hunt?code=7ZQK9M3H');
  const out = runOpenScript(body, UA_INSTAGRAM_IOS);
  assert.equal(out.schemeEl.attrs.href, undefined, 'the scheme href is removed');
  const event = out.schemeEl.click();
  assert.equal(event.prevented, true);
  assert.equal(out.schemeEl.navigated, 0);
  assert.equal(out.boxEl.scrolled, 1);
  assert.equal(out.boxEl.className, 'hunt-flash');
  out.timers.at(-1)();
  assert.equal(out.boxEl.className, '');
  assert.match(body, /\[data-hunt-inapp\]\.hunt-flash\{/);
});

test('Safari keeps the scheme href and click behaviour untouched', async () => {
  const { body } = await render(hunt.handle, upstream(), '/hunt/public-hunt?code=7ZQK9M3H');
  const out = runOpenScript(body, UA_IPHONE_SAFARI);
  assert.equal(out.schemeEl.attrs.href, 'huntz:///hunt/x');
  assert.equal(out.schemeEl.click().prevented, false);
  assert.equal(out.schemeEl.navigated, 1);
});

test('Copy link writes the exact invitation link, flips to Link copied, then back', async () => {
  const { body } = await render(hunt.handle, upstream(), '/hunt/public-hunt?code=7ZQK9M3H');
  const writes = [];
  const out = runOpenScript(body, UA_INSTAGRAM_IOS, { clipboard: (v) => { writes.push(v); return Promise.resolve(); } });
  assert.equal(out.copy.textContent, 'Copy link');
  out.copy.listeners.click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(writes, ['https://huntz.ai/hunt/public-hunt?code=7ZQK9M3H']);
  assert.equal(out.copy.textContent, 'Link copied');
  out.timers[0]();
  assert.equal(out.copy.textContent, 'Copy link');
});

test('Copy link falls back to a hidden textarea, then to showing the link text', async () => {
  const { body } = await render(hunt.handle, upstream(), '/hunt/public-hunt?code=7ZQK9M3H');
  const viaExec = runOpenScript(body, UA_INSTAGRAM_IOS, { execCopy: true });
  viaExec.copy.listeners.click();
  assert.deepEqual(viaExec.copied, ['https://huntz.ai/hunt/public-hunt?code=7ZQK9M3H']);
  assert.equal(viaExec.copy.textContent, 'Link copied');
  const rejected = runOpenScript(body, UA_INSTAGRAM_IOS, { clipboard: () => Promise.reject(new Error('denied')), execCopy: false });
  rejected.copy.listeners.click();
  await new Promise((r) => setImmediate(r));
  assert.equal(rejected.copy.textContent, 'Copy link');
  assert.equal(rejected.linkText, true);
});

test('iPhone Safari shows only the scheme button; desktop shows neither', async () => {
  const { body } = await render(hunt.handle, upstream(), '/hunt/public-hunt');
  const safari = runOpenScript(body, UA_IPHONE_SAFARI);
  assert.deepEqual([safari.scheme, safari.block], [true, false]);
  const desktop = runOpenScript(body, UA_DESKTOP);
  assert.deepEqual([desktop.scheme, desktop.block], [false, false]);
});

test('HTML, attribute and JSON-LD escaping protect every Host-authored value', async () => {
  const hostile = '</script><img src=x onerror=alert(1)> & "$&"';
  const detail = { ...item, title: hostile, description: hostile, creatorDisplayName: hostile,
    lengthLabel: hostile, ruleSummary: { proofCadence: hostile } };
  const result = await render(hunt.handle, upstream(detail), '/hunt/public-hunt');
  assert.doesNotMatch(result.body, /<img src=x|<\/script><img/);
  const json = result.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(json).name, hostile);
  assert.equal(JSON.parse(json).description, hostile);
  assert.ok(result.body.includes('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &amp; &quot;$&amp;&quot;'));
});

test('unresolved Hunt responses preserve the exact fallback bytes', async () => {
  const result = await render(hunt.handle, async () => response({}, 404), '/hunt/missing?ref=SECRET&via=SECRET');
  assert.equal(result.body, fallback);
  assert.equal(result.headers['X-Robots-Tag'], 'noindex');
});

test('a mismatched Hunt id or whitespace title cannot replace the fallback', async () => {
  for (const detail of [{ ...item, id: 'different-hunt' }, { ...item, title: '   ' }]) {
    const result = await render(hunt.handle, upstream(detail), '/hunt/public-hunt');
    assert.equal(result.body, fallback);
  }
});

test('minimum stakes use API minor units, enforce $25 and reject malformed money', () => {
  assert.equal(stakeLabel({ stakeRange: { minMinor: '3550' } }), 'From $35.50');
  assert.equal(stakeLabel({ stakeRange: { minMinor: '1000' } }), 'From $25');
  for (const minMinor of ['NaN', '-100', '20.00', '<script>', null]) {
    assert.equal(stakeLabel({ stakeRange: { minMinor } }), null);
  }
});

test('Vercel routes and scheduled sitemap refresh are packaged', () => {
  const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  for (const [source, destination] of [['/', '/api/home'], ['/sitemap.xml', '/api/sitemap']]) {
    assert.ok(config.rewrites.some((r) => r.source === source && r.destination === destination));
  }
  assert.deepEqual(config.crons, [{ path: '/sitemap.xml', schedule: '0 12 * * *' }]);
  assert.ok(config.functions['api/home.js'].includeFiles.includes('hunt-card.html'));
  assert.ok(config.functions['api/sitemap.js'].includeFiles.includes('sitemap'));
  assert.equal(fs.readFileSync('api/_lib/home-fallback.html', 'utf8'), homeHtml);
  assert.equal(fs.readFileSync('api/_lib/sitemap-base.xml', 'utf8'), baseSitemap);
  const excluded = fs.readFileSync('.vercelignore', 'utf8').split('\n');
  assert.ok(excluded.includes('/index.html'));
  assert.ok(excluded.includes('/sitemap.xml'));
});
