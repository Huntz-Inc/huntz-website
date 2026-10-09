'use strict';
// Tests for the Android notify form's new place and the hero link to it
// (founder revision, 2026-10-09: build/assemble.py's (AS-2), (AS-4) and
// FOCUS_JS). The form ("Not on iPhone? Get notified for Android.", the email
// field, NOTIFY ME, the no-spam line) used to be a section of its own between
// the closing section and the footer. It now sits directly under the closing
// section's App Store badge, and a small muted text link under the hero's badge
// scrolls to it. The form's own markup, its Mailchimp wiring and its one
// #waitlist id are unchanged: the launch-switch tests in
// test/app-store-launch.test.js cover those against the template.
//
//     npm test          (or: node --test "test/*.test.js")
//
// index.html is generated (build/assemble.py) and never hand-edited, so these
// read the committed file, the same way build/check.py does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** The markup from one marker up to the next, both required to exist. */
function between(startMarker, endMarker, src = html) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, `marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, `marker not found after ${startMarker}: ${endMarker}`);
  return src.slice(a, b);
}

/** The words a reader sees: tags gone, entities decoded, whitespace folded. */
function textOf(markup) {
  return markup
    .replace(/<br\s*\/?>|<\/(?:div|p|h\d|li|section|article|nav|footer)>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8594;/g, '→')
    .replace(/\s+/g, ' ')
    .trim();
}

const HERO = between('<section id="hz-hero"', 'id="hz-phone"');
const CLOSING = between('<section id="cta"', '<footer');
const BADGE_RE = /<a href="\{\{ appStoreUrl \}\}" data-appstore-badge="" aria-label="Download on the App Store"><img [^>]*><\/a>/;

// ------------------------------------------------------------ the hero's link

const LINK_RE = /<a href="#waitlist" data-android-link="" style="([^"]*)" style-hover="([^"]*)">([^<]*)<span aria-hidden="true">&#8594;<\/span><\/a>/;

test('hero link: "Not on iPhone? Get notified for Android", a text link in its own block under the badge', () => {
  assert.equal((HERO.match(/data-android-link/g) || []).length, 1, 'exactly one, in the hero');
  const link = HERO.match(LINK_RE);
  assert.ok(link, 'the link was not found, or its markup changed');
  assert.equal(textOf(link[0]), 'Not on iPhone? Get notified for Android →');
  assert.equal(link[3], 'Not on iPhone? Get notified for Android ', 'the arrow is optional and decorative: aria-hidden');
  // Directly after the badge's own block, and in a block of its own.
  const badgeBlock = HERO.search(/<div style="animation:hzRise \.7s ease \.74s both">\s*<a href="\{\{ appStoreUrl \}\}" data-appstore-badge/);
  const linkBlock = HERO.indexOf('<div style="margin-top:22px;animation:hzRise .7s ease .84s both">');
  assert.ok(badgeBlock !== -1 && badgeBlock < linkBlock && linkBlock < HERO.indexOf(link[0]));
  assert.ok(HERO.indexOf(link[0]) > HERO.search(BADGE_RE), 'under the badge, not above it');
  // It belongs to the live branch only: the switched-off hero keeps its form.
  const liveBranch = HERO.slice(HERO.lastIndexOf('<sc-if value="{{ appStoreMode }}"'));
  assert.ok(liveBranch.includes(link[0]));
  assert.ok(!HERO.slice(0, HERO.lastIndexOf('<sc-if value="{{ appStoreMode }}"')).includes('data-android-link'));
});

test('hero link: muted colour, the size of the hero sub, underlined so it reads as a link, clay on hover', () => {
  const [, style, hover] = HERO.match(LINK_RE);
  const subStyle = HERO.match(/<p style="([^"]*)">Stake \$20 to \$500\./)[1];
  const subSize = subStyle.match(/font:\s*400 (clamp\([^)]*\))\//)[1];
  assert.equal(subSize, 'clamp(15px,1.4vw,18px)');
  assert.match(style, new RegExp(`font:500 ${subSize.replace(/[()]/g, '\\$&')}/1\\.5 'Figtree',Arial,Helvetica,sans-serif;`), 'hero-sub size');
  assert.match(style, /color:#6E6759;/, 'the page\'s muted colour (the same as its small labels), which passes AA on the cream ground');
  assert.match(style, /text-decoration:underline;/);
  assert.equal(hover, 'color:#C24E1F', 'the page\'s link hover');
  assert.doesNotMatch(style, /background|border|padding|text-transform|letter-spacing/, 'a plain text link, not a button');
});

test('hero link: it keeps a quarter of the badge height clear (Apple), and rises in just after the badge', () => {
  assert.match(HERO, /<div style="margin-top:22px;animation:hzRise \.7s ease \.84s both">/);
  assert.ok(22 >= Math.ceil(48 / 4), 'the badge is at most 48px high, so 12px is the clear space');
  // The badge is 74 hundredths into the page's rise sequence, the link 84 (where the old no-spam note sat).
  assert.match(HERO, /animation:hzRise \.7s ease \.74s both">\s*<a href="\{\{ appStoreUrl \}\}" data-appstore-badge/);
});

test('hero link: it scrolls to the form\'s anchor through the page\'s existing #waitlist handler, and is not hidden with the nav\'s waitlist link on phones', () => {
  assert.match(html, /e\.target\.closest\('a\[href=\\"#waitlist\\"\]'\)|e\.target\.closest\('a\[href="#waitlist"\]'\)/,
    'the delegated click handler takes any link to #waitlist');
  assert.match(html, /document\.getElementById\('waitlist'\)/);
  // The phone rule that hides the nav's waitlist link is scoped to #hz-nav.
  assert.match(html, /@media \(max-width:640px\)\{#hz-nav a\[href="#waitlist"\],/);
  assert.doesNotMatch(html, /\n[^\n#]*a\[href="#waitlist"\][^\n]*\{display:none/);
});

// ------------------------------------------------------- the form's new place

const FORM_BLOCK = between('<div id="waitlist" data-screen-label="Android Waitlist"', "WHAT'S LIVE", CLOSING);

test('form: under the closing badge, inside #fin-form, ahead of the closing brand mark and the footer, with no section of its own', () => {
  const finForm = between('<div id="fin-form"', "WHAT'S LIVE", CLOSING);
  const badgeAt = finForm.search(BADGE_RE);
  const formAt = finForm.indexOf('<div id="waitlist"');
  assert.ok(badgeAt !== -1 && formAt > badgeAt, 'the form comes after the badge');
  assert.match(finForm.slice(badgeAt), /^<a [^>]*><img [^>]*><\/a>\s*<div id="waitlist"/, 'directly after it, nothing in between');
  assert.ok(html.indexOf('<div id="waitlist" data-screen-label="Android Waitlist"') < html.indexOf('id="fin-mark"'),
    'ahead of the closing section\'s giant HUNTZ mark');
  assert.ok(html.indexOf('id="fin-mark"') < html.indexOf('<footer'), 'and so ahead of the footer\'s brand block');
  assert.doesNotMatch(html, /<section id="waitlist"/);
  assert.equal((html.match(/data-screen-label="Android Waitlist"/g) || []).length, 1);
  assert.match(html, /<\/section>\n\n<footer data-screen-label="Footer"/);
  // The wrapper is an element of #fin-form, so it takes part in that reveal.
  assert.match(finForm, /<sc-if value="\{\{ appStoreMode \}\}"[^>]*>\s*<a href="\{\{ appStoreUrl \}\}" data-appstore-badge/);
});

test('form: the heading, the email field, NOTIFY ME and the no-spam line are all there, in that order', () => {
  const h3 = FORM_BLOCK.match(/<h3 style="([^"]*)">([\s\S]*?)<\/h3>/);
  assert.ok(h3, 'heading');
  assert.equal(textOf(h3[2]), 'Not on iPhone? Get notified for Android.');
  assert.match(h3[2], /Android<span style="color:#C24E1F">\.<\/span>$/, 'the accent full stop');
  assert.match(h3[1], /font:600 clamp\(22px,2\.6vw,32px\)\/1\.2 'Playfair Display'/, 'the heading the section had');
  const order = ['<h3 ', '<input type="email"', '>{{ notifyBtn }}</button>', 'NO SPAM. ONE EMAIL WHEN ANDROID LAUNCHES.']
    .map((needle) => FORM_BLOCK.indexOf(needle));
  assert.ok(order.every((i) => i !== -1) && order.every((i, k) => k === 0 || i > order[k - 1]), `order: ${order}`);
  assert.match(FORM_BLOCK, /YOU'RE IN\. WE'LL EMAIL YOU WHEN ANDROID LAUNCHES\./);
});

test('form: the Mailchimp wiring is untouched: the same form handler and state, the same one #waitlist id, the same endpoint and honeypot', () => {
  assert.match(FORM_BLOCK, /<form onSubmit="\{\{ submitHero \}\}" style="display:flex;flex-wrap:wrap;gap:10px;max-width:520px">/);
  assert.match(FORM_BLOCK, /<input type="email" required="" aria-label="Email address" placeholder="you@email\.com"/);
  assert.match(FORM_BLOCK, /<button type="submit" disabled="\{\{ busy1 \}\}"/);
  assert.match(FORM_BLOCK, /<sc-if value="\{\{ err1 \}\}">/);
  assert.match(FORM_BLOCK, /<sc-if value="\{\{ heroIdle \}\}"[\s\S]*<sc-if value="\{\{ sub1 \}\}"/);
  assert.equal((html.match(/id="waitlist"/g) || []).length, 2, 'the switched-off hero form and this one: only one renders at a time');
  assert.equal((html.match(/huntz\.us18\.list-manage\.com\/subscribe\/post\?u=b7144d02c740628b3280ff55f&id=3ee28a30af/g) || []).length, 1);
  assert.match(html, /WAITLIST_HONEYPOT = 'b_b7144d02c740628b3280ff55f_3ee28a30af'/);
  assert.equal((html.match(/type="email"/g) || []).length, 3, 'the same three email inputs as before');
});

test('form: its block clears the badge above it by well over a quarter of the badge height', () => {
  assert.match(FORM_BLOCK, /^<div id="waitlist"[^>]*style="margin-top:clamp\(32px,5vh,48px\);/);
  assert.ok(32 >= Math.ceil(48 / 4));
});

// ---------------------------------------------------- FOCUS_JS: arriving by link

const FOCUS_JS = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('function focusWaitlist()'));

/**
 * Runs the page's own #waitlist script against a stub DOM and returns what it
 * touched. `inFinForm` says whether the form sits inside #fin-form (the live
 * page) or not (the switched-off hero form).
 */
function run({ inFinForm, hash = '' }) {
  const log = { scrolled: [], focused: [], prevented: 0, replaced: [], handlers: {}, loadHandler: null };
  const fin = { style: { opacity: '0', transform: 'translateY(20px)', transition: 'opacity .7s ease .82s' } };
  // Objects the page builds inside the vm belong to another realm: copy them out as plain data.
  const input = { focus(o) { log.focused.push(JSON.parse(JSON.stringify(o))); } };
  const waitlist = {
    getBoundingClientRect: () => ({ top: 3900, height: 360 }),
    querySelector: (sel) => (sel === 'input' ? input : null),
    closest: (sel) => (inFinForm && sel === '#fin-form' ? fin : null),
  };
  const context = {
    document: {
      documentElement: { scrollHeight: 6000 },
      getElementById: (id) => (id === 'waitlist' ? waitlist : null),
      addEventListener: (type, fn) => { log.handlers[type] = fn; },
    },
    window: { addEventListener: (type, fn) => { log.loadHandler = fn; } },
    location: { hash },
    history: { replaceState: (...a) => log.replaced.push(a) },
    innerHeight: 800,
    pageYOffset: 0,
    matchMedia: () => ({ matches: true }),              // reduced motion: scrollTo at once
    scrollTo: (x, y) => log.scrolled.push([x, y]),
    requestAnimationFrame: () => {},
    Math,
  };
  vm.runInNewContext(FOCUS_JS, context);
  return { log, fin, input, click() {
    log.handlers.click({
      target: { closest: (sel) => (sel === 'a[href="#waitlist"]' ? {} : null) },
      preventDefault: () => { log.prevented += 1; },
    });
  } };
}

test('arriving by link: focusWaitlist shows the form\'s reveal container at once, scrolls to it and focuses the field without a second scroll', () => {
  assert.ok(FOCUS_JS, 'the page\'s #waitlist script was not found');
  const r = run({ inFinForm: true });
  r.click();
  assert.equal(r.log.prevented, 1, 'the link is handled in page');
  assert.deepEqual(r.log.replaced[0].slice(2), ['#waitlist']);
  // The closing section's staggered fade (opacity 0, 20px down, a .82s delay) is skipped.
  assert.deepEqual({ ...r.fin.style }, { opacity: '1', transform: 'none', transition: 'none' });
  // Centred in the viewport: 3900 - (800 - 360) / 2.
  assert.deepEqual(r.log.scrolled, [[0, 3680]]);
  assert.deepEqual(r.log.focused, [{ preventScroll: true }]);
});

test('arriving by link: a form that is not inside #fin-form (the switched-off hero form) is scrolled to and focused as before', () => {
  const r = run({ inFinForm: false });
  r.click();
  assert.deepEqual({ ...r.fin.style }, { opacity: '0', transform: 'translateY(20px)', transition: 'opacity .7s ease .82s' }, 'nothing else is touched');
  assert.deepEqual(r.log.focused, [{ preventScroll: true }]);
  assert.equal(r.log.scrolled.length, 1);
});

test('arriving by /#waitlist from another page: the same path runs once the page has loaded', () => {
  const r = run({ inFinForm: true, hash: '#waitlist' });
  assert.equal(typeof r.log.loadHandler, 'function', 'a load handler waits for the runtime to render the form');
  assert.equal(r.log.scrolled.length, 0, 'nothing happens before it');
});
