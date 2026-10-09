'use strict';
// Tests for Apple's "Download on the App Store" badge, which replaced the big
// accent "Download app" pills in the home page's hero and closing section
// (founder revision, 2026-10-09: build/assemble.py's App Store badge block,
// with (AS-2) and (AS-3)). Our own small accent pill stays in the nav and the
// drawer; those are asserted in test/app-store-launch.test.js.
//
//     npm test          (or: node --test "test/*.test.js")
//
// What Apple asks of the badge (https://developer.apple.com/app-store/marketing/guidelines/,
// "Graphic Standards" and "Badge Use"): the artwork exactly as supplied, a
// minimum on-screen height of 40px, clear space of a quarter of the badge
// height around it, and no modifying, angling or animating of it. The tests
// below read the committed pages and assets, the same way build/check.py does.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP_STORE_URL = 'https://apps.apple.com/app/id6802558635';

/** The SHA-256 of the file Apple's Marketing Tools served on 2026-10-09 (black, English). */
const APPLE_BADGE_SHA256 = 'a26fc5b38380272c92e9019a2eb8b45542a66814b3e2b203772db8904b9fb99f';

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const assemblePy = fs.readFileSync(path.join(ROOT, 'build', 'assemble.py'), 'utf8');
const sourceBytes = fs.readFileSync(path.join(ROOT, 'build', 'source', 'app-store-badge-black-en-us.svg'));
const sourceText = sourceBytes.toString('utf8');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The markup from one marker up to the next, both required to exist. */
function between(startMarker, endMarker, src = html) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, `marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, `marker not found after ${startMarker}: ${endMarker}`);
  return src.slice(a, b);
}

// ----------------------------------------------------- the artwork, as supplied

test('badge source: build/source holds exactly the file Apple supplied, pinned by SHA-256', () => {
  assert.equal(sourceBytes.length, 10804);
  assert.equal(sha256(sourceBytes), APPLE_BADGE_SHA256, 'the artwork must stay exactly as Apple supplied it');
  assert.match(assemblePy, new RegExp(`APP_STORE_BADGE_SHA256 = "${APPLE_BADGE_SHA256}"`),
    'the generator pins the same hash, so the build stops if the file is edited');
  assert.match(assemblePy, /assert hashlib\.sha256\(APP_STORE_BADGE_BYTES\)\.hexdigest\(\) == APP_STORE_BADGE_SHA256/);
});

test('badge source: it is the black "Download on the App Store" badge at Apple\'s 40px native height, with its grey outline', () => {
  assert.match(sourceText, /<svg id="livetype" xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="119\.66407" height="40" viewBox="0 0 119\.66407 40">/);
  assert.match(sourceText, /<title>Download_on_the_App_Store_Badge_US-UK_RGB_blk_4SVG_092917<\/title>/);
  // Apple: the grey border around the black badge is part of the artwork.
  assert.equal((sourceText.match(/style="fill: #a6a6a6"/g) || []).length, 1, 'the outline');
  assert.equal((sourceText.match(/style="fill: #fff"/g) || []).length, 23, 'the white lettering and mark');
});

test('badge source: it is plain static artwork, safe to serve from a public site (no script, no external reference)', () => {
  const elements = new Set([...sourceText.matchAll(/<([a-zA-Z][a-zA-Z0-9:]*)/g)].map((m) => m[1]));
  assert.deepEqual([...elements].sort(), ['g', 'path', 'svg', 'title']);
  assert.doesNotMatch(sourceText, /<script|<style|<foreignObject|<image|<use|<a[\s>]|javascript:/i);
  assert.doesNotMatch(sourceText, /\son[a-z]+\s*=/i, 'no event handler attributes');
  assert.doesNotMatch(sourceText, /(?:xlink:)?href\s*=|url\(/i, 'no references to anything else');
  const urls = [...sourceText.matchAll(/https?:\/\/[^"'\s)<]+/g)].map((m) => m[0]);
  assert.deepEqual(urls, ['http://www.w3.org/2000/svg'], 'the namespace is the only URL');
});

test('badge asset: the page serves that very file, byte for byte, under a content-hashed name', () => {
  const served = fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => /^app-store-badge-black\..*\.svg$/.test(f));
  assert.deepEqual(served, [`app-store-badge-black.${APPLE_BADGE_SHA256.slice(0, 8)}.svg`],
    'exactly one served copy, named for its hash, so no stale sibling lingers');
  const bytes = fs.readFileSync(path.join(ROOT, 'assets', served[0]));
  assert.ok(bytes.equals(sourceBytes), 'the served badge differs from the supplied artwork');
});

test('badge source: the generator names where the file came from, and when', () => {
  const at = assemblePy.indexOf('# Apple\'s official "Download on the App Store" badge');
  assert.notEqual(at, -1, 'the badge block comment was not found');
  const comment = assemblePy.slice(at, assemblePy.indexOf('import hashlib', at));
  assert.match(comment, /https:\/\/toolbox\.marketingtools\.apple\.com\/en-us\/app-store\/us\/app\/6802558635/);
  assert.match(comment, /https:\/\/toolbox\.marketingtools\.apple\.com\/api\/v2\/badges\/download-on-the-app-store\/black\/en-us\/download/);
  assert.match(comment, /tools\.applemediaservices\.com\//);
  assert.match(comment, /https:\/\/developer\.apple\.com\/app-store\/marketing\/guidelines\//);
  assert.match(comment, /2026-10-09/);
});

// ------------------------------------------------------------ where it appears

const HERO = between('<section id="hz-hero"', 'id="hz-phone"');
const CLOSING = between('<section id="cta"', '<footer');
const FIN_FORM = between('<div id="fin-form"', "WHAT'S LIVE", CLOSING);

const BADGE_LINK = '<a href="{{ appStoreUrl }}" data-appstore-badge="" aria-label="Download on the App Store">'
  + `<img src="/assets/app-store-badge-black.${APPLE_BADGE_SHA256.slice(0, 8)}.svg" alt="Download on the App Store" width="144" height="48"></a>`;

test('badge markup: the hero and the closing CTA each carry exactly one, as a plain link to the App Store listing', () => {
  assert.equal(HERO.split(BADGE_LINK).length - 1, 1, 'hero');
  assert.equal(FIN_FORM.split(BADGE_LINK).length - 1, 1, 'closing CTA');
  assert.equal(html.split(BADGE_LINK).length - 1, 2, 'and nowhere else on the page');
  // The link target is the same switch-driven store URL as the nav pill.
  assert.match(html, new RegExp(`APP_STORE_URL = '${escapeRe(APP_STORE_URL)}'`));
  assert.match(html, /appStoreUrl: this\.APP_STORE_URL/);
  // Accessible name and fallback text are Apple's own wording.
  assert.equal((BADGE_LINK.match(/Download on the App Store/g) || []).length, 2);
});

test('badge markup: nothing is done to the artwork: no inline style, class, hover, active or transition on the link or the image', () => {
  const link = BADGE_LINK;
  assert.doesNotMatch(link, /style|class|hover|active|transition|animation|filter|opacity|transform/i);
  // The only rules that name the badge are the three sizing ones.
  const rules = html.split('\n').filter((l) => /^(\[data-appstore-badge\]|@media[^\n]*\[data-appstore-badge\])/.test(l));
  assert.deepEqual(rules, [
    '[data-appstore-badge]{display:inline-block;line-height:0;border-radius:11px}',
    '[data-appstore-badge] img{display:block;height:48px;width:auto}',
    '@media (max-width:640px){[data-appstore-badge] img{height:44px}}',
  ]);
  for (const rule of rules) {
    assert.doesNotMatch(rule, /filter|opacity|transform|transition|animation|rotate|mix-blend|background|color|box-shadow/i, rule);
  }
  assert.doesNotMatch(html, /\[data-appstore-badge\][^{]*:(hover|active|focus)\s*\{/, 'no state styling of the artwork');
});

test('badge markup: our own Apple glyph never sits beside Apple\'s badge, and the old pills are gone from the hero and the closing CTA', () => {
  for (const [name, region] of [['hero', HERO], ['closing CTA', FIN_FORM]]) {
    assert.doesNotMatch(region, /viewBox="0 0 384 512"/, `${name}: the accent pill's glyph`);
    assert.doesNotMatch(region, /appStoreLabel|Download app/, `${name}: the accent pill's label`);
    assert.doesNotMatch(region, /border-radius:999px/, `${name}: the pill shape`);
  }
});

// ------------------------------------------------------------------- the size

/** The displayed height Apple's file gets at each breakpoint, from the page's own CSS. */
function badgeHeights() {
  const base = html.match(/\[data-appstore-badge\] img\{display:block;height:(\d+)px;width:auto\}/);
  const phone = html.match(/@media \(max-width:640px\)\{\[data-appstore-badge\] img\{height:(\d+)px\}\}/);
  assert.ok(base && phone, 'the badge sizing rules were not found');
  return { desktop: Number(base[1]), phone: Number(phone[1]) };
}

test('badge size: about 48px high on desktop and 44px on phones, never under Apple\'s 40px minimum', () => {
  const { desktop, phone } = badgeHeights();
  assert.equal(desktop, 48);
  assert.equal(phone, 44);
  assert.ok(desktop >= 40 && phone >= 40, 'Apple: minimum badge height is 40px onscreen');
  // The width follows from the height (width:auto) and the artwork's own 119.66 x 40 shape,
  // so the badge is never stretched: 143.6px at 48px, 131.6px at 44px.
  const shape = 119.66407 / 40;
  assert.ok(Math.abs(desktop * shape - 143.6) < 0.1 && Math.abs(phone * shape - 131.6) < 0.1);
  // The width/height attributes only reserve the space before the file loads.
  assert.match(BADGE_LINK, /width="144" height="48"/);
});

// ------------------------------------------------------------------ clear space

test('badge clear space: whatever sits above or below a badge is at least a quarter of its height away', () => {
  const { desktop, phone } = badgeHeights();
  const quarter = Math.ceil(desktop / 4);     // 12px, the larger of the two
  assert.ok(Math.ceil(phone / 4) <= quarter);
  // Hero: the badge sits alone in its own block, under the sub paragraph
  // (margin-bottom 34px), so nothing but that block's own edges is near it.
  const heroBlock = between('<div style="animation:hzRise .7s ease .74s both">', '</div>', HERO);
  assert.equal(heroBlock.split('<a ').length - 1, 1, 'the hero badge block holds the badge and nothing else');
  assert.match(HERO, /<p style="margin: 0 0 34px;/, 'the sub above it ends 34px away');
  assert.ok(34 >= quarter);
  // Closing: the line above is #fin-sub, which keeps clamp(24px,4vh,34px) of its own.
  assert.match(CLOSING, /<p id="fin-sub" style="margin:0 0 clamp\(24px,4vh,34px\);/);
  assert.ok(24 >= quarter, 'the smallest value of that clamp still clears');
});
