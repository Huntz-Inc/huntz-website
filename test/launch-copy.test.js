'use strict';
// Tests for the launch copy mix (2026-10-09, founder-approved): build/assemble.py's
// 2h block, plus the "What's live" card it folded into (S-2b) (asserted in
// test/app-store-launch.test.js, next to that card's other tests). The hero
// reads "You don't need motivation. You need consequences.", a "Sound
// familiar?" block follows the hero's marquee strip (rebuilt, the same day, on
// the mechanic steps' own card system: a headline and three cards), the
// Upcoming plates list the Hunts open on Discover and link to them, and the
// closing section reads "Become someone who finishes." over "Quitting just got
// expensive.". Everything else on the home page stays as it was.
//
//     npm test          (or: node --test "test/*.test.js")
//
// index.html is generated (build/assemble.py) and never hand-edited, so these
// read the committed file, the same way build/check.py does. All of this copy
// is static markup (nothing behind <sc-if>), so there is nothing to resolve per
// launch-switch mode here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const assemblePy = fs.readFileSync(path.join(ROOT, 'build', 'assemble.py'), 'utf8');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The page without its scripts and styles: what can render as copy. */
const visible = html
  .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');

/**
 * The words a reader sees: tags gone, entities decoded, whitespace folded.
 * Inline tags vanish without a gap (a headline's accent full stop sits in its
 * own <span>); block-level closings and <br> become a space so words in
 * neighbouring blocks never run together.
 */
function textOf(markup) {
  return markup
    .replace(/<br\s*\/?>|<\/(?:div|p|h\d|li|section|article|nav|footer)>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8594;/g, '')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The markup from one marker up to the next, both required to exist. */
function between(startMarker, endMarker, src = visible) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, `marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, `marker not found after ${startMarker}: ${endMarker}`);
  return src.slice(a, b);
}

// ------------------------------------------------------------------ the hero

const HERO = between('<section id="hz-hero"', 'id="hz-phone"');

test('hero: the headline reads "You don\'t need motivation. You need consequences.", word by word, the second sentence on its own line', () => {
  const h1 = between('<h1', '</h1>', HERO);
  assert.equal(textOf(h1), "You don't need motivation. You need consequences.");
  const delays = [...h1.matchAll(/<span style="display:inline-block;animation:hzWord \.9s cubic-bezier\(\.18,1\.25,\.4,1\) (0\.\d\d)s both[^"]*">/g)]
    .map((m) => m[1]);
  assert.deepEqual(delays, ['0.08', '0.16', '0.24', '0.32', '0.40', '0.48', '0.56'],
    'one rising span per word, the design\'s own 80 ms stagger');
  assert.match(h1, /motivation\.<\/span>\n\s*<br>\n\s*<span/, 'the second sentence starts on its own line');
  assert.match(h1, /font-style:italic">consequences<span style="color:#C24E1F;font-style:normal">\.<\/span><\/span>/,
    'the last word keeps the design\'s accent treatment: italic, clay full stop');
  assert.doesNotMatch(HERO, /Put your money|goals are/);
});

test('hero: the sub reads the approved sentence, $20 minimum, no dash', () => {
  assert.match(HERO, />Pick a goal\. Put \$20 to \$500 on the line\. Prove it daily\. Finish and get it all back, plus a cut of what the quitters lost\.<\/p>/);
  assert.doesNotMatch(HERO, /\$50(?!\d)|100% back|forfeited|of your own money|Post proof every day|Stake \$20/);
});

test('hero: the eyebrow keeps the colon main settled on, not a dash and not a middle dot', () => {
  assert.match(HERO, />HUNTZ: THE MARKETPLACE FOR ACCOUNTABILITY</);
  assert.doesNotMatch(HERO, /HUNTZ [—·] THE MARKETPLACE/);
});

// -------------------------------------------------------- "Sound familiar?"

const FAMILIAR_HEADLINE = "You don't have a discipline problem. You have a nothing-to-lose problem.";
const FAMILIAR_CARDS = [
  ['THE GYM', 'Third gym membership. Zero workouts.'],
  ['THE MONDAY', 'You said Monday. It is now October.'],
  ['THE CAMERA ROLL', 'Your camera roll is full of day-one screenshots. There is no day two.'],
];
const FAMILIAR = between('<section id="familiar"', '<section id="mechanic"');
const MECHANIC = between('<section id="mechanic"', '<section id="why"');

/** The first mechanic step card ("01 STAKE"): its own style, hover, number, chip and title styles. */
function mechanicStep() {
  const m = MECHANIC.match(/<div data-plate="" style="position:relative;margin-right:clamp\(0px,4vw,42px\);([^"]*)" style-hover="([^"]*)">\s*<div style="([^"]*)">01<\/div>\s*<div style="([^"]*)">STAKE<\/div>\s*<h3 style="margin:0 0 7px;([^"]*)">Stake what hurts to lose/);
  assert.ok(m, 'the mechanic\'s first step card was not found');
  return { face: m[1], hover: m[2], number: m[3], chip: m[4], title: m[5] };
}

test('sound familiar: a block sits between the hero\'s marquee strip and the mechanic, on the mechanic\'s own section pattern', () => {
  const ticker = visible.indexOf('<section data-screen-label="Ticker"');
  const familiar = visible.indexOf('<section id="familiar"');
  const mechanic = visible.indexOf('<section id="mechanic"');
  assert.ok(ticker !== -1 && ticker < familiar && familiar < mechanic, 'order: marquee strip, Sound familiar, The mechanic');
  // The marquee strip is directly before it and the mechanic directly after.
  assert.equal((visible.slice(ticker, familiar).match(/<section /g) || []).length, 1, 'nothing else between the strip and the block');
  assert.equal((visible.slice(familiar, mechanic).match(/<section /g) || []).length, 1, 'nothing between the block and the mechanic');

  // The same side padding and container width as the mechanic section.
  assert.match(FAMILIAR, /^<section id="familiar"[^>]*style="[^"]*padding:clamp\(64px,9vh,104px\) clamp\(20px,5vw,64px\)/);
  assert.match(FAMILIAR, /<div style="max-width:1220px;margin:0 auto">/);
  assert.match(between('<section id="mechanic"', '<h2'), /padding:clamp\(64px,9vh,104px\) clamp\(20px,5vw,64px\)"[\s\S]*<div style="max-width:1220px;margin:0 auto">/);
});

test('sound familiar: the eyebrow stays "SOUND FAMILIAR?", in THE MECHANIC\'s eyebrow style, as a label and not a second heading', () => {
  const mechanicEyebrow = between('<section id="mechanic"', '<h2').match(/<div style="([^"]*)">THE MECHANIC<\/div>/);
  assert.ok(mechanicEyebrow, 'THE MECHANIC eyebrow not found');
  const eyebrow = FAMILIAR.match(/<div style="([^"]*)">Sound familiar\?<\/div>/);
  assert.ok(eyebrow, 'the eyebrow was not found');
  // The mechanic's label style, plus the uppercase transform that keeps the source in sentence case.
  assert.equal(eyebrow[1], `${mechanicEyebrow[1]};text-transform:uppercase`);
  for (const token of ["font:600 11px 'Figtree',Arial,Helvetica,sans-serif", 'letter-spacing:.2em', 'color:#6E6759', 'margin-bottom:14px']) {
    assert.ok(eyebrow[1].includes(token), `eyebrow lacks ${token}`);
  }
  assert.equal((FAMILIAR.match(/<h2/g) || []).length, 1, 'the headline is the section\'s one heading');
  assert.ok(FAMILIAR.indexOf('Sound familiar?') < FAMILIAR.indexOf('<h2'), 'the eyebrow comes first');
});

test('sound familiar: the headline is "You don\'t have a discipline problem. You have a nothing-to-lose problem." in the style and size of "Lock in or you lose.", the accent full stop on the last word', () => {
  const h2 = FAMILIAR.match(/<h2 style="([^"]*)">([\s\S]*?)<\/h2>/);
  assert.ok(h2, 'headline not found');
  assert.equal(textOf(h2[2]), FAMILIAR_HEADLINE);
  // Only the final full stop is clay; the one mid-sentence is ink like the rest.
  assert.match(h2[2], /problem<span style="color:#C24E1F">\.<\/span>$/);
  assert.equal((h2[2].match(/color:#C24E1F/g) || []).length, 1);
  assert.match(h2[2], /discipline problem\. You have a /);
  // The compound stays whole on a phone: no break after "nothing-".
  assert.match(h2[2], /<span style="white-space:nowrap">nothing-to-lose<\/span> problem/);
  // Same font shorthand, letter-spacing and wrapping as the mechanic's headline; only the margin differs.
  const mechanicH2 = MECHANIC.match(/<h2 style="([^"]*)">Lock in or you lose<span style="color:#C24E1F">\.<\/span><\/h2>/);
  assert.ok(mechanicH2, 'the mechanic headline was not found');
  assert.match(mechanicH2[1], /^margin:0;font:600 clamp\(34px,4\.4vw,60px\)\/1\.06 'Playfair Display','Times New Roman',serif;letter-spacing:-\.012em;text-wrap:balance$/);
  assert.equal(h2[1], mechanicH2[1].replace('margin:0;', 'margin:0 0 clamp(26px,4vh,42px);'));
});

test('sound familiar: three cards, each one label chip and one line, on the mechanic step card\'s exact surface, radius, shadow, chip and index number', () => {
  const step = mechanicStep();
  const cards = [...FAMILIAR.matchAll(/<div data-familiar-card="" style="([^"]*)" style-hover="([^"]*)">\s*<div style="([^"]*)">(\d\d)<\/div>\s*<div style="([^"]*)">([^<]*)<\/div>\s*<p style="([^"]*)">([^<]*)<\/p>\s*<\/div>/g)];
  assert.equal(cards.length, 3);
  assert.equal((FAMILIAR.match(/data-familiar-card=""/g) || []).length, 3, 'no card is anything but a chip, a number and a line');
  cards.forEach(([, face, hover, number, nn, chip, chipText, line, lineText], i) => {
    const [label, text] = FAMILIAR_CARDS[i];
    assert.equal(nn, String(i + 1).padStart(2, '0'), `${label}: index number`);
    assert.equal(chipText, label, `${label}: chip`);
    assert.equal(lineText, text, `${label}: line`);
    // Surface (gradient), radius, border, shadow, padding and transition: the step card's, verbatim.
    assert.equal(face, `position:relative;${step.face}`, `${label}: surface, radius, shadow`);
    assert.equal(hover, step.hover, `${label}: hover`);
    assert.equal(number, step.number, `${label}: big index number`);
    assert.equal(chip, step.chip, `${label}: label chip`);
    // The line wears the step title's serif, with the title's margin dropped and balanced wrapping added.
    assert.equal(line, `margin:0;${step.title};text-wrap:balance`, `${label}: line`);
  });
  // The pieces are the ones Playfair-and-Figtree readers know from the steps.
  assert.match(step.face, /^padding:clamp\(16px,2vw,22px\) clamp\(18px,2\.2vw,24px\);border:1px solid rgba\(22,19,14,\.12\);border-radius:16px;background:linear-gradient\(180deg,rgba\(255,255,255,\.72\),rgba\(255,255,255,\.34\)\);/);
  assert.match(step.face, /box-shadow:0 1px 0 rgba\(255,255,255,\.8\) inset,0 20px 34px -30px rgba\(22,19,14,\.55\)/);
  assert.match(step.number, /^position:absolute;top:clamp\(14px,1\.8vw,20px\);right:clamp\(16px,2vw,22px\);font:400 clamp\(26px,3vw,38px\) 'Playfair Display'.*opacity:\.17;line-height:1$/);
  assert.match(step.chip, /^display:inline-block;padding:5px 11px;border-radius:20px;border:1px solid currentColor;.*font:700 9\.5px 'Figtree'.*letter-spacing:\.16em;margin-bottom:11px$/);
  // Inert, like the steps: not a data-plate card, no handler, no role, no link.
  assert.doesNotMatch(FAMILIAR, /data-plate|onClick|onKeyDown|role=|tabIndex|aria-label|<a /);
});

test('sound familiar: three across on desktop, stacked on phones, and the old plain text block is gone', () => {
  // The container is a three-column grid, one column at 960px and below (every phone, and portrait tablets).
  assert.match(FAMILIAR, /<div data-familiar-cards="">/);
  assert.match(html, /\n\[data-familiar-cards\]\{display:grid;grid-template-columns:repeat\(3,1fr\);gap:clamp\(12px,1\.6vw,20px\)\}\n@media \(max-width:960px\)\{\[data-familiar-cards\]\{grid-template-columns:1fr\}\}\n/);
  const stackedBelow = 960;
  assert.ok(640 <= stackedBelow && 375 <= stackedBelow, 'phones stack');
  assert.ok(1440 > stackedBelow && 1024 > stackedBelow, 'laptops and desktops sit three across');
  // Four plain lines in a column: gone.
  assert.doesNotMatch(FAMILIAR, /font:600 clamp\(21px,2\.3vw,32px\)|display:flex;flex-direction:column;gap:clamp\(14px,2\.4vh,24px\)/);
  assert.equal((FAMILIAR.match(/<p /g) || []).length, 3, 'only the three card lines are paragraphs');
  assert.doesNotMatch(FAMILIAR, /<svg|<img|&#\d+;/, 'no icons, no glyphs');
});

// ------------------------------------------------------------ the Upcoming rail

// The three Hunts open on Discover when build/assemble.py's LIVE_HUNTS was
// fetched (api.huntz.ai, 2026-10-09), in Discover order; all start 2026-10-12
// in America/Los_Angeles and open at the platform minimum stake.
const LIVE_HUNTS = [
  { id: '07bfc657-8dba-4a48-9842-63ea34d0f5e3', title: '45-Minute Exercise Streak', length: '14 DAYS' },
  { id: '70b48ded-9210-4aff-ab43-8a6a5fc0b9a9', title: 'Post daily on your platform', length: '30 DAYS' },
  { id: 'a2c3422e-209d-460c-8c60-1ee57fd8d548', title: 'Read 20 Minutes a Day', length: '30 DAYS' },
];
const RAIL = between('<div id="ch-rail"', '<section id="why"');

test('upcoming: the rail carries exactly the Hunts open on Discover, in order, each on the design\'s plate', () => {
  const plates = RAIL.split('<div data-plate=""').slice(1);
  assert.equal(plates.length, LIVE_HUNTS.length);
  plates.forEach((plate, i) => {
    const h = LIVE_HUNTS[i];
    const nn = String(i + 1).padStart(2, '0');
    assert.match(plate, new RegExp(`opacity:\\.88">HUNT ${nn}</span>`), `${h.title}: numbered label`);
    assert.match(plate, new RegExp(`opacity:\\.17;line-height:1">${nn}</span>`), `${h.title}: faded numeral`);
    assert.match(plate, new RegExp(`<div style="font:600 clamp\\(22px,2\\.2vw,30px\\)/1\\.15 'Playfair Display'[^"]*">${escapeRe(h.title)}</div>`), `${h.title}: title`);
    const rows = [...plate.matchAll(/<span style="opacity:\.85">([A-Z]+)<\/span><span style="font-weight:700">([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(rows, [['CADENCE', '1 CHECK-IN A DAY'], ['LENGTH', h.length], ['STAKE', 'FROM $20'], ['STARTS', 'OCT 12']], `${h.title}: rows`);
    assert.match(plate, new RegExp(
      `<a data-hunt-link="" href="https://www\\.huntz\\.ai/hunt/${h.id}" aria-label="I want this hunt: ${escapeRe(h.title)}" `
      + 'style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:4px;padding-top:12px;border-top:1px solid currentColor;'
      + "font:700 9\\.5px 'Figtree',Arial,Helvetica,sans-serif;letter-spacing:\\.15em;color:currentColor;text-decoration:none\">"
      + '<span>I WANT THIS HUNT</span><span aria-hidden="true">&#8594;</span></a>'), `${h.title}: the I want this hunt link`);
    // The design's card, byte for byte, plus position:relative for the stretched link.
    assert.match(plate, /^ style="position:relative;scroll-snap-align:start;flex:0 0 calc\(\(100% - 2 \* clamp\(12px,1\.6vw,20px\)\) \/ 3\);min-width:250px;display:flex;flex-direction:column;justify-content:space-between;gap:clamp\(22px,3vh,34px\);padding:clamp\(20px,2\.2vw,26px\);border:1px solid rgba\(22,19,14,\.12\);border-radius:18px;/);
    assert.match(plate, /" style-hover="background:#C24E1F;color:#F3EFE7;border-color:#C24E1F;transform:translateY\(-3px\);box-shadow:0 26px 44px -28px rgba\(194,78,31,\.75\)">/);
    assert.doesNotMatch(plate.slice(0, plate.indexOf('>')), /onClick|onKeyDown|role=|tabIndex|aria-label|cursor:pointer/);
  });
  assert.equal((RAIL.match(/I WANT THIS HUNT/g) || []).length, LIVE_HUNTS.length);
});

test('upcoming: the whole card is one tap, and the placeholder Hunts are gone everywhere, scripts included', () => {
  assert.match(html, /\[data-plate\] a\[data-hunt-link\]::after\{content:'';position:absolute;inset:0\}/);
  for (const name of ['Apply to jobs', 'Post content', 'Read books', 'Stay fit', 'Live stream']) {
    assert.ok(!html.includes(name), `placeholder Hunt ${name} survived`);
  }
  for (const token of ['pickHunt', '_picks', 'plateRole', 'pickAria', 'pickkey', 'FROM $50', '5 JOBS / DAY']) {
    assert.ok(!html.includes(token), `${token} survived`);
  }
  // The interest plumbing stays, inert: the chip, its clear button and the merge field.
  assert.match(html, /clearInterest/);
  assert.match(html, /&INTEREST=/);
});

test('upcoming: build/assemble.py hard-codes the list, dated, naming the API it was fetched from', () => {
  const at = assemblePy.indexOf('LIVE_HUNTS = [');
  assert.notEqual(at, -1);
  const block = assemblePy.slice(at, assemblePy.indexOf('\n]', at));
  for (const h of LIVE_HUNTS) {
    assert.ok(block.includes(h.id), `${h.title}: id`);
    assert.ok(block.includes(h.title), `${h.title}: title`);
  }
  const comment = assemblePy.slice(assemblePy.indexOf('# (LC-3)'), at);
  assert.match(comment, /https:\/\/api\.huntz\.ai\/v1\/hunts\?limit=50/);
  assert.match(comment, /2026-10-09/);
  assert.match(comment, /live feed is a later change/);
  assert.match(assemblePy, /HUNT_LINK = SITE_URL \+ "\/hunt\/\{id\}"/, 'links go through the universal link');
});

// ------------------------------------------------------- the closing section

const CLOSING = between('<section id="cta"', '<footer');

test('closing: YOUR MOVE, "Become someone who finishes." with the accent full stop, "Quitting just got expensive." under it, Apple\'s badge after', () => {
  assert.match(CLOSING, /<div id="fin-eyebrow"[^>]*>YOUR MOVE<\/div>/);
  const h2 = between('<h2', '</h2>', CLOSING);
  assert.equal(textOf(h2), 'Become someone who finishes.');
  assert.equal((h2.match(/data-fw=""/g) || []).length, 4, 'one reveal span per word, as the design animates them');
  assert.match(h2, /font-style:italic">finishes<span style="color:#C24E1F;font-style:normal">\.<\/span><\/span>/);
  const sub = CLOSING.match(/<\/h2>\n\s*<p id="fin-sub" style="([^"]*)">([^<]*)<\/p>\n\s*<div id="fin-form"/);
  assert.ok(sub, 'the line should sit between the headline and the button block');
  assert.equal(sub[2], 'Quitting just got expensive.');
  assert.match(sub[1], /'Playfair Display'/);
  assert.match(sub[1], /opacity:0;transform:translateY\(20px\)$/, 'rises in with the eyebrow and the button');
  assert.match(html, /\$\('fin-sub'\)/, 'the design\'s finBits list picks #fin-sub up');
  for (const gone of ['Hunt&nbsp;', 'Stop&nbsp;', 'hiding<', 'READY WHEN YOU ARE']) {
    assert.ok(!CLOSING.includes(gone), `${gone} should be gone`);
  }
  // The store link (AS-3) is still inside #fin-form: Apple's badge, since the
  // founder's revision of the same day (test/app-store-badge.test.js).
  const finForm = between('<div id="fin-form"', "WHAT'S LIVE", CLOSING);
  assert.match(finForm, /<a href="\{\{ appStoreUrl \}\}" data-appstore-badge="" aria-label="Download on the App Store"><img src="\/assets\/app-store-badge-black\.[0-9a-f]{8}\.svg"[^>]*><\/a>/);
});

// ---------------------------------------------- the closing wordmark, on its own

test('closing wordmark: the giant HUNTZ. stands on its own, and the footer\'s brand block carries the page\'s one tagline', () => {
  const mark = CLOSING.match(/<div id="fin-mark" aria-hidden="true" style="([^"]*)">HUNTZ<span style="[^"]*">\.<\/span><\/div>/);
  assert.ok(mark, 'the wordmark was not found');
  // The wordmark itself is untouched: the same huge Figtree "HUNTZ." and its faded clay full stop.
  assert.match(mark[1], /^font:800 clamp\(96px,19vw,290px\)\/\.9 'Figtree'/);
  // Nothing sits under it: its container closes, then the closing section does.
  assert.match(CLOSING.slice(CLOSING.indexOf(mark[0]) + mark[0].length), /^\s*<\/div>\s*<\/div>\s*<\/section>\s*$/);
  assert.ok(CLOSING.indexOf(mark[0]) > CLOSING.indexOf('id="waitlist"'), 'still the last thing in the closing section');
  // One tagline on the page, the footer brand block's, and the retired brand line is nowhere in the copy.
  const text = textOf(visible);
  assert.equal((text.match(/The marketplace for accountability\./g) || []).length, 1);
  assert.match(between('<footer', '</footer>'), />The marketplace for accountability\.<\/p>/);
  assert.doesNotMatch(text, /Put your money where your goals are/i);
  assert.doesNotMatch(CLOSING, /marketplace for accountability|Put your money where your goals are/i);
});

// --------------------------------------------------------------- copy rules

test('copy rules: the visible home page has no em dash, en dash or exclamation mark, never "join fee" or "free", and never $50 as a minimum', () => {
  const text = textOf(visible);
  assert.doesNotMatch(text, /—/, 'em dash');
  assert.doesNotMatch(text, /–/, 'en dash');
  assert.doesNotMatch(text, /!/, 'exclamation mark');
  assert.doesNotMatch(text, /join fee/i);
  assert.doesNotMatch(text, /\bfree\b/i);
  assert.doesNotMatch(text, /FROM \$50|\$50[–-]\$|\$50 to \$|Stake \$50/);
  // The new headlines are the approved strings exactly, so sentence case by construction.
  for (const line of ['You need', 'consequences', 'Sound familiar?', FAMILIAR_HEADLINE, ...FAMILIAR_CARDS.flat(), 'Become someone who finishes', 'Quitting just got expensive.']) {
    assert.ok(text.includes(line), `missing: ${line}`);
  }
  // Nothing else on the page moved: the marquee, the mechanic's four steps, the example card, the FAQ, the Android form, the footer.
  for (const kept of ['Lock in or you lose', 'Stake what hurts to lose', 'Quitters pay', 'HUNT No.0412', 'Asked plainly, answered plainly',
    'Not on iPhone? Get notified for Android', 'The marketplace for accountability.']) {
    assert.ok(text.includes(kept), `kept copy missing: ${kept}`);
  }
});

test('copy rules: the share card follows the page, in og:title and twitter:title ("Huntz: Become someone who finishes.") and in both descriptions (the hero sub)', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<meta property="og:title" content="Huntz: Become someone who finishes\.">/);
  assert.match(head, /<meta name="twitter:title" content="Huntz: Become someone who finishes\.">/);
  assert.doesNotMatch(head, /Put your money where your goals are/, 'the retired brand line');
  assert.ok(textOf(visible).includes('Become someone who finishes.'), 'the title is the closing line the page carries');
  const sub = 'Pick a goal. Put $20 to $500 on the line. Prove it daily. Finish and get it all back, plus a cut of what the quitters lost.';
  assert.ok(HERO.includes(`>${sub}</p>`), 'the sentence under test is the hero sub');
  assert.match(head, new RegExp(`<meta property="og:description" content="${escapeRe(sub)}">`));
  assert.match(head, new RegExp(`<meta name="twitter:description" content="${escapeRe(sub)}">`));
  assert.doesNotMatch(head, /\$50(?!\d)|–/);
});
