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
  summaryLabel: 'Reflection each day', stakeRange: { minMinor: '2000', maxMinor: '50000' },
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

test('live homepage uses the same card design, at most five cards and apex links', async () => {
  const result = await render(home.handle, async () => page(Array.from({ length: 7 }, (_, i) => ({ ...item, id: 'hunt-' + i }))));
  const content = rail(result.body);
  assert.equal((content.match(/data-plate=""/g) || []).length, 5);
  assert.equal((content.match(/href="https:\/\/huntz.ai\/hunt\/hunt-/g) || []).length, 5);
  for (const value of ['REFLECTION EACH DAY', '21 DAYS', 'FROM $20', 'OCT 20']) assert.ok(content.includes(value));
  assert.equal(result.headers['Cache-Control'], CACHE_CONTROL);
  assert.doesNotMatch(content, /978654321|876543219|participantCount|poolTotalMinor/);
  assert.equal(result.body.split('<!-- HUNT_RAIL_START -->')[0], homeHtml.split('<!-- HUNT_RAIL_START -->')[0]);
  assert.equal(result.body.split('<!-- HUNT_RAIL_END -->')[1], homeHtml.split('<!-- HUNT_RAIL_END -->')[1]);
  const staticLinks = [...rail(homeHtml).matchAll(/data-hunt-link="" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(staticLinks.length, 3);
  assert.ok(staticLinks.every((url) => url.startsWith('https://huntz.ai/hunt/')));
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
  assert.match(output, /FROM \$20/);
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
  for (const value of ['21 days', 'Reflection each day', 'October 20, 2026', 'From $20', 'Jordan']) assert.ok(result.body.includes(value));
  assert.doesNotMatch(result.body + calls.join(''), /SECRET_REF|SECRET_VIA|[?&](?:ref|via)=|978654321|876543219/);
  const schema = JSON.parse(result.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema['@type'], 'Event'); assert.equal(schema.organizer.name, 'Jordan');
  assert.equal(schema.startDate, item.startAt); assert.equal(schema.offers.price, '20.00');
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

test('iPhone only app button executes without reading query strings or navigating', async () => {
  const result = await render(hunt.handle, upstream(), '/hunt/public-hunt');
  assert.match(result.body, /data-hunt-open hidden href="huntz:\/\/\/hunt\/public-hunt"/);
  const script = result.body.match(/<script>(\(function\(\)\{if\(\/iPhone[\s\S]*?)<\/script>/)[1];
  for (const ua of ['iPhone', 'iPad', 'Macintosh', 'Android']) {
    const button = { hidden: true, style: {} };
    vm.runInNewContext(script, { navigator: { userAgent: ua }, document: { querySelector: () => button } });
    assert.equal(button.hidden, ua !== 'iPhone');
  }
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

test('minimum stakes use API minor units, enforce $20 and reject malformed money', () => {
  assert.equal(stakeLabel({ stakeRange: { minMinor: '3550' } }), 'From $35.50');
  assert.equal(stakeLabel({ stakeRange: { minMinor: '1000' } }), 'From $20');
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
