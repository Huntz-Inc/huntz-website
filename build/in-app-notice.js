/* In-app browser notice (2026-10-19).
 *
 * TikTok's and Instagram's in-app browsers will not hand a link to the App
 * Store, so the "Download on the App Store" button looks dead to a visitor who
 * arrived from a creator's post. Inside those two browsers, and only there,
 * this script adds a small card that says how to get out to the real browser.
 *
 * build/assemble.py inlines this file, verbatim, as the last script of every
 * generated page that has an App Store button (the home page, the content
 * pages, the blog, and the /hunt page that api/hunt.js serves). It is plain
 * ES5 and ASCII only, because it has to parse in the oldest webview a creator's
 * audience might use; test/in-app-notice.test.js runs this exact file.
 *
 * Properties the tests pin:
 *  - The notice does not exist in the served HTML. Every other browser,
 *    crawlers included, gets the page byte for byte as before: the card is
 *    built here, from the user agent, and nowhere else.
 *  - The App Store buttons stay plain anchors. Nothing here redirects,
 *    cancels a click or rewrites a link. Tapping one only brings the card
 *    back into view, so the tap visibly does something.
 *  - Nothing is read from the URL, the query string or the referrer, and
 *    nothing is stored. The /hunt page's privacy rules (build/check.py) ban
 *    those APIs by name in the shared bytes, so dismissal lasts for the page
 *    view only.
 *  - Nothing is sent anywhere; "Copy link" only writes the constant below to
 *    the clipboard.
 */
(function () {
  'use strict';

  var COPY_URL = 'https://huntz.ai';
  var STORE_PREFIX = 'https://apps.apple.com/';
  var BULLETS = '\u2022\u2022\u2022';

  // One entry per supported app. The words that are menu labels are set in bold
  // so the three steps can be read at a glance; the text itself is unchanged.
  var APPS = {
    tiktok: {
      body: 'TikTok can block the App Store. Tap the ' + BULLETS + ' menu at the top right, ' +
        'choose Open in browser, then tap Download.',
      bold: [BULLETS, 'Open in browser', 'Download']
    },
    instagram: {
      body: 'Instagram can block the App Store. Tap the ' + BULLETS + ' menu at the top right, ' +
        'choose Open in external browser, then tap Download.',
      bold: [BULLETS, 'Open in external browser', 'Download']
    }
  };
  var TEXT = {
    headline: 'Having trouble downloading Huntz?',
    region: 'Download help',
    copy: 'Copy link',
    copied: 'Link copied. Paste it into your browser.',
    manual: 'Press and hold the link, then tap Copy.',
    dismiss: 'Dismiss'
  };

  // The tokens each app puts in its in-app browser's user agent. TikTok:
  // "musical_ly" (its original name, still in the iOS "musical_ly_<version>"
  // token and in Android's "AppName/musical_ly"), "BytedanceWebview" (the
  // wrapper's own marker), "TikTok" and "trill" (the Android build's name,
  // "trill_<build>"; matched only as a whole word, so "Trillian" is not
  // TikTok). Instagram: "Instagram" ("Instagram <version> (iPhone...)").
  // The class before "trill" stands in for a look-behind, which older iOS
  // webviews reject at parse time.
  var TIKTOK = /musical_ly|BytedanceWebview|TikTok|(?:^|[^a-z])trill(?![a-z])/i;
  var INSTAGRAM = /Instagram/i;

  function detect(ua) {
    ua = String(ua || '');
    if (TIKTOK.test(ua)) return 'tiktok';
    if (INSTAGRAM.test(ua)) return 'instagram';
    return null;
  }

  var INK = '#16130E', BODY = '#4A453C', CLAY = '#C24E1F';
  var SANS = "'Figtree',Arial,Helvetica,sans-serif";
  var SERIF = "'Playfair Display','Times New Roman',serif";

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  // The body sentence with its menu labels in bold, as text nodes and <strong>
  // elements, never as parsed HTML.
  function fillBody(p, app) {
    var rest = app.body;
    while (rest) {
      var at = -1, hit = '';
      for (var i = 0; i < app.bold.length; i++) {
        var k = rest.indexOf(app.bold[i]);
        if (k !== -1 && (at === -1 || k < at)) { at = k; hit = app.bold[i]; }
      }
      if (at === -1) { p.appendChild(document.createTextNode(rest)); return; }
      if (at > 0) p.appendChild(document.createTextNode(rest.slice(0, at)));
      p.appendChild(el('strong', 'font-weight:700;color:' + INK, hit));
      rest = rest.slice(at + hit.length);
    }
  }

  function copyText(text, done, failed) {
    function legacy() {
      var ok = false;
      try {
        var t = document.createElement('textarea');
        t.value = text;
        t.setAttribute('readonly', '');
        // 16px so iOS does not zoom the page when the field takes focus.
        t.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
        document.body.appendChild(t);
        t.focus();
        t.select();
        t.setSelectionRange(0, text.length);
        ok = !!document.execCommand('copy');
        document.body.removeChild(t);
      } catch (e) { ok = false; }
      if (ok) done(); else failed();
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, legacy);
        return;
      }
    } catch (e) { /* fall through to the older path */ }
    legacy();
  }

  function run() {
    var app = detect(navigator.userAgent);
    if (!app || !document.body) return;
    if (document.querySelector('[data-hz-inapp-notice]')) return;
    var copy = APPS[app];

    var box = el('div',
      'position:relative;box-sizing:border-box;width:calc(100% - 24px);max-width:560px;margin:12px auto;' +
      'padding:18px;border:1px solid rgba(22,19,14,.14);' +
      'border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.34)),#F3EFE7;' +
      'color:' + INK + ';text-align:left;transition:box-shadow .3s ease');
    box.setAttribute('data-hz-inapp-notice', app);
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', TEXT.region);

    // The site's own clay rule (as on the /hunt page) is the accent.
    box.appendChild(el('div', 'width:44px;height:2px;margin:0 0 12px;background:' + CLAY)).setAttribute('aria-hidden', 'true');

    box.appendChild(el('div',
      'font:600 19px/1.25 ' + SERIF + ';letter-spacing:-.012em;color:' + INK + ';margin:0 0 8px;padding-right:34px',
      TEXT.headline));

    var para = el('p', 'margin:0 0 14px;font:400 14.5px/1.55 ' + SANS + ';color:' + BODY);
    para.setAttribute('data-hz-inapp-body', '');
    fillBody(para, copy);
    box.appendChild(para);

    var row = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px');
    var copyBtn = el('button',
      'min-height:44px;padding:0 20px;border:1.5px solid ' + INK + ';border-radius:999px;background:transparent;' +
      'color:' + INK + ';font:700 12.5px ' + SANS + ';letter-spacing:.08em;cursor:pointer',
      TEXT.copy);
    copyBtn.setAttribute('type', 'button');
    copyBtn.setAttribute('data-hz-inapp-copy', '');
    var status = el('span', 'font:500 13px/1.4 ' + SANS + ';color:' + BODY);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    row.appendChild(copyBtn);
    row.appendChild(status);
    box.appendChild(row);

    var close = el('button',
      'position:absolute;top:4px;right:4px;width:44px;height:44px;padding:0;border:0;background:transparent;' +
      'color:' + INK + ';font:400 19px/1 ' + SANS + ';cursor:pointer',
      '\u2715');
    close.setAttribute('type', 'button');
    close.setAttribute('aria-label', TEXT.dismiss);
    close.setAttribute('data-hz-inapp-dismiss', '');
    box.appendChild(close);

    copyBtn.addEventListener('click', function () {
      copyText(COPY_URL, function () {
        status.textContent = TEXT.copied;
      }, function () {
        // No clipboard access in this webview: show the link, selected, so a
        // press and hold offers the system's own Copy.
        status.textContent = TEXT.manual;
        if (box.querySelector('[data-hz-inapp-link]')) return;
        var f = el('input',
          'box-sizing:border-box;width:100%;margin-top:10px;padding:10px 12px;border:1px solid rgba(22,19,14,.3);' +
          'border-radius:10px;background:#fff;color:' + INK + ';font:500 16px ' + SANS);
        f.setAttribute('type', 'text');
        f.setAttribute('readonly', '');
        f.setAttribute('aria-label', TEXT.copy);
        f.setAttribute('data-hz-inapp-link', '');
        f.value = COPY_URL;
        box.appendChild(f);
        try { f.focus(); f.select(); f.setSelectionRange(0, COPY_URL.length); } catch (e) { /* the field is still shown */ }
      });
    });

    // The home page's bar is fixed, so the card starts below it; the other
    // pages' bar is sticky and in the flow, so the card simply follows it.
    var bars = document.getElementsByTagName('header');
    var bar = bars && bars[0] && bars[0].parentNode === document.body ? bars[0] : null;
    document.body.insertBefore(box, bar ? bar.nextSibling : document.body.firstChild);

    // The bar that stays on screen as the page scrolls, if any, and how it sits.
    function pinned() {
      var b = document.getElementById('hz-nav') || bar;
      var cs = b && window.getComputedStyle ? window.getComputedStyle(b) : null;
      return cs && (cs.position === 'fixed' || cs.position === 'sticky') ? { el: b, fixed: cs.position === 'fixed' } : null;
    }
    function fit() {
      var p = pinned();
      box.style.marginTop = (12 + (p && p.fixed ? p.el.offsetHeight : 0)) + 'px';
    }
    fit();
    // The home page draws its bar after this script has run.
    window.addEventListener('load', fit);
    setTimeout(fit, 120);
    setTimeout(fit, 600);

    // A tap on any App Store link still goes to the link, untouched. If the
    // webview swallows it, the card is brought into view so the tap has an
    // answer. Deferred a beat so the menu sheet, which closes on the same tap
    // and restores its own scroll position, is done first.
    function onClick(e) {
      var n = e && e.target;
      while (n && n.parentNode) {
        if (n.tagName === 'A') {
          var href = n.getAttribute('href');
          if (href && href.indexOf(STORE_PREFIX) === 0) setTimeout(reveal, 80);
          return;
        }
        n = n.parentNode;
      }
    }
    function reveal() {
      if (!box.parentNode) return;
      var r = box.getBoundingClientRect();
      var p = pinned();
      var top = (p ? p.el.offsetHeight : 0) + 8;
      if (r.top < top || r.bottom > (window.innerHeight || 0)) {
        window.scrollTo(0, Math.max(0, r.top + (window.pageYOffset || 0) - top - 4));
      }
      box.style.boxShadow = '0 0 0 3px rgba(194,78,31,.45)';
      setTimeout(function () { box.style.boxShadow = ''; }, 1400);
    }
    document.addEventListener('click', onClick);

    close.addEventListener('click', function () {
      document.removeEventListener('click', onClick);
      if (box.parentNode) box.parentNode.removeChild(box);
    });
  }

  run();
})();
