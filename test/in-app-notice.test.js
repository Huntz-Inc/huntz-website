'use strict';
// Tests for the in-app browser notice (2026-10-19): build/in-app-notice.js,
// inlined by build/assemble.py as the last script of every page that has an
// App Store button.
//
//     npm test          (or: node --test "test/*.test.js")
//
// Visitors who arrive from TikTok or Instagram land in that app's own browser,
// which will not hand a link to the App Store, so the "Download on the App
// Store" button looks dead. Inside those two browsers only, the script adds a
// small card that says how to open the page in the real browser, with a
// "Copy link" fallback and a dismiss control. Everywhere else the page must be
// untouched: the card is built by the script, so it is in no served HTML.
//
// The script under test is the one that ships: it is read out of the committed
// pages and run in a vm against a small stand-in DOM (below), so these tests
// cover the bytes visitors get, not a copy of them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const STORE_URL = 'https://apps.apple.com/app/id6802558635';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------- which pages

/** Every page with an App Store button carries the script. The two Hunt/home
 * function templates are the files api/home.js and api/hunt.js serve. */
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
  'api/_lib/home-fallback.html',
  'api/_lib/hunt-fallback.html',
];

/** Pages with no App Store button, which must stay exactly as they are. */
const NON_CARRIERS = [
  'auth/callback.html',
  'terms.html',
  'privacy.html',
  'payouts/return.html',
  'payouts/refresh.html',
  'mailbox/gmail-action/pair.html',
];

/** The inline script that holds the notice, or null if the page has none. */
function noticeScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((body) => body.includes('data-hz-inapp-notice'));
}

/** The page as a crawler's first read of it sees markup: no scripts, styles or comments. */
function markupOnly(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** Wording and attribute names that belong to the card and to nothing else. */
const NOTICE_MARKERS = [
  'data-hz-inapp',
  'Having trouble downloading Huntz',
  'can block the App Store',
  'Open in external browser',
  'Open in browser',
  'Copy link',
  'Link copied',
];

const SCRIPT = (() => {
  const found = noticeScripts(read('index.html'));
  assert.equal(found.length, 1, 'index.html carries the notice script once');
  return found[0];
})();

test('pages: exactly the pages with an App Store button carry the notice script, once, byte for byte alike', () => {
  for (const rel of CARRIERS) {
    const found = noticeScripts(read(rel));
    assert.equal(found.length, 1, `${rel}: expected one notice script`);
    assert.equal(found[0], SCRIPT, `${rel}: the script differs from the home page's`);
    assert.ok(read(rel).includes(STORE_URL) || read(rel).includes('{{ appStoreUrl }}'), `${rel}: no App Store link`);
  }
  for (const rel of NON_CARRIERS) {
    assert.deepEqual(noticeScripts(read(rel)), [], `${rel}: has no App Store button, so no notice`);
  }
});

test('pages: no committed page has an App Store link without the script (a new page cannot forget it)', () => {
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return ['.git', 'node_modules', 'build', 'test', 'scripts'].includes(e.name) ? [] : walk(rel);
    return e.name.endsWith('.html') ? [rel] : [];
  });
  const all = walk('.').map((rel) => rel.replace(/^\.\//, ''));
  const withLink = all.filter((rel) => read(rel).includes(STORE_URL));
  assert.deepEqual(withLink.sort(), [...CARRIERS].sort());
});

test('pages: the script sits after the menu controller on every page, so the sheet has closed itself before a tap is answered', () => {
  for (const rel of CARRIERS) {
    const html = read(rel);
    const nav = html.indexOf("document.getElementById('hz-menu')");
    assert.ok(nav !== -1 && nav < html.indexOf('data-hz-inapp-notice'), `${rel}: after the menu controller`);
  }
});

// ------------------------------------------------ absent from served markup

test('markup: the notice is in no committed page\'s HTML outside its own script', () => {
  for (const rel of [...CARRIERS, ...NON_CARRIERS]) {
    const markup = markupOnly(read(rel));
    for (const marker of NOTICE_MARKERS) {
      assert.ok(!markup.includes(marker), `${rel}: markup contains ${JSON.stringify(marker)}`);
    }
  }
});

test('markup: nor in what the functions serve (the live home page and a resolved Hunt page)', async () => {
  const home = require('../api/home');
  const hunt = require('../api/hunt');
  const response = (body, status = 200) => ({ status, json: async () => body });
  const item = {
    id: 'public-hunt', title: 'Read with Jordan', description: 'Read and reflect daily.',
    creatorDisplayName: 'Jordan', startAt: '2026-10-20T07:00:00Z', timeZone: 'America/Los_Angeles',
    enrollmentStatus: 'OPEN', visibility: 'PUBLIC', duration: { windowCount: 21, windowUnitLabel: 'day' },
    stakeRange: { minMinor: '2000', maxMinor: '50000' },
  };
  const now = new Date('2026-10-01T00:00:00Z');
  const fetchImpl = async (url) =>
    new URL(url).pathname === '/v1/hunts' ? response({ items: [item], nextCursor: null }) : response(item);

  const served = {};
  await home.handle({ url: '/' }, { setHeader() {}, end: (b) => { served.home = b; } }, { fetchImpl, now });
  await hunt.handle({ url: '/hunt/public-hunt' }, { setHeader() {}, end: (b) => { served.hunt = b; } }, { fetchImpl, now });
  served.huntFallback = read('api/_lib/hunt-fallback.html');
  for (const [name, html] of Object.entries(served)) {
    assert.ok(html, `${name}: nothing served`);
    assert.equal(noticeScripts(html).length, 1, `${name}: carries the script`);
    assert.equal(noticeScripts(html)[0], SCRIPT, `${name}: the same script`);
    const markup = markupOnly(html);
    for (const marker of NOTICE_MARKERS) {
      assert.ok(!markup.includes(marker), `${name}: markup contains ${JSON.stringify(marker)}`);
    }
  }
  assert.match(served.hunt, /data-hunt-detail/, 'the resolved Hunt page was really rendered');
});

// ------------------------------------------------- the buttons stay plain links

test('buttons: every App Store link is a plain anchor to the listing: no handler, no target, no script involved', () => {
  for (const rel of CARRIERS) {
    const html = read(rel);
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0])
      .filter((tag) => tag.includes('apps.apple.com') || tag.includes('{{ appStoreUrl }}'));
    assert.ok(anchors.length > 0, `${rel}: no App Store anchors found`);
    for (const tag of anchors) {
      const href = /\shref="([^"]*)"/.exec(tag);
      assert.ok(href && (href[1] === STORE_URL || href[1] === '{{ appStoreUrl }}'), `${rel}: ${tag.slice(0, 80)}`);
      assert.doesNotMatch(tag, /\son[a-z]+\s*=/i, `${rel}: an event handler on an App Store link`);
      assert.doesNotMatch(tag, /\starget\s*=/i, `${rel}: a target on an App Store link`);
      assert.doesNotMatch(tag, /javascript:/i, `${rel}: a script URL`);
    }
  }
  // The home page fills the template value from one constant, the same URL.
  assert.match(read('index.html'), /APP_STORE_URL = 'https:\/\/apps\.apple\.com\/app\/id6802558635'/);
  assert.match(read('index.html'), /appStoreUrl: this\.APP_STORE_URL/);
});

test('script: plain ES5 and ASCII, and it never redirects, cancels a click, reads the URL or stores anything', () => {
  // Comments describe what the code avoids, so the API and syntax checks read the code alone.
  const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(SCRIPT, /[^\x00-\x7f]/, 'ASCII only, so it parses in any webview whatever the page encoding');
  for (const banned of [
    'preventDefault', 'stopPropagation', 'location', 'window.open', 'document.write', 'innerHTML', 'eval(',
    'localStorage', 'sessionStorage', 'document.cookie', 'document.referrer', 'fetch(', 'XMLHttpRequest',
    'sendBeacon', 'history.', 'huntz://', 'setAttribute(\'href\'', '.href',
  ]) {
    assert.ok(!CODE.includes(banned), `script contains ${JSON.stringify(banned)}`);
  }
  assert.doesNotMatch(CODE, /=>|\bconst\b|\blet\b|`|\?\.|\?\?|\(\?<[=!]|\bclass\b|\basync\b|\bawait\b/,
    'no syntax newer than ES5 (and no look-behind), which older iOS webviews reject at parse time');
  // The only network-looking string is the constant that "Copy link" writes to the clipboard.
  assert.deepEqual([...new Set(CODE.match(/https?:\/\/[^'"\s)]+/g))].sort(),
    ['https://apps.apple.com/', 'https://huntz.ai']);
});

// ------------------------------------------------------- a stand-in DOM and runner

class Node_ {
  constructor() { this.parentNode = null; this.childNodes = []; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    const p = this.parentNode;
    return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null;
  }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    if (ref) this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); else this.childNodes.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    assert.notEqual(i, -1, 'removeChild: not a child');
    this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
}
class Text_ extends Node_ {
  constructor(data) { super(); this.data = data; }
  get textContent() { return this.data; }
}
class Element_ extends Node_ {
  constructor(tag, doc) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.attrs = {};
    this.style = { cssText: '' };
    this.listeners = {};
    this.value = '';
    this.position = 'static';
    this.rect = { top: 0, bottom: 0 };
    this.offsetHeight = 0;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(t) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = [];
    if (t !== '') this.appendChild(new Text_(String(t)));
  }
  get elements() { return this.childNodes.filter((c) => c instanceof Element_); }
  descendants() { return this.elements.flatMap((e) => [e, ...e.descendants()]); }
  querySelector(sel) {
    const m = /^\[([a-z-]+)\]$/.exec(sel);
    assert.ok(m, `stand-in querySelector only knows [attribute]: ${sel}`);
    return this.descendants().find((e) => m[1] in e.attrs) || null;
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  focus() {} select() {} setSelectionRange() {}
  getBoundingClientRect() { return this.rect; }
  click() { return this.ownerDocument.dispatch(this, 'click'); }
}

/** A page: a sticky header (as on the content pages), a main, and links. */
function makePage({ ua, clipboard, execCopy = true, headerPosition = 'sticky', noHeader = false }) {
  const timers = [];
  const calls = { scrollTo: [], copied: [], created: 0, execCommand: 0, preventDefault: 0 };
  const document = {
    listeners: {},
    createElement(tag) { calls.created += 1; return new Element_(tag, document); },
    createTextNode(t) { calls.created += 1; return new Text_(t); },
    getElementsByTagName(tag) { return document.body.descendants().filter((e) => e.tagName === tag.toUpperCase()); },
    getElementById(id) { return document.body.descendants().find((e) => e.attrs.id === id) || null; },
    querySelector(sel) { return document.body.querySelector(sel); },
    addEventListener(type, fn) { (document.listeners[type] = document.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { document.listeners[type] = (document.listeners[type] || []).filter((f) => f !== fn); },
    execCommand(cmd) { calls.execCommand += 1; return cmd === 'copy' && execCopy; },
    /** A click that bubbles from the target up through the document, like a real one. */
    dispatch(target, type) {
      const event = { type, target, defaultPrevented: false, preventDefault() { calls.preventDefault += 1; this.defaultPrevented = true; } };
      for (let n = target; n; n = n.parentNode) (n.listeners ? n.listeners[type] || [] : []).slice().forEach((f) => f(event));
      (document.listeners[type] || []).slice().forEach((f) => f(event));
      return event;
    },
  };
  document.body = new Element_('body', document);
  const header = new Element_('header', document);
  header.position = headerPosition;
  header.offsetHeight = 63;
  const main = new Element_('main', document);
  const storeLink = new Element_('a', document);
  storeLink.setAttribute('href', STORE_URL);
  const badge = new Element_('img', document);
  storeLink.appendChild(badge);
  const otherLink = new Element_('a', document);
  otherLink.setAttribute('href', '/faq');
  main.appendChild(storeLink);
  main.appendChild(otherLink);
  if (!noHeader) document.body.appendChild(header);
  document.body.appendChild(main);

  const window_ = {
    innerHeight: 700,
    pageYOffset: 900,
    addEventListener() {},
    getComputedStyle: (el) => ({ position: el.position }),
    scrollTo: (x, y) => { calls.scrollTo.push([x, y]); },
  };
  const navigator = { userAgent: ua };
  if (clipboard !== undefined) navigator.clipboard = clipboard;
  const context = vm.createContext({
    document, window: window_, navigator, setTimeout: (fn) => { timers.push(fn); return timers.length; },
  });
  return {
    document, header, main, storeLink, badge, otherLink, calls, timers, window: window_,
    run: (src = SCRIPT) => vm.runInContext(src, context),
    // One round of pending timers; anything they schedule waits for the next call.
    flush: () => { timers.splice(0).forEach((fn) => fn()); },
    notice: () => document.body.querySelector('[data-hz-inapp-notice]'),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// ------------------------------------------------------------------ detection

const UA = {
  tiktokIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US RevealType/Dialog isDarkMode/0 WKWebView/1 BytedanceWebview/d8a21c6',
  tiktokIosWebviewOnly: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BytedanceWebview/d8a21c6',
  tiktokIosPlainToken: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TikTok/39.1.0',
  tiktokAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A.231105.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 trill_2023507050 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/35.5.5 ByteLocale/en Region/US BytedanceWebview/d8a21c6',
  tiktokAndroidTrillOnly: 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 trill_2023507050',
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.28.116 (iPhone14,5; iOS 17_5_1; en_US; en-US; scale=3.00; 1170x2532; 618927349) NW/3',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A.231105.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 Instagram 340.0.0.33.109 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_US; 618927349)',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  chromeDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  safariDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  firefoxDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  edgeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  googlebot: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  // Other in-app browsers are out of scope: this notice is for these two apps.
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/465.0.0.38.109;FBBV/600000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
  // "trill" inside another word is not TikTok's Android build.
  trillian: 'Mozilla/5.0 (Windows NT 10.0) Trillian/6.1',
  thrill: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/125.0 Safari/537.36 ThrillSeeker/1.0',
};

function rendered(ua) {
  const page = makePage({ ua });
  page.run();
  const n = page.notice();
  return n ? n.getAttribute('data-hz-inapp-notice') : null;
}

test('detection: TikTok\'s in-app browser is recognised on iOS and Android, by each of its tokens', () => {
  for (const key of ['tiktokIos', 'tiktokIosWebviewOnly', 'tiktokIosPlainToken', 'tiktokAndroid', 'tiktokAndroidTrillOnly']) {
    assert.equal(rendered(UA[key]), 'tiktok', key);
  }
});

test('detection: Instagram\'s in-app browser is recognised on iOS and Android', () => {
  for (const key of ['instagramIos', 'instagramAndroid']) {
    assert.equal(rendered(UA[key]), 'instagram', key);
  }
});

test('detection: Safari, Chrome (iOS and desktop), Firefox, Edge, crawlers, other in-app browsers and look-alikes get nothing', () => {
  for (const key of ['safariIos', 'chromeIos', 'chromeAndroid', 'chromeDesktop', 'safariDesktop', 'firefoxDesktop',
    'edgeDesktop', 'googlebot', 'facebookIos', 'trillian', 'thrill']) {
    assert.equal(rendered(UA[key]), null, key);
  }
  for (const ua of ['', undefined, null]) assert.equal(rendered(ua), null, String(ua));
});

test('detection: a browser that gets no notice is left exactly as it was: nothing created, nothing inserted, nothing listened for', () => {
  for (const key of ['safariIos', 'chromeIos', 'chromeDesktop']) {
    const page = makePage({ ua: UA[key] });
    const before = page.document.body.childNodes.slice();
    page.run();
    page.flush();
    assert.deepEqual(page.document.body.childNodes, before, `${key}: body changed`);
    assert.equal(page.calls.created, 0, `${key}: elements created`);
    assert.equal(page.timers.length, 0, `${key}: timers started`);
    assert.deepEqual(page.document.listeners, {}, `${key}: document listeners added`);
    assert.deepEqual(page.calls.scrollTo, []);
  }
});

test('detection: the same script runs on the other pages\' bytes (content page, Hunt page) and decides the same way', () => {
  for (const rel of ['faq.html', 'api/_lib/hunt-fallback.html', 'api/_lib/home-fallback.html']) {
    const src = noticeScripts(read(rel))[0];
    const tt = makePage({ ua: UA.tiktokIos });
    tt.run(src);
    assert.equal(tt.notice().getAttribute('data-hz-inapp-notice'), 'tiktok', rel);
    const safari = makePage({ ua: UA.safariIos });
    safari.run(src);
    assert.equal(safari.notice(), null, rel);
  }
});

test('detection: running twice never adds a second card', () => {
  const page = makePage({ ua: UA.tiktokIos });
  page.run();
  page.run();
  assert.equal(page.document.body.descendants().filter((e) => 'data-hz-inapp-notice' in e.attrs).length, 1);
});

// ------------------------------------------------------------------ the copy

const HEADLINE = 'Having trouble downloading Huntz?';
const BODY = {
  tiktok: 'TikTok can block the App Store. Tap the ••• menu at the top right, choose Open in browser, then tap Download.',
  instagram: 'Instagram can block the App Store. Tap the ••• menu at the top right, choose Open in external browser, then tap Download.',
};

test('copy: the founder\'s wording, exactly, for each app', () => {
  for (const [app, ua] of [['tiktok', UA.tiktokIos], ['instagram', UA.instagramIos]]) {
    const page = makePage({ ua });
    page.run();
    const card = page.notice();
    const text = card.textContent;
    assert.ok(text.startsWith(HEADLINE), `${app}: headline`);
    assert.equal(card.querySelector('[data-hz-inapp-body]').textContent, BODY[app], `${app}: body`);
    assert.ok(text.includes('Copy link'), `${app}: the Copy link control`);
  }
});

test('copy: the bold menu labels are markup only: the sentence reads the same with or without them', () => {
  const page = makePage({ ua: UA.tiktokIos });
  page.run();
  const body = page.notice().querySelector('[data-hz-inapp-body]');
  const bold = body.elements.filter((e) => e.tagName === 'STRONG').map((e) => e.textContent);
  assert.deepEqual(bold, ['•••', 'Open in browser', 'Download']);
  assert.equal(body.textContent, BODY.tiktok);
});

test('copy: no em or en dashes and no exclamation marks anywhere a visitor can read, in any state', async () => {
  const seen = [];
  for (const [ua, clipboard, execCopy] of [
    [UA.tiktokIos, { writeText: async () => {} }, true],           // copied
    [UA.instagramIos, undefined, false],                           // nothing works: shows the link
  ]) {
    const page = makePage({ ua, clipboard, execCopy });
    page.run();
    page.notice().querySelector('[data-hz-inapp-copy]').click();
    await settle();
    seen.push(page.notice().textContent, page.notice().querySelector('[data-hz-inapp-dismiss]').getAttribute('aria-label'),
      page.notice().getAttribute('aria-label'));
  }
  seen.push(...Object.values(BODY), HEADLINE);
  assert.ok(seen.some((s) => s.includes('Link copied')) && seen.some((s) => s.includes('Press and hold')));
  for (const text of seen) {
    assert.doesNotMatch(text, /[\u2012\u2013\u2014\u2015]/, `dash in ${JSON.stringify(text)}`);
    assert.doesNotMatch(text, /!/, `exclamation mark in ${JSON.stringify(text)}`);
  }
  // The script's own strings follow the rule too, wherever they are used.
  assert.doesNotMatch(SCRIPT.replace(/\/\*[\s\S]*?\*\//g, ''), /'[^'\n]*!+[^'\n]*'/, 'no string literal with an exclamation mark');
});

// ------------------------------------------------------- the card's behaviour

test('placement: after the sticky header on content and Hunt pages, so it never covers the header or a button', () => {
  const page = makePage({ ua: UA.tiktokIos });
  page.run();
  assert.deepEqual(page.document.body.childNodes.map((n) => n.tagName),
    ['HEADER', 'DIV', 'MAIN']);
  assert.equal(page.document.body.childNodes[1], page.notice());
  // In the flow, not positioned over the page, and no fixed or absolute anywhere in it.
  assert.doesNotMatch(page.notice().style.cssText, /position:\s*(fixed|absolute|sticky)/);
  for (const e of [page.notice(), ...page.notice().descendants()]) {
    if (e === page.notice().querySelector('[data-hz-inapp-dismiss]')) continue;
    assert.doesNotMatch(e.style.cssText, /position:\s*(fixed|absolute)/);
  }
  assert.equal(page.notice().style.marginTop, '12px');
});

test('placement: the home page\'s bar is fixed, so the card starts below it and follows it when it draws late', () => {
  const page = makePage({ ua: UA.tiktokIos, noHeader: true });
  page.run();
  assert.equal(page.document.body.childNodes[0], page.notice(), 'first in the body');
  assert.equal(page.notice().style.marginTop, '12px', 'the bar has not been drawn yet');
  const nav = new Element_('div', page.document);
  nav.setAttribute('id', 'hz-nav');
  nav.position = 'fixed';
  nav.offsetHeight = 65;
  page.document.body.appendChild(nav);
  page.flush();
  assert.equal(page.notice().style.marginTop, '77px', '12px below the 65px bar');
});

test('placement: it is readable at 375px: a card at most 560px wide inside a 12px gutter, 44px touch targets', () => {
  const page = makePage({ ua: UA.tiktokIos });
  page.run();
  const css = page.notice().style.cssText;
  assert.match(css, /width:calc\(100% - 24px\)/);
  assert.match(css, /max-width:560px/);
  assert.match(css, /margin:12px auto/);
  for (const sel of ['[data-hz-inapp-copy]', '[data-hz-inapp-dismiss]']) {
    assert.match(page.notice().querySelector(sel).style.cssText, /(min-)?height:44px/, sel);
  }
  assert.match(page.notice().querySelector('[data-hz-inapp-body]').style.cssText, /font:400 14\.5px\//);
});

test('style: the site\'s card system: cream surface, ink text, clay accent, Playfair headline, Figtree body', () => {
  const page = makePage({ ua: UA.tiktokIos });
  page.run();
  const css = page.notice().style.cssText;
  assert.match(css, /border:1px solid rgba\(22,19,14,\.14\)/);
  assert.match(css, /border-radius:18px/);
  assert.match(css, /linear-gradient\(180deg,rgba\(255,255,255,\.72\),rgba\(255,255,255,\.34\)\),#F3EFE7/);
  const all = page.notice().descendants().map((e) => e.style.cssText).join('\n');
  assert.match(all, /background:#C24E1F/, 'the clay rule');
  assert.match(all, /color:#16130E/);
  assert.match(all, /'Playfair Display'/);
  assert.match(all, /'Figtree'/);
});

test('copy link: writes https://huntz.ai to the clipboard and says so', async () => {
  const written = [];
  const page = makePage({ ua: UA.tiktokIos, clipboard: { writeText: async (t) => { written.push(t); } } });
  page.run();
  page.notice().querySelector('[data-hz-inapp-copy]').click();
  await settle();
  assert.deepEqual(written, ['https://huntz.ai']);
  const status = page.notice().descendants().find((e) => e.getAttribute('role') === 'status');
  assert.equal(status.textContent, 'Link copied. Paste it into your browser.');
  assert.equal(page.notice().querySelector('[data-hz-inapp-link]'), null, 'no manual field needed');
});

test('copy link: with no Clipboard API, falls back to the older copy command and cleans up after itself', async () => {
  const page = makePage({ ua: UA.instagramIos, execCopy: true });
  page.run();
  const before = page.document.body.childNodes.length;
  page.notice().querySelector('[data-hz-inapp-copy]').click();
  await settle();
  assert.equal(page.calls.execCommand, 1);
  assert.equal(page.document.body.childNodes.length, before, 'the temporary field is gone');
  const status = page.notice().descendants().find((e) => e.getAttribute('role') === 'status');
  assert.equal(status.textContent, 'Link copied. Paste it into your browser.');
});

test('copy link: when the Clipboard API refuses, the older command is tried before giving up', async () => {
  const page = makePage({ ua: UA.tiktokIos, execCopy: true, clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
  page.run();
  page.notice().querySelector('[data-hz-inapp-copy]').click();
  await settle();
  assert.equal(page.calls.execCommand, 1);
  const status = page.notice().descendants().find((e) => e.getAttribute('role') === 'status');
  assert.equal(status.textContent, 'Link copied. Paste it into your browser.');
});

test('copy link: if nothing can copy, the link is shown selectable so a press and hold still works', async () => {
  const page = makePage({ ua: UA.tiktokIos, execCopy: false });
  page.run();
  const button = page.notice().querySelector('[data-hz-inapp-copy]');
  button.click();
  await settle();
  button.click();
  await settle();
  const field = page.notice().querySelector('[data-hz-inapp-link]');
  assert.equal(field.value, 'https://huntz.ai');
  assert.equal(field.getAttribute('readonly'), '');
  assert.equal(page.notice().descendants().filter((e) => 'data-hz-inapp-link' in e.attrs).length, 1, 'one field, not one per tap');
  const status = page.notice().descendants().find((e) => e.getAttribute('role') === 'status');
  assert.equal(status.textContent, 'Press and hold the link, then tap Copy.');
});

test('dismiss: removes the card, leaves the page as it was, and stops watching for taps', () => {
  const page = makePage({ ua: UA.tiktokIos });
  const original = page.document.body.childNodes.slice();
  page.run();
  const close = page.notice().querySelector('[data-hz-inapp-dismiss]');
  assert.equal(close.getAttribute('aria-label'), 'Dismiss');
  close.click();
  assert.equal(page.notice(), null);
  assert.deepEqual(page.document.body.childNodes, original);
  assert.deepEqual(page.document.listeners.click || [], [], 'its tap listener is gone');
  page.storeLink.click();
  page.flush();
  assert.deepEqual(page.calls.scrollTo, [], 'no later scrolling');
});

test('App Store taps: the tap goes through untouched and the card is brought back into view', () => {
  const page = makePage({ ua: UA.tiktokIos });
  page.run();
  const card = page.notice();
  card.rect = { top: -400, bottom: -170 };                       // scrolled well past it
  const event = page.badge.click();                              // a tap on the badge image inside the link
  assert.equal(event.defaultPrevented, false, 'the link is not cancelled');
  assert.equal(page.calls.preventDefault, 0);
  assert.equal(page.storeLink.getAttribute('href'), STORE_URL, 'and not rewritten');
  assert.deepEqual(page.calls.scrollTo, [], 'it waits a beat so the menu sheet can finish closing');
  page.flush();
  assert.equal(page.calls.scrollTo.length, 1);
  const [x, y] = page.calls.scrollTo[0];
  assert.equal(x, 0);
  assert.equal(y, 900 - 400 - (63 + 8) - 4, 'above the card by the sticky header and a margin, never under it');
  assert.match(card.style.boxShadow, /rgba\(194,78,31,\.45\)/, 'and the card is highlighted for a moment');
  page.flush();
  assert.equal(card.style.boxShadow, '', 'then the highlight is removed');
});

test('App Store taps: a card already in view is not scrolled, and other links are ignored', () => {
  const page = makePage({ ua: UA.instagramIos });
  page.run();
  page.notice().rect = { top: 75, bottom: 300 };
  page.storeLink.click();
  page.flush();
  assert.deepEqual(page.calls.scrollTo, []);
  page.notice().rect = { top: -400, bottom: -170 };
  page.otherLink.click();
  page.flush();
  assert.deepEqual(page.calls.scrollTo, []);
});

test('App Store taps: the bar that stays on screen, fixed or sticky, is accounted for', () => {
  const page = makePage({ ua: UA.tiktokIos, noHeader: true });
  page.run();
  const nav = new Element_('div', page.document);
  nav.setAttribute('id', 'hz-nav');
  nav.position = 'fixed';
  nav.offsetHeight = 65;
  page.document.body.appendChild(nav);
  page.notice().rect = { top: -300, bottom: -70 };
  page.storeLink.click();
  page.flush();
  assert.equal(page.calls.scrollTo[0][1], 900 - 300 - (65 + 8) - 4);
});

// ------------------------------------------------- the shipped files agree

test('source: build/in-app-notice.js is what was inlined (minus its header comment), and it names the tokens it detects', () => {
  const src = read('build/in-app-notice.js');
  assert.ok(src.startsWith('/* In-app browser notice'));
  const body = src.replace(/^\/\*[\s\S]*?\*\/\n/, '').replace(/\n+$/, '');
  assert.equal(SCRIPT.replace(/^\n/, '').replace(/\n+$/, ''), body);
  for (const token of ['musical_ly', 'BytedanceWebview', 'TikTok', 'trill', 'Instagram']) {
    assert.ok(SCRIPT.includes(token), token);
  }
});

test('source: build/assemble.py puts the script on the pages with App Store buttons and not on /auth/callback', () => {
  const py = read('build/assemble.py');
  assert.match(py, /IN_APP_JS = "<script>\\n" \+ _IN_APP_BODY/);
  assert.equal((py.match(/NAV_JS \+ "\\n" \+ IN_APP_JS\)/g) || []).length, 4, 'content, article, blog index, hunt');
  assert.match(py, /NAV_JS \+ "\\n" \+ IN_APP_JS \+ "\\n" \+ FOCUS_JS/, 'home');
  assert.match(py, /drawer\("\/auth\/callback", "\/#waitlist", app_store=False\)[\s\S]{0,200}\.replace\("\{\{NAV_JS\}\}", NAV_JS\)\)/);
});
