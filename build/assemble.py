#!/usr/bin/env python3
"""Build the Huntz landing page into one self-contained HTML file.

    python3 build/assemble.py

Reads the Claude Design export in build/source/, inlines React + the design
runtime + the webfonts, applies the documented content edits, and writes:

  index.html                          — the deployed site (repo root)
  build/huntz-landing.artifact.html   — body-only variant for a Claude artifact

React and the fonts are downloaded once into build/vendor/ and cached, so the
first run needs network access and later runs don't. Nothing is fetched at
page-view time: the published page makes zero external requests.
"""
import base64, re, sys, urllib.request, pathlib

BUILD = pathlib.Path(__file__).resolve().parent
ROOT = BUILD.parent
SRC = BUILD / "source"
VENDOR = BUILD / "vendor"
VENDOR.mkdir(exist_ok=True)
(VENDOR / "fonts").mkdir(exist_ok=True)

# Absolute base URL used for og:image and og:url. Must match the canonical
# domain configured in Vercel — huntz.ai 308-redirects to www.huntz.ai, and a
# share image behind a redirect is not reliably fetched by social crawlers.
# If the apex is ever made primary instead, change this back to https://huntz.ai.
SITE_URL = "https://www.huntz.ai"

# react@18.3.1 UMD — the exact versions the design runtime pins, with the
# integrity hashes it ships; verified on download so a bad CDN response fails
# the build instead of silently shipping.
PINNED = {
    "react.js": ("https://unpkg.com/react@18.3.1/umd/react.production.min.js",
                 "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z"),
    "react-dom.js": ("https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
                     "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1"),
}
FONTS_CSS_URL = ("https://fonts.googleapis.com/css2?family=Playfair+Display:"
                 "ital,wght@0,500;0,600;0,700;1,500;1,600&family=Figtree:"
                 "wght@400;500;600;700;800&display=swap")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def fetch(url: str, dest: pathlib.Path, sri: str | None = None) -> bytes:
    """Download once into build/vendor/, then reuse. Verifies SRI when given."""
    if not dest.exists():
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req) as r:
            dest.write_bytes(r.read())
    data = dest.read_bytes()
    if sri:
        import hashlib
        got = "sha384-" + base64.b64encode(hashlib.sha384(data).digest()).decode()
        if got != sri:
            sys.exit(f"integrity mismatch for {url}\n  expected {sri}\n  got      {got}")
    return data


html = (SRC / "Huntz Landing.dc.html").read_text()
support = (SRC / "support.js").read_text()
react = fetch(PINNED["react.js"][0], VENDOR / "react.js", PINNED["react.js"][1]).decode()
react_dom = fetch(PINNED["react-dom.js"][0], VENDOR / "react-dom.js", PINNED["react-dom.js"][1]).decode()
fonts_css = fetch(FONTS_CSS_URL, VENDOR / "fonts.css").decode()

# ---- 1. fonts: keep latin subsets only, inline woff2 as data URIs ----
faces = re.findall(r"/\* ([a-z-]+) \*/\s*(@font-face \{[^}]+\})", fonts_css)
kept = []
for subset, block in faces:
    if subset != "latin":
        continue
    m = re.search(r"url\((https://[^)]+\.woff2)\)", block)
    if not m:
        sys.exit("no woff2 url in block")
    url = m.group(1)
    b64 = base64.b64encode(fetch(url, VENDOR / "fonts" / url.rsplit("/", 1)[1])).decode()
    kept.append(block.replace(url, f"data:font/woff2;base64,{b64}"))
print(f"embedded {len(kept)} latin font faces")
font_style = "<style>\n/* Playfair Display + Figtree, latin subset, embedded */\n" + "\n".join(kept) + "\n</style>"

# ---- 2. swap the Google Fonts links for the embedded style ----
link_re = re.compile(
    r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\s*'
    r'<link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin="anonymous">\s*'
    r'<link rel="stylesheet" href="https://fonts\.googleapis\.com/css2[^"]*">'
)
assert link_re.search(html), "font links not found"
# The home page links the fonts as a shared cached asset; the artifact keeps
# them inline. A token marks the spot until the variants split below.
html = link_re.sub("<!--HZ:FONTS-->", html)

# ---- 2b. content edits requested 2026-07-29 (deviations from the original export) ----
# (1) Footer "Contact" goes to email instead of the CTA section.
before = html
html = html.replace(
    """<a href="#cta" style="display:block;font:500 14.5px 'Figtree',Arial,Helvetica,sans-serif;color:#4A453C;text-decoration:none;transition:color .3s ease" style-hover="color:#C24E1F">Contact</a>""",
    """<a href="mailto:team@huntz.ai" style="display:block;font:500 14.5px 'Figtree',Arial,Helvetica,sans-serif;color:#4A453C;text-decoration:none;transition:color .3s ease" style-hover="color:#C24E1F">Contact</a>""",
)
assert html != before, "Contact link not found"

# (2) Drop Blog + Careers footer links until they exist.
for label in ("Blog", "Careers"):
    before = html
    html = re.sub(
        r'\s*<a href="#top"[^>]*>' + label + r'<span[^>]*>COMING SOON</span></a>',
        "", html)
    assert html != before, label + " link not found"

# (3) Drop the whole footer icon row — LinkedIn/TikTok/Instagram don't exist
# yet, and the EMAIL button was redundant (footer "Contact" and the CTA card
# both already link to team@huntz.ai).
html, n = re.subn(
    r'\s*<div style="display:flex;gap:10px;flex-wrap:wrap;font:600 10\.5px[^>]*>.*?</a>\s*</div>',
    "", html, flags=re.S)
assert n == 1, f"expected 1 footer icon row, removed {n}"
assert "LINKEDIN" not in html and "TIKTOK" not in html and "INSTAGRAM" not in html

# (4) FAQ fee copy: no percentage until the ProductConfig number is final.
before = html
html = html.replace(
    "10% service and verification fee when you join a hunt.",
    "Only a service fee when you join a hunt.",
)
assert html != before, "fee copy not found"

# (5) Terms of Service + Privacy Policy: hash-routed full pages (#/terms,
# #/privacy) that take over the viewport — works in the single file and the
# artifact, which can't host separate files. Content lives in legal-overlay.html.
for label, anchor in (("Terms of service", "/terms"), ("Privacy policy", "/privacy")):
    old = f"""<a href="#top" style="display:block;font:500 14.5px 'Figtree',Arial,Helvetica,sans-serif;color:#4A453C;text-decoration:none;transition:color .3s ease" style-hover="color:#C24E1F">{label}</a>"""
    assert old in html, label + " link not found"
    html = html.replace(old, old.replace('href="#top"', f'href="{anchor}"'))

# The two documents are generated from counsel's text by build/legal_build.py;
# the shell here only supplies chrome, routing, and the contents navigation.
legal = (BUILD / "legal-overlay.html").read_text()
for token, doc in (("{{TERMS}}", "legal-terms.html"), ("{{PRIVACY}}", "legal-privacy.html")):
    src = BUILD / doc
    if not src.exists():
        sys.exit(f"missing {doc} — run: python3 build/legal_build.py")
    assert token in legal, f"{token} placeholder not found"
    legal = legal.replace(token, src.read_text())
# The overlay is injected into the ARTIFACT variant only, further down. The
# home page stopped embedding both legal documents: /terms and /privacy are
# real routes, and duplicating ~220 KB of legal text on home hurt both weight
# and semantics (three h1-bearing documents in one page source).

# ---- 2c. design improvements requested 2026-07-29 (second round) ----

# (I-2) "Upcoming" hunt cards become actionable: click/Enter scrolls to the
# final CTA, focuses the email field, and records the interest (submitted with
# the email once the waitlist backend is wired).
HUNT_NAMES = ["Apply to jobs", "Post content", "Read books", "Stay fit", "Live stream"]
_card_i = {"i": 0}
def _card_attrs(m):
    i = _card_i["i"]; _card_i["i"] += 1
    n = HUNT_NAMES[i]
    # role/tabIndex/aria-label are launch-switch-aware (App Store section
    # below): plateRole/plateTabIndex/pickAria<i> resolve to undefined once
    # the App Store link is live, so the runtime drops the attributes and the
    # card goes inert without a template fork.
    return ('<div data-plate="" onClick="{{ pick%d }}" onKeyDown="{{ pickkey%d }}" role="{{ plateRole }}" tabIndex="{{ plateTabIndex }}" '
            'aria-label="{{ pickAria%d }}" style="cursor:pointer;scroll-snap-align:start;' % (i, i, i))
html, n = re.subn(r'<div data-plate="" style="scroll-snap-align:start;', _card_attrs, html)
assert n == 5, f"expected 5 hunt cards, patched {n}"

# Each card states its outcome before it's clicked — otherwise a curious tap
# silently assigns an interest the visitor never asked for.
stake_row = ("""<div style="display:flex;justify-content:space-between;gap:10px;font:500 10.5px 'Figtree',Arial,Helvetica,sans-serif;"""
             """letter-spacing:.1em;color:currentColor"><span style="opacity:.85">STAKE</span><span style="font-weight:700">FROM $50</span></div>""")
assert html.count(stake_row) == 5, f"expected 5 stake rows, found {html.count(stake_row)}"
card_cta = ("""<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:4px;padding-top:12px;"""
            """border-top:1px solid currentColor;font:700 9.5px 'Figtree',Arial,Helvetica,sans-serif;letter-spacing:.15em;color:currentColor">"""
            """<span>I WANT THIS HUNT</span><span aria-hidden="true">&#8594;</span></div>""")
html = html.replace(stake_row, stake_row + card_cta)

# (I-3a) FAQ rows respond to Enter/Space, not only clicks.
html, n = re.subn(r'onClick="\{\{ toggle(\d) \}\}" role="button" tabIndex="0"',
                  r'onClick="{{ toggle\1 }}" onKeyDown="{{ faqkey\1 }}" role="button" tabIndex="0"', html)
assert n == 5, f"expected 5 FAQ rows, patched {n}"

# (I-3b) Visible keyboard focus everywhere.
old = "input::placeholder{color:#948D80}"
assert old in html
html = html.replace(old, old + "\na:focus-visible,button:focus-visible,[role=\"button\"]:focus-visible{outline:2px solid #C24E1F;outline-offset:3px}"
    # (I-4b) Mobile: the fixed nav wrapped to 162px tall at phone widths (logo +
    # 4 links stacked). Below 640px keep logo + CTA only — sections are a swipe away.
    + "\n@media (max-width:640px){#hz-nav a[href=\"#mechanic\"],#hz-nav a[href=\"#challenges\"],#hz-nav a[href=\"#why\"]{display:none}}")

# (I-4) Mobile: the FAQ subtitle was nowrap and overflowed at 375px.
before = html
html = html.replace(";color:#4A453C;white-space:nowrap\">The five we get every day.",
                    ";color:#4A453C\">The five we get every day.")
assert html != before, "FAQ subtitle not found"

# (I-5a) Waitlist form: real validation, busy state, inline errors.
hero_btn = """<button type="submit" style="padding: 15px 24px; background: #C24E1F; border: 1.5px solid #C24E1F; color: #F3EFE7; font: 700 12px 'Figtree',Arial,Helvetica,sans-serif; letter-spacing: .12em; cursor: pointer; border-radius: 0; font-family:'Figtree',Arial,Helvetica,sans-serif; transition: background .25s ease, border-color .25s ease, transform .12s ease" style-hover="background:#16130E;border-color:#16130E" style-active="transform:translateY(2px)">JOIN THE WAITLIST</button>"""
assert hero_btn in html
html = html.replace(hero_btn, hero_btn.replace('<button type="submit" ', '<button type="submit" disabled="{{ busy1 }}" ').replace(">JOIN THE WAITLIST<", ">{{ heroBtn }}<"))

final_btn = """<button type="submit" style="padding:17px 28px;background:#C24E1F;border:1px solid #C24E1F;border-radius:14px;color:#F3EFE7;font:700 12.5px 'Figtree',Arial,Helvetica,sans-serif;letter-spacing:.12em;cursor:pointer;box-shadow:0 18px 30px -22px rgba(194,78,31,.9);transition:background .3s ease,border-color .3s ease,transform .15s ease" style-hover="background:#16130E;border-color:#16130E" style-active="transform:translateY(2px)">JOIN THE WAITLIST</button>"""
assert final_btn in html
html = html.replace(final_btn, final_btn.replace('<button type="submit" ', '<button type="submit" disabled="{{ busy2 }}" ').replace(">JOIN THE WAITLIST<", ">{{ finalBtn }}<"))

err_div = """<sc-if value="{{ %s }}"><div style="flex:1 1 100%%;font:600 11.5px 'Figtree',Arial,Helvetica,sans-serif;letter-spacing:.04em;color:#C24E1F">{{ %s }}</div></sc-if>"""
old = "\n          </form>\n        </sc-if>"
assert html.count(old) == 1
html = html.replace(old, "\n            " + err_div % ("err1", "err1") + old)
old = "\n            </form>\n          </sc-if>"
assert html.count(old) == 1
html = html.replace(old, "\n              " + err_div % ("err2", "err2") + old)

# (I-2b) Interest chip above the final form.
old = """<div id="fin-form" style="opacity:0;transform:translateY(20px)">"""
assert old in html
html = html.replace(old, old + """\n          <sc-if value="{{ interest }}"><div style="display:inline-flex;align-items:center;gap:9px;margin-bottom:14px;padding:6px 8px 6px 12px;border:1px solid rgba(194,78,31,.45);border-radius:20px;font:700 9.5px 'Figtree',Arial,Helvetica,sans-serif;letter-spacing:.14em;color:#C24E1F;text-transform:uppercase">Joining for: {{ interest }}<button type="button" onClick="{{ clearInterest }}" aria-label="Remove this interest" style="width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:0;border-radius:50%;background:rgba(194,78,31,.12);color:#C24E1F;font:400 11px 'Figtree',Arial,Helvetica,sans-serif;cursor:pointer;padding:0" style-hover="background:#C24E1F;color:#F3EFE7">&#10005;</button></div></sc-if>""")

# (I-5b) Logic class: validated submit with Mailchimp-ready endpoint.
old = "state = { sub1: false, sub2: false };"
assert old in html
html = html.replace(old, "state = { sub1: false, sub2: false, busy1: false, busy2: false, err1: '', err2: '', interest: '' };")

old = """  submitHero = (e) => { e.preventDefault(); const i = e.target.querySelector('input'); if (i && i.value.indexOf('@') > 0) this.setState({ sub1: true }); };
  submitFinal = (e) => { e.preventDefault(); const i = e.target.querySelector('input'); if (i && i.value.indexOf('@') > 0) this.setState({ sub2: true }); };"""
assert old in html
html = html.replace(old, """  // Waitlist backend. Paste the Mailchimp embedded-form action URL here
  // (https://xxx.usN.list-manage.com/subscribe/post?u=...&id=...), or any
  // endpoint accepting JSON POST {email, interest} (e.g. Formspree).
  // Empty = local confirmation only, no email is stored anywhere.
  WAITLIST_ENDPOINT = 'https://huntz.us18.list-manage.com/subscribe/post?u=b7144d02c740628b3280ff55f&id=3ee28a30af&f_id=000baee6f0';
  // Mailchimp's bot-trap field from the embedded form; must be sent empty.
  WAITLIST_HONEYPOT = 'b_b7144d02c740628b3280ff55f_3ee28a30af';
  emailOk(v) { return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(v); }
  submit(e, n) {
    e.preventDefault();
    const i = e.target.querySelector('input');
    const v = i ? i.value.trim() : '';
    if (!this.emailOk(v)) { this.setState({ ['err' + n]: "That email doesn't look right. Check it and try again." }); return; }
    if (!this.WAITLIST_ENDPOINT) { this.setState({ ['sub' + n]: true, ['err' + n]: '' }); return; }
    this.setState({ ['busy' + n]: true, ['err' + n]: '' });
    const FALLBACK = "Couldn't join right now. Try again, or email team@huntz.ai.";
    // Mailchimp sends back its own readable reason ("This email address looks
    // fake or invalid.") prefixed with a code and sometimes wrapped in markup, so
    // show the sentence, not our generic line, when there is one.
    const clean = m => {
      if (!m) return FALLBACK;
      const t = String(m).replace(/^\d+\s*-\s*/, '').replace(/<[^>]*>/g, '').trim();
      return t.length > 4 && t.length < 200 ? t : FALLBACK;
    };
    const done = (ok, msg) => this.setState(ok
      ? { ['sub' + n]: true, ['busy' + n]: false }
      : { ['busy' + n]: false, ['err' + n]: clean(msg) });
    const ep = this.WAITLIST_ENDPOINT;
    if (ep.indexOf('list-manage.com') > -1) {
      const cb = '__hzMc' + Date.now();
      const s = document.createElement('script');
      // "already subscribed" is a success from the visitor's point of view.
      window[cb] = res => {
        delete window[cb]; s.remove();
        const msg = (res && res.msg) || '';
        done(!!res && (res.result === 'success' || /already/i.test(msg)), msg);
      };
      s.src = ep.replace('/post?', '/post-json?') + '&EMAIL=' + encodeURIComponent(v)
        + (this.state.interest ? '&INTEREST=' + encodeURIComponent(this.state.interest) : '')
        + (this.WAITLIST_HONEYPOT ? '&' + this.WAITLIST_HONEYPOT + '=' : '')
        + '&c=' + cb;
      s.onerror = () => { delete window[cb]; s.remove(); done(false, ''); };
      document.head.appendChild(s);
    } else {
      fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ email: v, interest: this.state.interest || '' }) }).then(r => done(r.ok)).catch(() => done(false));
    }
  }
  submitHero = (e) => this.submit(e, 1);
  submitFinal = (e) => this.submit(e, 2);
  clearInterest = () => this.setState({ interest: '' });
  pickHunt(name) {
    this.setState({ interest: name });
    this.playFinale(true);
    const cta = document.getElementById('cta');
    if (cta) cta.scrollIntoView({ block: 'start' });
    setTimeout(() => { const i = document.querySelector('#fin-form input'); if (i) i.focus({ preventScroll: true }); }, 80);
  }""")

old = "if (!this._faqToggles) this._faqToggles = [0, 1, 2, 3, 4].map(i => () => this.toggleFaq(i));"
assert old in html
html = html.replace(old, old + """
    if (!this._faqKeys) this._faqKeys = [0, 1, 2, 3, 4].map(i => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleFaq(i); } });
    if (!this._picks) {
      const names = ['Apply to jobs', 'Post content', 'Read books', 'Stay fit', 'Live stream'];
      this._picks = names.map(n => () => this.pickHunt(n));
      this._pickKeys = names.map(n => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pickHunt(n); } });
    }""")

old = "toggle0: this._faqToggles[0], toggle1: this._faqToggles[1], toggle2: this._faqToggles[2], toggle3: this._faqToggles[3], toggle4: this._faqToggles[4]"
assert old in html
html = html.replace(old, old + """,
      faqkey0: this._faqKeys[0], faqkey1: this._faqKeys[1], faqkey2: this._faqKeys[2], faqkey3: this._faqKeys[3], faqkey4: this._faqKeys[4],
      pick0: this._picks[0], pick1: this._picks[1], pick2: this._picks[2], pick3: this._picks[3], pick4: this._picks[4],
      pickkey0: this._pickKeys[0], pickkey1: this._pickKeys[1], pickkey2: this._pickKeys[2], pickkey3: this._pickKeys[3], pickkey4: this._pickKeys[4],
      err1: this.state.err1, err2: this.state.err2, busy1: this.state.busy1, busy2: this.state.busy2,
      interest: this.state.interest, clearInterest: this.clearInterest,
      heroBtn: this.state.busy1 ? 'JOINING…' : 'JOIN THE WAITLIST',
      finalBtn: this.state.busy2 ? 'JOINING…' : 'JOIN THE WAITLIST'""")

# (I-3c) Contrast: the muted warm gray was ~2.8:1 on the cream ground at 11px.
# #6E6759 keeps the same warm hue at ~4.6:1. Applies to template + legal overlay.
n = html.count("#948D80")
assert n > 20, f"unexpected #948D80 count {n}"
html = html.replace("#948D80", "#6E6759")

# (6) Fix: nav/anchor links never scrolled. html{scroll-behavior:smooth} makes
# every anchor jump animate, and the page's 60fps animation loop cancels the
# animation each frame, so it never moves. Native wheel/trackpad scrolling was
# unaffected. Dropping the rule makes nav clicks jump directly to the section.
before = html
html = html.replace("html{scroll-behavior:smooth}", "")
assert html != before, "scroll-behavior rule not found"

# (8) iOS: the page drifted sideways and juddered while scrolling on a phone.
# Two causes, both invisible on desktop:
#
#   a) `background-attachment: fixed` on <body>. iOS Safari does not really
#      implement it — it re-rasterises the gradient against the visual viewport
#      on every momentum-scroll frame, which reads as the page wobbling. The
#      gradient is moved to a fixed pseudo-element instead, which iOS composites
#      properly and which looks identical on desktop.
#   b) `overflow-x: hidden` was on <body> but not <html>, so the document
#      element stayed a horizontal scroll container and iOS allowed sideways
#      panning/rubber-banding. `overflow-x: clip` on both suppresses the pan
#      without creating a scroll container (the `hidden` line stays first as a
#      fallback for older engines).
BODY_CSS_OLD = ("body{margin:0;font-family:'Figtree',Arial,Helvetica,sans-serif;background:#F1EBE0;"
                "background-image:radial-gradient(120% 85% at 50% -10%,#FBF8F2 0%,#F3EEE5 42%,#EBE4D7 100%);"
                "background-attachment:fixed;color:#16130E;overflow-x:hidden;")
assert BODY_CSS_OLD in html, "body background rule not found"
html = html.replace(BODY_CSS_OLD,
    "body{margin:0;font-family:'Figtree',Arial,Helvetica,sans-serif;background:#F1EBE0;"
    "color:#16130E;overflow-x:hidden;overflow-x:clip;overscroll-behavior-x:none;")

STYLE_ANCHOR = "a{color:#16130E}a:hover{color:#C24E1F}"
assert STYLE_ANCHOR in html
html = html.replace(STYLE_ANCHOR,
    "html{overflow-x:hidden;overflow-x:clip;overscroll-behavior-x:none}\n"
    # The gradient <body> used to paint with background-attachment:fixed.
    "body::before{content:'';position:fixed;inset:0;z-index:-2;pointer-events:none;"
    "background-image:radial-gradient(120% 85% at 50% -10%,#FBF8F2 0%,#F3EEE5 42%,#EBE4D7 100%)}\n"
    # Keep a sideways swipe on the Hunts carousel from chaining to the page.
    "#ch-rail{overscroll-behavior-x:contain}\n"
    + STYLE_ANCHOR)

# (7) No em dashes anywhere in the copy. Each one is repunctuated for its own
# sentence rather than swapped for a single substitute, so the rhythm survives:
# a colon where a list follows, a period where two statements were joined, the
# site's own "·" separator in the eyebrow.
#
# The hero eyebrow deliberately keeps its em dash (founder's call, 2026-07-29):
# a middot got lost against the page's dot-grid background at that letter
# spacing, and the dash carries the brand line better.
EM_DASH_COPY = [
    ("Finish and you get 100% back — plus a share of the stakes forfeited by everyone who quit.",
     "Finish and you get 100% back, plus a share of the stakes forfeited by everyone who quit."),
    ("One proof per session — a photo, a screenshot, a check-in.",
     "One proof per session: a photo, a screenshot, a check-in."),
    # The em-dash fix here also drops the 48-hour settlement claim: the
    # approved Terms promise payouts after conclusion + verification + any
    # dispute window, not a clock (founder direction, 2026-08-13).
    ("plus a capped share of the stakes forfeited by those who quit — both settled to your account within 48 hours of the hunt closing.",
     "plus a capped share of the stakes forfeited by those who quit. Both are settled to your account once the Hunt closes and verification is complete."),
    ("Every hunt publishes its rules before you join — allowed misses, grace days, deadlines.",
     "Every hunt publishes its rules before you join: allowed misses, grace days, deadlines."),
    ("checked against the hunt's rules — an automated first pass, human review for anything unclear,",
     "checked against the hunt's rules: an automated first pass, human review for anything unclear,"),
]
for old, new in EM_DASH_COPY:
    assert old in html, "em-dash copy not found: " + old[:60]
    html = html.replace(old, new)

# ---- 2d. SEO phase 1 content edits (2026-08-13, approved plan) ----

# (S-1) Footer becomes the crawlable route map. "How it works" points at the
# dedicated page (the home section keeps its header anchor), and the new
# Accountability challenges and FAQ pages join the PLATFORM column.
LINK_STYLE = ('style="display:block;font:500 14.5px \'Figtree\',Arial,Helvetica,sans-serif;color:#4A453C;'
              'text-decoration:none;transition:color .3s ease" style-hover="color:#C24E1F"')
old = f'<a href="#mechanic" {LINK_STYLE}>How it works</a>'
assert old in html, "footer How it works not found"
html = html.replace(old,
    f'<a href="/how-it-works" {LINK_STYLE}>How it works</a>\n'
    f'            <a href="/accountability-challenges" {LINK_STYLE}>Accountability challenges</a>\n'
    f'            <a href="/faq" {LINK_STYLE}>FAQ</a>')

# (S-2) About is a real page now; the COMING SOON pill comes off.
old = (f'<a href="#top" {LINK_STYLE}>About<span style="display:inline-block;margin-left:9px;padding:3px 8px;'
       'border-radius:20px;background:rgba(194,78,31,.12);color:#C24E1F;white-space:nowrap;'
       "font:700 8px 'Figtree',Arial,Helvetica,sans-serif;letter-spacing:.14em;vertical-align:1.5px\">COMING SOON</span></a>")
assert old in html, "footer About not found"
html = html.replace(old, f'<a href="/about" {LINK_STYLE}>About</a>\n'
                         f'            <a href="/blog" {LINK_STYLE}>Blog</a>')

# (S-3) Contact gets its own page; the page itself carries the mailto.
old = f'<a href="mailto:team@huntz.ai" {LINK_STYLE}>Contact</a>'
assert old in html, "footer Contact not found"
html = html.replace(old, f'<a href="/contact" {LINK_STYLE}>Contact</a>')

# (S-4) Removed 2026-08-13 (founder decision): no hero pre-launch disclaimer.
# The waitlist CTA and the COMING SOON labels carry the pre-launch signal.

# (S-5) The dark HUNT No.0412 example card keeps the design's own "PAID IN 48H"
# chip (founder direction, restored 2026-08-13). The unqualified prose promise
# that used to repeat the claim was dropped in the em-dash pass above and stays
# dropped, so the phrase survives exactly once: on the card that is labeled as
# an example directly underneath it.
assert html.count("PAID IN 48H") == 1, "settlement chip not found"

# The worked example is labeled as such, in the founder's exact wording.
old = 'PAID IN 48H</span>\n        </div>'
assert old in html, "settlement strip not found"
html = html.replace(old, old + '\n        '
    '<div style="padding:9px 15px 11px;font:500 9.5px/1.7 \'Figtree\',Arial,Helvetica,sans-serif;'
    'letter-spacing:.02em;color:rgba(243,239,231,.6)">'
    "Example outcome. Each Hunt's rules and verification method are shown before you join.</div>")

# (S-6) The email fields relied on placeholder text alone; give them a
# programmatic label without changing the design.
n = html.count('<input type="email" required="" placeholder="you@email.com"')
assert n == 2, f"expected 2 email inputs, found {n}"
html = html.replace('<input type="email" required="" placeholder="you@email.com"',
                    '<input type="email" required="" aria-label="Email address" placeholder="you@email.com"')

# (S-7) Home keeps its five FAQ answers and links the full page.
old = '>The five we get every day. Not here? team@huntz.ai</p>'
assert old in html, "FAQ subtitle not found"
html = html.replace(old,
    '>The five we get every day. More answers on the <a href="/faq" style="color:#C24E1F">full FAQ</a>. '
    'Not here? team@huntz.ai</p>')

# (S-9) Waitlist anchor and Hunts-section anchor (2026-08-13 correction pass).
# The hero form container becomes #waitlist so every JOIN THE WAITLIST button
# can target and focus one form, on-page and cross-page. The Upcoming section
# is renamed #hunts so the #challenges hash can be reserved as a legacy
# redirect to the /accountability-challenges hub.
assert html.count('id="join"') == 1
html = html.replace('id="join"', 'id="waitlist"')
assert '"#join"' not in html

assert html.count('<a href="#cta"') == 1  # the nav JOIN THE WAITLIST button
html = html.replace('<a href="#cta"', '<a href="#waitlist"')

assert html.count('id="challenges"') == 1
html = html.replace('id="challenges"', 'id="hunts"')
# Three occurrences: the nav HUNTS link, the footer Upcoming hunts link, and
# the mobile-nav CSS selector from (I-4b), which must track the rename.
n = html.count('href="#challenges"')
assert n == 3, f"expected 3 #challenges occurrences (2 links + 1 CSS selector), found {n}"
html = html.replace('href="#challenges"', 'href="#hunts"')
assert "#challenges" not in html

# ---- 2e. site navigation (2026-08-13): one route table, three surfaces ----
# Header bar, mobile drawer and page footers are all generated from ROUTES, so a
# destination cannot exist in one surface and be missing from another, and the
# active-route marking is derived rather than hand-written per page.
INK, BODYC, MUTED, CLAY = "#16130E", "#4A453C", "#6E6759", "#C24E1F"
CREAM = "#F3EFE7"
DONE = "#4F6A45"   # the design's own colour for a completed state
SERIF = "'Playfair Display','Times New Roman',serif"
SANS = "'Figtree',Arial,Helvetica,sans-serif"

# (href, drawer/footer label, header label, in the desktop header?, only >=900px?)
ROUTES = [
    ("/",                          "Home",         "HOME",         False, False),
    ("/how-it-works",              "How it works", "HOW IT WORKS", True,  False),
    ("/accountability-challenges", "Challenges",   "CHALLENGES",   True,  False),
    ("/faq",                       "FAQ",          "FAQ",          True,  False),
    ("/blog",                      "Blog",         "BLOG",         True,  True),
    ("/about",                     "About",        "ABOUT",        True,  True),
    ("/contact",                   "Contact",      "CONTACT",      True,  True),
    ("/terms",                     "Terms",        "TERMS",        False, False),
    ("/privacy",                   "Privacy",      "PRIVACY",      False, False),
]

# `current` is the route the page is being generated for, so the active state is
# baked into the HTML: no flash, no JavaScript, and it survives with JS off. The
# home page is always "/" whatever the hash, so /#waitlist is not a second page.
def _cur(href: str, current: str) -> str:
    return ' aria-current="page"' if href == current else ""

NAV_CSS = f"""
/* Navigation. The drawer is the only navigation below 641px, so the desktop bar
   and its CTA come off and the menu button comes on at exactly that width. */
[data-hz-menu-btn]{{ display:none }}
#hz-menu[hidden]{{ display:none !important }}
#hz-menu{{ display:block }}
@media (max-width:640px){{
  [data-hz-menu-btn]{{ display:inline-flex !important }}
  [data-hz-desknav]{{ display:none !important }}
}}
/* About and Contact would push the bar into a second line on small laptops. */
@media (max-width:899px){{ [data-hz-wide]{{ display:none !important }} }}
[data-hz-menu-btn]:focus-visible,#hz-menu a:focus-visible,#hz-menu button:focus-visible{{
  outline:2px solid {CLAY}; outline-offset:2px }}
[data-hz-navlink]:hover{{ color:{INK} }}
[data-hz-drawerlink]:hover{{ color:{CLAY} }}
/* Two balanced columns of comfortable tap targets instead of a ragged wrap. */
@media (max-width:640px){{
  [data-hz-footernav]{{ display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr));
                        gap:0 18px !important; margin-left:0 !important }}
  /* The legal pair is wrapped so it can sit right on desktop; the wrapper
     carries an inline display:flex, which only !important can unseat. */
  [data-hz-footernav] > span{{ display:contents !important }}
  [data-hz-footernav] a{{ display:flex; align-items:center; min-height:44px; margin-left:0 !important }}
}}
"""

MENU_BUTTON = (
    '<button type="button" data-hz-menu-btn aria-controls="hz-menu" aria-expanded="false" '
    'aria-label="Menu" style="align-items:center;justify-content:center;flex-direction:column;'
    f'gap:5px;width:44px;height:44px;margin:-5px 0;padding:0;border:0;background:transparent;cursor:pointer;color:{INK}">'
    + '<span aria-hidden="true" style="display:block;width:22px;height:2px;background:currentColor"></span>' * 3
    + "</button>"
)


def header_nav(current: str) -> str:
    """The content-page desktop bar. Home lives on the logo, so it is not a link here."""
    base = (f"font:600 11px {SANS};letter-spacing:.14em;text-decoration:none;"
            "padding:7px 0;border-bottom:2px solid transparent")
    out = []
    for href, _label, head_label, in_head, wide in ROUTES:
        if not in_head:
            continue
        on = href == current
        style = base + (f";color:{INK};border-bottom-color:{CLAY}" if on else f";color:{MUTED}")
        out.append(f'<a href="{href}" data-hz-navlink{" data-hz-wide" if wide else ""}'
                   f'{_cur(href, current)} style="{style}">{head_label}</a>')
    return "\n    ".join(out)


def drawer(current: str, waitlist_href: str, *, app_store: bool = True) -> str:
    """Full-height sheet: every route plus the waitlist action, one tap each.
    The waitlist/App Store choice is the module-level APP_STORE_URL switch
    (defined with the rest of the App Store launch switch patch, in 2f below),
    so this one shared function renders the right thing on every page from a
    single build-time constant, with no parameter threaded through most call
    sites. app_store=False overrides that for the couple of routes that must
    never claim App Store availability regardless of the site-wide switch
    (hunt-fallback.html's limited-beta copy, auth/callback.html's account-
    agnostic copy - see their own build/check.py rules): they keep this link
    reading "JOIN THE WAITLIST" even once APP_STORE_URL is live."""
    links = []
    for href, _label, head_label, _in_head, _wide in ROUTES:
        on = href == current
        style = (f"display:flex;align-items:center;min-height:52px;font:600 12.5px {SANS};"
                 "letter-spacing:.13em;text-decoration:none;border-bottom:1px solid rgba(22,19,14,.10);"
                 + (f"padding-left:13px;border-left:3px solid {CLAY};color:{CLAY}"
                    if on else f"padding-left:0;color:{INK}"))
        links.append(f'<a href="{href}" data-hz-drawerlink{_cur(href, current)} '
                     f'style="{style}">{head_label}</a>')
    if APP_STORE_URL and app_store:
        cta = (f'<a href="{APP_STORE_URL}" style="display:flex;align-items:center;justify-content:center;'
               f'gap:10px;min-height:52px;margin-top:20px;background:{CLAY};color:{CREAM};font:700 12px {SANS};'
               f'letter-spacing:.12em;text-decoration:none">{apple_mark(18)}<span>Download app</span></a>')
    else:
        cta = (f'<a href="{waitlist_href}" style="display:flex;align-items:center;justify-content:center;'
               f'min-height:52px;margin-top:20px;background:{CLAY};color:{CREAM};font:700 12px {SANS};'
               f'letter-spacing:.12em;text-decoration:none">JOIN THE WAITLIST</a>')
    return f"""<div id="hz-menu" hidden tabindex="-1" role="dialog" aria-modal="true" aria-label="Site menu" style="position:fixed;inset:0;z-index:90;outline:0">
  <div data-hz-scrim style="position:absolute;inset:0;background:rgba(22,19,14,.5)"></div>
  <nav data-hz-panel aria-label="Site" style="position:absolute;top:0;left:0;right:0;max-height:100%;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:{CREAM};border-bottom:1px solid rgba(22,19,14,.14);padding:0 clamp(20px,5vw,44px) 24px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;height:64px">
      <span style="font:800 20px {SANS};letter-spacing:-.02em;color:{INK}">HUNTZ<span style="color:{CLAY}">.</span></span>
      <button type="button" data-hz-menu-close aria-label="Close menu" style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border:0;background:transparent;color:{INK};font:400 21px/1 {SANS};cursor:pointer">&#10005;</button>
    </div>
    <div style="display:flex;flex-direction:column">
      {chr(10).join("      " + l for l in links).strip()}
    </div>
    {cta}
  </nav>
</div>"""


def footer_nav(current: str) -> str:
    """Content-page footer row: one flex line on desktop, two even columns on phones."""
    base = f"font:600 11px {SANS};letter-spacing:.12em;text-decoration:none"
    def link(href, label, extra=""):
        on = href == current
        style = base + (f";color:{CLAY}" if on else f";color:{MUTED}") + extra
        return f'<a href="{href}"{_cur(href, current)} style="{style}">{label.upper()}</a>'
    main = [link(h, hl) for h, _l, hl, _ih, _w in ROUTES if h not in ("/terms", "/privacy")]
    legal = [link(h, hl) for h, _l, hl, _ih, _w in ROUTES if h in ("/terms", "/privacy")]
    return ('<nav data-hz-footernav aria-label="Footer" style="display:flex;flex-wrap:wrap;gap:10px 22px;'
            'align-items:baseline;margin-top:26px;padding-top:22px;border-top:1px solid rgba(22,19,14,.14)">\n    '
            + "\n    ".join(main)
            + '\n    <span style="margin-left:auto;display:flex;gap:22px">'
            + "".join(legal) + "</span>\n  </nav>")


# The controller is deliberately outside the design runtime: it delegates from
# `document`, so it keeps working across a React re-render, and it owns nothing
# React renders except the button's aria state, which it re-asserts if the bar
# is ever rebuilt while the sheet is open.
NAV_JS = """<script>
(function () {
  var open = false, opener = null, savedY = 0, obs = null;
  function panel() { var m = document.getElementById('hz-menu'); return m && m.querySelector('[data-hz-panel]'); }
  function sync() {
    var b = document.querySelectorAll('[data-hz-menu-btn]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function focusable() {
    var p = panel();
    if (!p) return [];
    return Array.prototype.filter.call(
      p.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'),
      function (el) { return el.getClientRects().length > 0; });
  }
  function openMenu(trigger) {
    var m = document.getElementById('hz-menu');
    if (!m || open) return;
    opener = trigger || document.activeElement;
    open = true;
    m.hidden = false;
    // iOS ignores overflow:hidden on a scrolled document, so the body is pinned
    // at its current offset and released to the same offset on close.
    savedY = window.pageYOffset || document.documentElement.scrollTop || 0;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = -savedY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    sync();
    m.focus({ preventScroll: true });
    if (window.MutationObserver) {
      obs = new MutationObserver(sync);
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }
  function closeMenu(restoreFocus) {
    var m = document.getElementById('hz-menu');
    if (!m || !open) return;
    open = false;
    m.hidden = true;
    if (obs) { obs.disconnect(); obs = null; }
    document.documentElement.style.overflow = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, savedY);
    sync();
    if (restoreFocus !== false && opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var btn = t.closest('[data-hz-menu-btn]');
    if (btn) { e.preventDefault(); open ? closeMenu() : openMenu(btn); return; }
    if (!open) return;
    if (t.closest('[data-hz-menu-close]') || t.closest('[data-hz-scrim]')) { e.preventDefault(); closeMenu(); return; }
    // Selecting a destination closes the sheet; focus follows the navigation,
    // so it is not pulled back to the button that is about to disappear.
    if (t.closest('#hz-menu a[href]')) closeMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (!open) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeMenu(); return; }
    if (e.key !== 'Tab') return;
    var f = focusable();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !panel().contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });
  // A phone rotated to landscape, or a window dragged wider, must not leave the
  // sheet open over a desktop layout whose menu button is no longer rendered.
  addEventListener('resize', function () { if (open && innerWidth > 640) closeMenu(false); });
})();
</script>"""


# (N-1) The home bar gets the menu button. It is plain markup with no runtime
# binding, so the delegated controller in NAV_JS keeps working across a React
# re-render, and the button is the only header control left below 641px.
old = 'style-active="transform:translateY(1px)">JOIN THE WAITLIST</a>'
assert html.count(old) == 1, "nav CTA not found"
html = html.replace(old, old + "\n    " + MENU_BUTTON)

# ---- 2f. App Store launch switch (2026-09-25, founder decision) ----
# ONE constant flips the home page, and the shared mobile drawer on every
# page, from "join the waitlist" to "download on the App Store". Empty
# (default) leaves every existing waitlist piece exactly as it renders today:
# each patch below has its own untouched default branch. Set APP_STORE_URL to
# the live App Store listing and: the nav CTA, the hero button, the closing
# CTA and the drawer's own link (2e above) all become "Download app" links,
# with the Apple mark below, to that URL; the five interest plates go inert
# (no click handler, no button role, no aria-label); and the waitlist form
# survives as a relocated, retitled Android fallback at the bottom of the
# page. See README.md, "App Store launch switch", for the day-of-approval
# steps.
#
# This is the one value to change on launch day: it feeds the Component
# class field directly (AS-5 below) and drawer() reads it too, so both
# surfaces flip together from this single assignment.
APP_STORE_URL = ""

# The known App Store listing URL, independent of the switch above: CSS can't
# read a JS/Python constant, so HOME_NAV_CSS (below) matches this literal
# directly to pre-hide the nav's live link on mobile, whether or not the
# switch is on yet. Change it only if the listing URL itself ever changes,
# and keep it equal to APP_STORE_URL's own value once that goes live.
APP_STORE_URL_LITERAL = "https://apps.apple.com/app/id6802558635"

# Single-path Apple logo mark for the three App Store buttons and the
# drawer's own link, once APP_STORE_URL is live. No external asset: fill is
# currentColor, so it always matches its own link's text colour with no
# colour of its own, and vertically centred by their flex styling. A function
# rather than a constant because the nav link (smaller text) and the hero/
# closing-CTA/drawer links (larger text) each need a different fixed pixel
# size (2026-09-25 founder feedback: the original 0.8em read as "super tiny"
# at ~10px, so this is sized in px against each button's actual rendered
# size instead of scaling off font-size again) - the viewBox keeps the glyph
# itself proportioned, so only width/height change per call site.
def apple_mark(px: int) -> str:
    return (f'<svg aria-hidden="true" viewBox="0 0 384 512" width="{px}px" height="{px}px" '
            'style="flex:0 0 auto" xmlns="http://www.w3.org/2000/svg">'
            '<path fill="currentColor" d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>')

# Below 641px the bar is logo + menu button: the three section anchors were
# already hidden by (I-4b), and the CTA moves into the sheet. The second
# selector is the App Store switch above: CSS can't read the JS field, so it
# matches the literal URL directly.
HOME_NAV_CSS = ('@media (max-width:640px){#hz-nav a[href="#waitlist"],'
                 f'#hz-nav a[href="{APP_STORE_URL_LITERAL}"]'
                 '{display:none !important}}\n')

# (AS-1) Nav CTA: the default anchor is left completely untouched in its own
# branch; a second branch swaps in the App Store link with identical font,
# colour and size, plus a pill radius, the Apple mark, and a small icon-text
# gap.
old = ('<a href="#waitlist" style="font: 700 11px \'Figtree\',Arial,Helvetica,sans-serif; letter-spacing: .12em; '
       'color: #F3EFE7; background: #C24E1F; padding: 11px 18px; text-decoration: none; '
       'font-family:\'Figtree\',Arial,Helvetica,sans-serif" style-hover="background:#16130E;color:#F3EFE7" '
       'style-active="transform:translateY(1px)">JOIN THE WAITLIST</a>')
assert html.count(old) == 1, "home nav CTA not found"
nav_appstore = (old
    .replace('href="#waitlist"', 'href="{{ appStoreUrl }}"')
    .replace('style="font: 700 11px',
             'style="display:inline-flex;align-items:center;gap:10px;border-radius:999px;font: 700 11px')
    .replace('>JOIN THE WAITLIST<', '>' + apple_mark(15) + '<span>{{ appStoreLabel }}</span><'))
html = html.replace(old,
    '<sc-if value="{{ !appStoreMode }}" hint-placeholder-val="{{ true }}">' + old + '</sc-if>'
    '<sc-if value="{{ appStoreMode }}" hint-placeholder-val="{{ false }}">' + nav_appstore + '</sc-if>')

# (AS-2) Hero CTA: default form/confirmation/"no spam" note is left untouched
# in its own branch; a second branch renders one App Store link in their
# place. #waitlist itself only exists in the default branch: the id moves to
# the relocated section below once appStoreMode is on, so it is never
# duplicated in the live DOM.
old = ('<div id="waitlist" style="animation:hzRise .7s ease .74s both;scroll-margin-top:110px">\n        <sc-if value="{{ heroIdle }}" hint-placeholder-val="{{ true }}">\n          <form onSubmit="{{ submitHero }}" style="display:flex;flex-wrap:wrap;gap:10px;max-width:520px">\n            <input type="email" required="" aria-label="Email address" placeholder="you@email.com" style="flex: 1 1 220px; padding: 15px 16px; border: 1.5px solid #16130E; background: transparent; font: 500 14px \'Figtree\',Arial,Helvetica,sans-serif; color: #16130E; outline: none; border-radius: 0; font-family:\'Figtree\',Arial,Helvetica,sans-serif; transition: border-color .25s ease" style-focus="border-color:#C24E1F">\n            <button type="submit" disabled="{{ busy1 }}" style="padding: 15px 24px; background: #C24E1F; border: 1.5px solid #C24E1F; color: #F3EFE7; font: 700 12px \'Figtree\',Arial,Helvetica,sans-serif; letter-spacing: .12em; cursor: pointer; border-radius: 0; font-family:\'Figtree\',Arial,Helvetica,sans-serif; transition: background .25s ease, border-color .25s ease, transform .12s ease" style-hover="background:#16130E;border-color:#16130E" style-active="transform:translateY(2px)">{{ heroBtn }}</button>\n            <sc-if value="{{ err1 }}"><div style="flex:1 1 100%;font:600 11.5px \'Figtree\',Arial,Helvetica,sans-serif;letter-spacing:.04em;color:#C24E1F">{{ err1 }}</div></sc-if>\n          </form>\n        </sc-if>\n        <sc-if value="{{ sub1 }}" hint-placeholder-val="{{ false }}">\n          <div style="display:inline-block;border:2px solid #C24E1F;color:#C24E1F;padding:15px 22px;font:700 12px \'Figtree\',Arial,Helvetica,sans-serif;letter-spacing:.1em;animation:hzStamp .55s cubic-bezier(.2,1.6,.4,1) both">YOU\'RE IN. WE\'LL EMAIL YOU WHEN WE LAUNCH.</div>\n        </sc-if>\n      </div>\n      <div style="margin-top: 20px; font: 500 11px \'Figtree\',Arial,Helvetica,sans-serif; letter-spacing: .1em; color: #6E6759; animation: hzRise .7s ease .84s both; font-family:\'Figtree\',Arial,Helvetica,sans-serif">NO SPAM. ONE EMAIL WHEN WE LAUNCH.</div>')
assert html.count(old) == 1, "hero waitlist block not found"
hero_appstore = (
    '<div style="animation:hzRise .7s ease .74s both">\n'
    '        <a href="{{ appStoreUrl }}" style="display:inline-flex;align-items:center;justify-content:center;'
    'gap:10px;padding: 15px 24px; background: #C24E1F; border: 1.5px solid #C24E1F; color: #F3EFE7; '
    'font: 700 12px \'Figtree\',Arial,Helvetica,sans-serif; letter-spacing: .12em; text-decoration: none; '
    'border-radius: 999px; font-family:\'Figtree\',Arial,Helvetica,sans-serif; transition: background .25s ease, '
    'border-color .25s ease, transform .12s ease" style-hover="background:#16130E;border-color:#16130E" '
    'style-active="transform:translateY(2px)">' + apple_mark(18) + '<span>{{ appStoreLabel }}</span></a>\n'
    '      </div>'
)
html = html.replace(old,
    '<sc-if value="{{ !appStoreMode }}" hint-placeholder-val="{{ true }}">' + old + '</sc-if>\n'
    '      <sc-if value="{{ appStoreMode }}" hint-placeholder-val="{{ false }}">' + hero_appstore + '</sc-if>')

# (AS-3) Closing CTA: id="fin-form" stays put in both branches, since the
# scroll-reveal animation (componentDidMount's finBits) targets it by id
# regardless of mode. Only the content inside it swaps.
fin_open = '<div id="fin-form" style="opacity:0;transform:translateY(20px)">'
fin_close = '</div>'
old = (fin_open + '\n          <sc-if value="{{ interest }}"><div style="display:inline-flex;align-items:center;gap:9px;margin-bottom:14px;padding:6px 8px 6px 12px;border:1px solid rgba(194,78,31,.45);border-radius:20px;font:700 9.5px \'Figtree\',Arial,Helvetica,sans-serif;letter-spacing:.14em;color:#C24E1F;text-transform:uppercase">Joining for: {{ interest }}<button type="button" onClick="{{ clearInterest }}" aria-label="Remove this interest" style="width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:0;border-radius:50%;background:rgba(194,78,31,.12);color:#C24E1F;font:400 11px \'Figtree\',Arial,Helvetica,sans-serif;cursor:pointer;padding:0" style-hover="background:#C24E1F;color:#F3EFE7">&#10005;</button></div></sc-if>\n          <sc-if value="{{ finalIdle }}" hint-placeholder-val="{{ true }}">\n            <form onSubmit="{{ submitFinal }}" style="display:flex;flex-wrap:wrap;gap:10px;max-width:520px">\n              <input type="email" required="" aria-label="Email address" placeholder="you@email.com" style="flex:1 1 220px;padding:17px 18px;border:1px solid rgba(22,19,14,.28);border-radius:14px;background:rgba(255,255,255,.6);font:500 15px \'Figtree\',Arial,Helvetica,sans-serif;color:#16130E;outline:none" style-focus="border-color:#C24E1F">\n              <button type="submit" disabled="{{ busy2 }}" style="padding:17px 28px;background:#C24E1F;border:1px solid #C24E1F;border-radius:14px;color:#F3EFE7;font:700 12.5px \'Figtree\',Arial,Helvetica,sans-serif;letter-spacing:.12em;cursor:pointer;box-shadow:0 18px 30px -22px rgba(194,78,31,.9);transition:background .3s ease,border-color .3s ease,transform .15s ease" style-hover="background:#16130E;border-color:#16130E" style-active="transform:translateY(2px)">{{ finalBtn }}</button>\n              <sc-if value="{{ err2 }}"><div style="flex:1 1 100%;font:600 11.5px \'Figtree\',Arial,Helvetica,sans-serif;letter-spacing:.04em;color:#C24E1F">{{ err2 }}</div></sc-if>\n            </form>\n          </sc-if>\n          <sc-if value="{{ sub2 }}" hint-placeholder-val="{{ false }}">\n            <div style="display:inline-block;border:2px solid #C24E1F;border-radius:14px;color:#C24E1F;padding:17px 24px;font:700 clamp(13px,1.4vw,17px) \'Figtree\',Arial,Helvetica,sans-serif;letter-spacing:.04em;animation:hzStamp .55s cubic-bezier(.2,1.6,.4,1) both">YOU\'RE IN.</div>\n          </sc-if>\n          <div style="margin-top:16px;font:500 10.5px \'Figtree\',Arial,Helvetica,sans-serif;letter-spacing:.12em;color:#6E6759">NO SPAM · ONE EMAIL WHEN WE LAUNCH</div>\n        </div>')
assert html.count(old) == 1, "closing CTA fin-form block not found"
assert old.startswith(fin_open) and old.endswith(fin_close)
fin_inner_default = old[len(fin_open):-len(fin_close)]
fin_appstore = (
    '\n          <a href="{{ appStoreUrl }}" style="display:inline-flex;align-items:center;justify-content:center;'
    'gap:10px;padding:17px 28px;background:#C24E1F;border:1px solid #C24E1F;border-radius:999px;color:#F3EFE7;'
    'font:700 12.5px \'Figtree\',Arial,Helvetica,sans-serif;letter-spacing:.12em;text-decoration:none;'
    'box-shadow:0 18px 30px -22px rgba(194,78,31,.9);transition:background .3s ease,border-color .3s ease,'
    'transform .15s ease" style-hover="background:#16130E;border-color:#16130E" '
    'style-active="transform:translateY(2px)">' + apple_mark(18) + '<span>{{ appStoreLabel }}</span></a>\n        '
)
html = html.replace(old,
    fin_open
    + '<sc-if value="{{ !appStoreMode }}" hint-placeholder-val="{{ true }}">' + fin_inner_default + '</sc-if>'
    + '<sc-if value="{{ appStoreMode }}" hint-placeholder-val="{{ false }}">' + fin_appstore + '</sc-if>'
    + fin_close)

# (AS-4) New section: the waitlist survives here, relocated and retitled for
# Android, once the App Store link is live. Reuses the hero's own form
# state/handler (heroIdle/sub1/err1/busy1/submitHero): the two are mutually
# exclusive, since the hero is a plain link whenever this section renders,
# rather than adding a second, redundant set of fields.
old = '</section>\n\n<footer data-screen-label="Footer"'
assert html.count(old) == 1, "footer anchor not found"
android_section = '''<sc-if value="{{ appStoreMode }}" hint-placeholder-val="{{ false }}"><section id="waitlist" data-screen-label="Android Waitlist" style="position:relative;border-top:1px solid rgba(22,19,14,.16);padding:clamp(40px,6vh,64px) clamp(20px,5vw,64px);scroll-margin-top:110px">
  <div style="max-width:1220px;margin:0 auto">
    <h2 style="margin:0 0 18px;font:600 clamp(22px,2.6vw,32px)/1.2 'Playfair Display','Times New Roman',serif;letter-spacing:-.012em;text-wrap:balance">Not on iPhone? Get notified for Android<span style="color:#C24E1F">.</span></h2>
    <sc-if value="{{ heroIdle }}" hint-placeholder-val="{{ true }}">
      <form onSubmit="{{ submitHero }}" style="display:flex;flex-wrap:wrap;gap:10px;max-width:520px">
        <input type="email" required="" aria-label="Email address" placeholder="you@email.com" style="flex: 1 1 220px; padding: 15px 16px; border: 1.5px solid #16130E; background: transparent; font: 500 14px 'Figtree',Arial,Helvetica,sans-serif; color: #16130E; outline: none; border-radius: 0; font-family:'Figtree',Arial,Helvetica,sans-serif; transition: border-color .25s ease" style-focus="border-color:#C24E1F">
        <button type="submit" disabled="{{ busy1 }}" style="padding: 15px 24px; background: #C24E1F; border: 1.5px solid #C24E1F; color: #F3EFE7; font: 700 12px 'Figtree',Arial,Helvetica,sans-serif; letter-spacing: .12em; cursor: pointer; border-radius: 0; font-family:'Figtree',Arial,Helvetica,sans-serif; transition: background .25s ease, border-color .25s ease, transform .12s ease" style-hover="background:#16130E;border-color:#16130E" style-active="transform:translateY(2px)">{{ notifyBtn }}</button>
        <sc-if value="{{ err1 }}"><div style="flex:1 1 100%;font:600 11.5px 'Figtree',Arial,Helvetica,sans-serif;letter-spacing:.04em;color:#C24E1F">{{ err1 }}</div></sc-if>
      </form>
    </sc-if>
    <sc-if value="{{ sub1 }}" hint-placeholder-val="{{ false }}">
      <div style="display:inline-block;border:2px solid #C24E1F;color:#C24E1F;padding:15px 22px;font:700 12px 'Figtree',Arial,Helvetica,sans-serif;letter-spacing:.1em;animation:hzStamp .55s cubic-bezier(.2,1.6,.4,1) both">YOU'RE IN. WE'LL EMAIL YOU WHEN WE LAUNCH.</div>
    </sc-if>
    <div style="margin-top: 20px; font: 500 11px 'Figtree',Arial,Helvetica,sans-serif; letter-spacing: .1em; color: #6E6759; font-family:'Figtree',Arial,Helvetica,sans-serif">NO SPAM. ONE EMAIL WHEN WE LAUNCH.</div>
  </div>
</section></sc-if>

'''
html = html.replace(old, '</section>\n\n' + android_section + '<footer data-screen-label="Footer"')

# (AS-5) Component class: the launch-switch constant itself, alongside
# WAITLIST_ENDPOINT/WAITLIST_HONEYPOT so all three "flip this to go live"
# knobs live in one place. Its default is generated straight from the
# module-level APP_STORE_URL above, so that one Python constant is the real
# switch and this field is just its compiled-in copy, not a second place to
# edit.
old = "WAITLIST_HONEYPOT = 'b_b7144d02c740628b3280ff55f_3ee28a30af';\n  emailOk(v)"
assert html.count(old) == 1, "honeypot field not found"
html = html.replace(old,
    "WAITLIST_HONEYPOT = 'b_b7144d02c740628b3280ff55f_3ee28a30af';\n"
    "  // App Store launch switch, generated from APP_STORE_URL in\n"
    "  // build/assemble.py. Empty = default site (waitlist everywhere, as\n"
    "  // today); set to flip the nav, hero, closing CTA and mobile drawer to\n"
    "  // App Store links; the Android waitlist survives, relocated to the\n"
    "  // bottom of the page. Kept in sync with HOME_NAV_CSS's mobile\n"
    "  // nav-hide rule (build/assemble.py), which cannot read this constant\n"
    "  // at runtime.\n"
    f"  APP_STORE_URL = '{APP_STORE_URL}';\n"
    "  emailOk(v)")

# (AS-6) Component class: pick0..pick4/pickkey0..pickkey4 become launch-switch
# aware in place (same keys, no duplicate object-literal entries) so the five
# plates lose their handlers, and, via plateRole/plateTabIndex/pickAria<i>
# below, their button semantics, the instant the switch is on.
old = "pick0: this._picks[0], pick1: this._picks[1], pick2: this._picks[2], pick3: this._picks[3], pick4: this._picks[4],\n      pickkey0: this._pickKeys[0], pickkey1: this._pickKeys[1], pickkey2: this._pickKeys[2], pickkey3: this._pickKeys[3], pickkey4: this._pickKeys[4],"
assert html.count(old) == 1, "pick0..pickkey4 fields not found"
html = html.replace(old,
    "pick0: appStoreMode ? undefined : this._picks[0], pick1: appStoreMode ? undefined : this._picks[1], "
    "pick2: appStoreMode ? undefined : this._picks[2], pick3: appStoreMode ? undefined : this._picks[3], "
    "pick4: appStoreMode ? undefined : this._picks[4],\n"
    "      pickkey0: appStoreMode ? undefined : this._pickKeys[0], pickkey1: appStoreMode ? undefined : this._pickKeys[1], "
    "pickkey2: appStoreMode ? undefined : this._pickKeys[2], pickkey3: appStoreMode ? undefined : this._pickKeys[3], "
    "pickkey4: appStoreMode ? undefined : this._pickKeys[4],")

# (AS-7) Component class: appStoreMode is computed once per render, right
# before the values it gates are assembled.
old = "    }\n    return {"
assert html.count(old) == 1, "renderVals return statement not found"
html = html.replace(old, "    }\n    const appStoreMode = !!this.APP_STORE_URL;\n    return {")

# (AS-8) Component class: the remaining launch-switch values: the two link
# labels, the plates' now-conditional role/tabIndex/aria-label, and the
# relocated form's own button text.
old = "heroBtn: this.state.busy1 ? 'JOINING…' : 'JOIN THE WAITLIST',\n      finalBtn: this.state.busy2 ? 'JOINING…' : 'JOIN THE WAITLIST'"
assert html.count(old) == 1, "renderVals heroBtn/finalBtn tail not found"
html = html.replace(old, old + """,
      appStoreMode: appStoreMode, appStoreUrl: this.APP_STORE_URL, appStoreLabel: 'Download app',
      notifyBtn: this.state.busy1 ? 'JOINING…' : 'NOTIFY ME',
      plateRole: appStoreMode ? undefined : 'button', plateTabIndex: appStoreMode ? undefined : '0',
      pickAria0: appStoreMode ? undefined : 'Join the waitlist: interested in Apply to jobs',
      pickAria1: appStoreMode ? undefined : 'Join the waitlist: interested in Post content',
      pickAria2: appStoreMode ? undefined : 'Join the waitlist: interested in Read books',
      pickAria3: appStoreMode ? undefined : 'Join the waitlist: interested in Stay fit',
      pickAria4: appStoreMode ? undefined : 'Join the waitlist: interested in Live stream'""")

# ---- 2g. Content-page + blog App Store launch switch (2026-09-25, founder
# follow-up) ----
# 2f only covered index.html. how-it-works, faq, about, contact,
# accountability-challenges, the blog hub and both articles each carry their
# own copy of the same desktop nav pill and closing CTA block, byte-identical
# across build/content-page.html, build/article-page.html and
# build/blog-index.html (some also carry a waitlist sentence inside the
# page's own copy, handled per page in section 6 below, near the
# build/pages/*.json loop). None of this is reactive like index.html's
# Component: these are plain static pages, so the switch applies once, at
# Python build time, from the same APP_STORE_URL constant, the same way
# drawer()'s own app_store branch (2e above) already does.
NAV_PILL_OLD = ('<a data-hz-desknav href="/#waitlist" style="font:700 11px \'Figtree\',Arial,Helvetica,sans-serif;'
                 'letter-spacing:.12em;color:#F3EFE7;background:#C24E1F;padding:11px 18px;text-decoration:none;'
                 'white-space:nowrap">JOIN THE WAITLIST</a>')
NAV_PILL_LIVE = (f'<a data-hz-desknav href="{APP_STORE_URL}" style="display:inline-flex;align-items:center;'
                  'gap:10px;border-radius:999px;font:700 11px \'Figtree\',Arial,Helvetica,sans-serif;'
                  'letter-spacing:.12em;color:#F3EFE7;background:#C24E1F;padding:11px 18px;text-decoration:none;'
                  f'white-space:nowrap">{apple_mark(15)}<span>Download app</span></a>')

# The heading's own margin-bottom grows in the live variant since the
# supporting waitlist paragraph is dropped entirely (matching index.html's
# own hero/closing CTA, which drop their "NO SPAM" note once live) rather
# than rewritten: once the app is out, there is nothing left to explain.
CLOSING_BLOCK_OLD = (
    '<div style="font:600 clamp(20px,2.4vw,27px)/1.25 \'Playfair Display\',\'Times New Roman\',serif;'
    'letter-spacing:-.012em;color:#16130E;margin-bottom:8px">Ready when you are'
    '<span style="color:#C24E1F">.</span></div>\n'
    '    <p style="margin:0 0 16px;font:400 15px/1.65 \'Figtree\',Arial,Helvetica,sans-serif;'
    'color:#4A453C">Join the waitlist and we\'ll email you when the first Hunts open.</p>\n'
    '    <a href="/#waitlist" style="display:inline-block;font:700 12px \'Figtree\',Arial,'
    'Helvetica,sans-serif;letter-spacing:.12em;color:#F3EFE7;background:#C24E1F;padding:14px 22px;'
    'text-decoration:none">JOIN THE WAITLIST &#8594;</a>'
)
CLOSING_BLOCK_LIVE = (
    # Founder review 2026-09-25: heading on the left, the store button on the
    # right of the same row (space-between), vertically centred. flex-wrap lets
    # a phone-width card stack the button under the text with no media query,
    # matching the inline-style-only convention of the rest of the shell.
    '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;'
    'gap:18px 28px">\n'
    '      <div style="flex:1 1 300px">\n'
    '        <div style="font:600 clamp(20px,2.4vw,27px)/1.25 \'Playfair Display\',\'Times New Roman\',serif;'
    'letter-spacing:-.012em;color:#16130E">Huntz is on the App Store'
    '<span style="color:#C24E1F">.</span></div>\n'
    '        <div style="margin-top:14px"><a href="/#waitlist" style="font:600 11px \'Figtree\','
    'Arial,Helvetica,sans-serif;letter-spacing:.06em;color:#6E6759;text-decoration:underline">'
    'Not on iPhone? Get notified for Android.</a></div>\n'
    '      </div>\n'
    f'      <a href="{APP_STORE_URL}" style="display:inline-flex;align-items:center;gap:10px;flex:0 0 auto;'
    'border-radius:999px;font:700 12px \'Figtree\',Arial,Helvetica,sans-serif;letter-spacing:.12em;'
    f'color:#F3EFE7;background:#C24E1F;padding:14px 22px;text-decoration:none">{apple_mark(18)}'
    '<span>Download app</span></a>\n'
    '    </div>'
)

def apply_content_app_store_switch(tpl: str) -> str:
    """Applies the nav-pill/closing-block half of the launch switch to a page
    shell's raw template text. The two assertions run unconditionally, so an
    upstream template edit is still caught while APP_STORE_URL is empty and
    this function is otherwise a no-op; the replacement itself only happens
    once the switch is actually on."""
    assert tpl.count(NAV_PILL_OLD) == 1, "desktop nav pill not found"
    assert tpl.count(CLOSING_BLOCK_OLD) == 1, "closing CTA block not found"
    if APP_STORE_URL:
        tpl = tpl.replace(NAV_PILL_OLD, NAV_PILL_LIVE).replace(CLOSING_BLOCK_OLD, CLOSING_BLOCK_LIVE)
    return tpl

# ---- 3. inline React + ReactDOM + support.js (replaces the src include) ----
def js_escape(src: str) -> str:
    # keep inline <script> content safe; \/ == / inside JS strings/regexes
    return src.replace("</script", "<\\/script").replace("<!--", "<\\!--")

# Two single-file adaptations of the runtime (everything else is verbatim):
# 1. boot() re-fetches location.href and re-parses the raw source for the first
#    "<x-dc" — with support.js inlined, its own error-string "has no <x-dc> block"
#    appears before the real template and would be adopted as the template.
#    window.__resources = {} makes boot() treat the page as pre-bundled and skip
#    that re-fetch (the DOM template it already adopted is identical).
# 2. Split the literal "<x-dc>" inside that error string so no raw-source scan
#    (now or in any future re-parse path) can mistake it for the template tag.
support = support.replace(
    '"has no <x-dc> block \\u2014 not a Design Component."',
    '"has no <x-" + "dc> block \\u2014 not a Design Component."',
)
assert '"has no <x-' in support

inline_scripts = (
    "<script>window.__resources = {};/* single-file build: template + logic are inline, no sibling fetches */</script>\n"
    "<script>/* react@18.3.1 umd (sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z) */\n"
    + js_escape(react) + "</script>\n"
    "<script>/* react-dom@18.3.1 umd (sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1) */\n"
    + js_escape(react_dom) + "</script>\n"
    "<script>/* dc-runtime support.js (verbatim from the Claude Design export, two single-file tweaks noted above) */\n"
    + js_escape(support) + "</script>"
)
assert '<script src="./support.js"></script>' in html
html = html.replace('<script src="./support.js"></script>', "<!--HZ:SCRIPTS-->")

# One concatenated, content-hashed file for the home page: execution order
# (React, ReactDOM, the __resources flag, the runtime) is preserved inside it.
app_js = (
    "/* react@18.3.1 + react-dom@18.3.1 UMD + Claude Design dc-runtime.\n"
    "   Generated by build/assemble.py — do not edit. */\n"
    + react + "\n;\n" + react_dom + "\n;\n"
    + "window.__resources = {};/* single-file build: template + logic are inline, no sibling fetches */\n"
    + support
)

# ---- 4. shared assets: hashed, immutable-cacheable ----
import hashlib
import json

ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

def write_hashed(stem: str, ext: str, content: str) -> str:
    """Write assets/<stem>.<hash8>.<ext>, prune stale siblings, return the path."""
    digest = hashlib.sha256(content.encode()).hexdigest()[:8]
    name = f"{stem}.{digest}.{ext}"
    for old in ASSETS.glob(f"{stem}.????????.{ext}"):
        if old.name != name:
            old.unlink()
    (ASSETS / name).write_text(content)
    return f"/assets/{name}"

fonts_css_out = ("/* Playfair Display + Figtree, latin subset, embedded. Generated by "
                 "build/assemble.py — do not edit. */\n" + "\n".join(kept) + "\n")
FONTS_HREF = write_hashed("fonts", "css", fonts_css_out)
APP_HREF = write_hashed("app", "js", app_js)
# Kept for any cached copy of the earlier legal pages that still links it.
(ASSETS / "fonts.css").write_text(fonts_css_out)

# ---- 4b. head metadata, icons, structured data ----
# Stable root URLs, generated by build/icons.py from the brand mark. Root paths
# rather than hashed ones: a favicon is cached hard by browsers and referenced by
# crawlers, so the address has to stay put across deployments.
ICON_LINKS = """<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="/favicon-48x48.png" type="image/png" sizes="48x48">
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
<link rel="icon" href="/icon-512.png" type="image/png" sizes="512x512">
<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">"""

# Facts only: name, entity, address (already public in the legal pages), contact.
ORG_LD = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Huntz",
    "legalName": "Huntz, Inc.",
    "url": SITE_URL + "/",
    "logo": SITE_URL + "/icon-512.png",
    "email": "team@huntz.ai",
    "address": {"@type": "PostalAddress", "streetAddress": "269 24th Street",
                "addressLocality": "Oakland", "addressRegion": "CA",
                "postalCode": "94612", "addressCountry": "US"},
}
SITE_LD = {"@context": "https://schema.org", "@type": "WebSite",
           "name": "Huntz", "url": SITE_URL + "/"}

def ld(obj) -> str:
    return '<script type="application/ld+json">' + json.dumps(obj, separators=(",", ":")) + "</script>"

def breadcrumb_ld(title: str, slug: str) -> str:
    return ld({"@context": "https://schema.org", "@type": "BreadcrumbList",
               "itemListElement": [
                   {"@type": "ListItem", "position": 1, "name": "Huntz", "item": SITE_URL + "/"},
                   {"@type": "ListItem", "position": 2, "name": title, "item": f"{SITE_URL}/{slug}"}]})

# Search metadata leads with the category (per the approved SEO plan); the
# social card keeps the brand line, which the visible hero also carries, so
# metadata and visible copy agree in both places.
HEAD_META = f"""<title>Huntz | Accountability Challenges for Goals That Matter</title>
<meta name="description" content="Join structured accountability challenges, follow clear rules, submit progress, and build consistency with friends and communities. Huntz is currently in pre-launch.">
<link rel="canonical" href="{SITE_URL}/">
<meta property="og:site_name" content="Huntz">
<meta property="og:title" content="Huntz · Put your money where your goals are.">
<meta property="og:description" content="Stake $50–$500 on your own goal. Post proof daily. Finish and get 100% back, plus a share of the stakes forfeited by everyone who quit.">
<meta property="og:type" content="website">
<meta property="og:url" content="{SITE_URL}/">
<meta property="og:image" content="{SITE_URL}/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Huntz · Put your money where your goals are.">
<meta name="twitter:description" content="Stake $50–$500 on your own goal. Post proof daily. Finish and get 100% back.">
<meta name="twitter:image" content="{SITE_URL}/og-image.jpg">
<meta name="apple-itunes-app" content="app-id=6802558635">
{ICON_LINKS}
<link rel="preload" href="{FONTS_HREF}" as="style">
<link rel="stylesheet" href="{FONTS_HREF}">
{ld(ORG_LD)}
{ld(SITE_LD)}
<script>if(/^#\/(terms|privacy)$/.test(location.hash))location.replace(location.hash.slice(2));else if(location.hash==="#challenges")location.replace("/accountability-challenges");</script>
<style>{NAV_CSS}{HOME_NAV_CSS}</style>"""

# ---- 4c. the two variants ----
assert html.count("<!--HZ:FONTS-->") == 1 and html.count("<!--HZ:SCRIPTS-->") == 1
html = html.replace("<html>", '<html lang="en">', 1)

home = html.replace("<!--HZ:FONTS-->", "")
home = home.replace("<!--HZ:SCRIPTS-->", f'<script src="{APP_HREF}" defer></script>')
home = home.replace('<head>\n<meta charset="utf-8">',
                    '<head>\n<meta charset="utf-8">\n' + HEAD_META, 1)
assert "HZ:" not in home
# Every JOIN THE WAITLIST button targets the one existing form: on-page clicks
# scroll to it and put the caret in the email field; /#waitlist arrivals from
# other pages do the same once the runtime has rendered the form.
FOCUS_JS = """<script>
(function () {
  // Native smooth scrolling does not run on this page at all: the design
  // runtime's 60fps loop cancels it, which is why html{scroll-behavior:smooth}
  // had to be removed. A hand-rolled tween is not cancelled, so the waitlist
  // reveal animates instead of teleporting.
  function glideTo(y) {
    var max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    y = Math.max(0, Math.min(max, y));
    var from = pageYOffset, d = y - from, t0 = 0;
    if (Math.abs(d) < 2) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { scrollTo(0, y); return; }
    requestAnimationFrame(function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / 420);
      scrollTo(0, from + d * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    });
  }
  function focusWaitlist() {
    var w = document.getElementById('waitlist');
    if (!w) return;
    var r = w.getBoundingClientRect();
    glideTo(r.top + pageYOffset - Math.max(72, (innerHeight - r.height) / 2));
    // preventScroll so the caret landing in the field does not fight the tween.
    var i = w.querySelector('input');
    if (i) i.focus({ preventScroll: true });
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href=\"#waitlist\"]');
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, '', '#waitlist');
    focusWaitlist();
  });
  if (location.hash === '#waitlist') {
    window.addEventListener('load', function () { setTimeout(focusWaitlist, 350); });
  }
})();
</script>"""
home = home.replace("</body>", drawer("/", "#waitlist") + "\n" + NAV_JS + "\n" + FOCUS_JS + "\n</body>")
(ROOT / "index.html").write_text(home)

art = html.replace("<!--HZ:FONTS-->", font_style)
art = art.replace("<!--HZ:SCRIPTS-->", "")
art = art.replace("</body>", legal + "\n</body>")
m = re.search(r"<body>\n?(.*)\n?</body>", art, re.S)
fragment = (inline_scripts + "\n" + m.group(1) + "\n<style>" + NAV_CSS + HOME_NAV_CSS + "</style>\n"
            + drawer("/", "#waitlist") + "\n" + NAV_JS)
# The artifact is one file with no /terms to navigate to, so its footer keeps
# the in-page hash routes that the embedded overlay still serves.
for a, b in (('href="/terms"', 'href="#/terms"'), ('href="/privacy"', 'href="#/privacy"'),
             ('href="/faq"', 'href="#why"'), ('href="/how-it-works"', 'href="#mechanic"'),
             ('href="/about"', 'href="#top"'), ('href="/contact"', 'href="mailto:team@huntz.ai"'),
             ('href="/accountability-challenges"', 'href="#hunts"'),
             ('href="/"', 'href="#top"')):
    fragment = fragment.replace(a, b)
(BUILD / "huntz-landing.artifact.html").write_text(fragment)

# ---- 5. legal pages ----
page_tpl = (BUILD / "legal-page.html").read_text()
LEGAL_PAGES = [
    ("terms", "legal-terms.html", "Terms of Service",
     "The agreement governing Huntz: stakes, proof, verification, payouts, fees, and disputes.",
     "/privacy", "PRIVACY POLICY →"),
    ("privacy", "legal-privacy.html", "Privacy Policy",
     "How Huntz collects, uses, shares, retains, and protects your personal information.",
     "/terms", "TERMS OF SERVICE →"),
]
for slug, doc, title, desc, other_href, other_label in LEGAL_PAGES:
    page = (page_tpl
            .replace("{{TITLE}}", title)
            .replace("{{DESC}}", desc)
            .replace("{{CANONICAL}}", f"{SITE_URL}/{slug}")
            .replace("{{SITE}}", SITE_URL)
            .replace("{{ICONS}}", ICON_LINKS)
            .replace("{{FONTS_HREF}}", FONTS_HREF)
            .replace("{{BREADCRUMB_LD}}", breadcrumb_ld(title, slug))
            .replace("{{OTHER_HREF}}", other_href)
            .replace("{{OTHER_LABEL}}", other_label)
            .replace("{{BODY}}", (BUILD / doc).read_text()))
    assert "{{" not in page, f"unfilled placeholder in {slug}.html"
    (ROOT / f"{slug}.html").write_text(page)

# ---- 6. content pages (About, Contact, FAQ, How it works, hub) ----
# Copy lives in build/pages/<slug>.json as typed blocks; this renderer maps the
# blocks onto the site's type system so pages cannot drift stylistically.
BS = {
    "h2": f"margin:38px 0 12px;font:600 clamp(23px,2.5vw,30px)/1.2 {SERIF};letter-spacing:-.012em;color:{INK};text-wrap:balance",
    "h3": f"margin:26px 0 8px;font:700 13px {SANS};letter-spacing:.13em;text-transform:uppercase;color:{CLAY}",
    "p": f"margin:0 0 15px;font:400 15.5px/1.75 {SANS};color:{BODYC};text-wrap:pretty",
    "ul": f"margin:0 0 18px;padding-left:20px;display:flex;flex-direction:column;gap:7px;list-style:none",
    "li": f"position:relative;font:400 15.5px/1.7 {SANS};color:{BODYC};text-wrap:pretty",
    "note": (f"margin:26px 0 15px;padding:14px 18px;border-left:2px solid {CLAY};background:rgba(194,78,31,.05);"
             f"font:600 12px/1.8 {SANS};letter-spacing:.05em;text-transform:uppercase;color:{INK}"),
}

LINK_RE = re.compile(r"\{a:(https://[^|}]+|/[a-z0-9#/-]*|/#[a-z-]+)\|([^}]+)\}")

def H_ESCAPE(s: str) -> str:
    """Escape for both text and double-quoted attributes. Apostrophes are left
    alone: they are safe in either position and &#x27; only makes titles ugly."""
    import html as H
    return H.escape(str(s), quote=False).replace('"', "&quot;")

def render_text(s: str) -> str:
    import html as H
    s = H.escape(s, quote=False)
    s = s.replace("team@huntz.ai",
                  f'<a href="mailto:team@huntz.ai" style="color:{CLAY};text-decoration:none;'
                  f'border-bottom:1px solid rgba(194,78,31,.4)">team@huntz.ai</a>')
    def _link(m):
        href, label = m.group(1), m.group(2)
        style = f'color:{CLAY};text-decoration:none;border-bottom:1px solid rgba(194,78,31,.4)'
        if href.startswith("https://"):
            # Citations and competitor sources leave the site, so they open in a
            # new tab and cannot reach back through window.opener.
            return (f'<a href="{href}" target="_blank" rel="noopener noreferrer" '
                    f'style="{style}">{label}</a>')
        return f'<a href="{href}" style="{style}">{label}</a>'
    return LINK_RE.sub(_link, s)

def render_blocks(blocks) -> str:
    out = []
    for b in blocks:
        k = b["type"]
        if k in ("h2", "h3", "p", "note"):
            tag = {"h2": "h2", "h3": "h3", "p": "p", "note": "p"}[k]
            attr = f' id="{b["id"]}"' if b.get("id") else ""
            out.append(f'<{tag}{attr} style="{BS[k]}">{render_text(b.get("text", ""))}</{tag}>')
        elif k == "form":
            out.append(contact_form())
        elif k == "table":
            head = b["head"]
            ths = "".join(f"<th scope=\"col\">{render_text(h)}</th>" for h in head)
            trs = ""
            for row in b["rows"]:
                tds = "".join(
                    f'<td data-label="{H_ESCAPE(head[i])}">{render_text(c)}</td>'
                    for i, c in enumerate(row))
                trs += f"<tr>{tds}</tr>"
            cap = f"<caption>{render_text(b['caption'])}</caption>" if b.get("caption") else ""
            out.append(f'<div data-hz-tablewrap><table data-hz-table>{cap}'
                       f"<thead><tr>{ths}</tr></thead><tbody>{trs}</tbody></table></div>")
        elif k == "ul":
            items = "".join(
                f'<li style="{BS["li"]}"><span style="position:absolute;left:-20px;top:.62em;width:5px;height:5px;'
                f'border-radius:50%;background:{CLAY};opacity:.55"></span>{render_text(i)}</li>'
                for i in b.get("items", []))
            out.append(f'<ul style="{BS["ul"]}">{items}</ul>')
    return "\n".join(out)

# ---- 6b. the contact form (2026-08-13) ----
# Markup and behaviour for /contact. The endpoint that receives it lives in
# api/; the copy below is the founder's exact wording and is asserted by
# build/check.py so a later edit cannot quietly reword it.

CONTACT_INTRO = ("Questions, partnerships, press, or interested in creating a Hunt? "
                 "Send us a note.")
CONTACT_SUCCESS_TITLE = "Message sent."
CONTACT_SUCCESS = "Thanks\u2014your message reached the Huntz team."
CONTACT_AGAIN = "Send another message"
CONTACT_FAILURE = "Something went wrong. Please email team@huntz.ai."
CONTACT_PRIVACY = "We'll use your information only to respond to your message."
CONTACT_SUBMIT = "Send message"
# value -> visible label. The server holds the same list and builds the email
# Subject from it, so no visitor text ever reaches a mail header.
CONTACT_REASONS = [
    ("create-a-hunt", "I want to create a Hunt"),
    ("partnership", "Partnership"),
    ("press", "Press"),
    ("general-question", "General question"),
    ("website-issue", "Website issue"),
]

FORM_CSS = f"""
#hz-contact label{{ display:block; font:600 11px {SANS}; letter-spacing:.14em; text-transform:uppercase;
  color:{MUTED}; margin-bottom:7px }}
#hz-contact input,#hz-contact select,#hz-contact textarea{{ width:100%; box-sizing:border-box; min-height:48px;
  padding:12px 14px; border:1px solid rgba(22,19,14,.22); border-radius:0; background:rgba(255,255,255,.72);
  color:{INK}; font:400 15.5px/1.5 {SANS}; -webkit-appearance:none; appearance:none }}
#hz-contact textarea{{ min-height:150px; resize:vertical }}
#hz-contact select{{ background-image:linear-gradient(45deg,transparent 50%,{MUTED} 50%),
  linear-gradient(135deg,{MUTED} 50%,transparent 50%);
  background-position:calc(100% - 20px) 21px,calc(100% - 14px) 21px; background-size:6px 6px,6px 6px;
  background-repeat:no-repeat; padding-right:42px }}
#hz-contact input:focus-visible,#hz-contact select:focus-visible,#hz-contact textarea:focus-visible{{
  outline:2px solid {CLAY}; outline-offset:1px }}
#hz-contact [aria-invalid="true"]{{ border-color:{CLAY}; background:rgba(194,78,31,.05) }}
#hz-contact [data-hz-err]{{ margin:7px 0 0; font:600 12px/1.5 {SANS}; color:{CLAY} }}
#hz-contact button[disabled]{{ opacity:.6; cursor:progress }}
#hz-contact-status:empty{{ display:none }}
/* Never an inline display here: it would outrank [hidden] and leave the success
   panel rendering under the form on every page load. */
/* A compact card, not a reserved block: it stands in for the form and its
   heading, and the page is allowed to shorten around it. */
#hz-contact-done{{ display:flex; align-items:flex-start }}
#hzc-again:hover{{ border-color:{CLAY}; color:{CLAY} }}
#hz-contact-done[hidden]{{ display:none !important }}
#hz-contact-done-title:focus-visible{{ outline:2px solid {CLAY} }}
"""


def contact_form() -> str:
    # The success panel is rendered here, hidden, rather than assembled in
    # JavaScript: it stays in the page source, keeps the site's type system, and
    # build/check.py can assert its copy the same way it asserts the form's.
    fields = []

    def wrap(inner, fid, label):
        return (f'<div style="margin-bottom:20px">'
                f'<label for="{fid}">{label}</label>{inner}'
                f'<p id="{fid}-err" data-hz-err hidden></p></div>')

    fields.append(wrap(
        f'<input id="hzc-name" name="name" type="text" required maxlength="100" autocomplete="name" '
        f'aria-describedby="hzc-name-err">', "hzc-name", "Name"))
    fields.append(wrap(
        f'<input id="hzc-email" name="email" type="email" required maxlength="254" autocomplete="email" '
        f'inputmode="email" aria-describedby="hzc-email-err">', "hzc-email", "Email"))
    options = '<option value="">Choose one</option>' + "".join(
        f'<option value="{v}">{l}</option>' for v, l in CONTACT_REASONS)
    fields.append(wrap(
        f'<select id="hzc-reason" name="reason" required aria-describedby="hzc-reason-err">{options}</select>',
        "hzc-reason", "Reason"))
    fields.append(wrap(
        f'<textarea id="hzc-message" name="message" required maxlength="5000" rows="7" '
        f'aria-describedby="hzc-message-err"></textarea>', "hzc-message", "Message"))

    # Off-screen rather than display:none, which some form-fillers skip.
    honeypot = ('<div aria-hidden="true" style="position:absolute;width:1px;height:1px;overflow:hidden;'
                'clip:rect(0 0 0 0);white-space:nowrap">'
                '<label for="hzc-company">Company</label>'
                '<input id="hzc-company" name="company" type="text" tabindex="-1" autocomplete="off">'
                '</div>')

    return f"""<form id="hz-contact" novalidate style="margin:8px 0 10px">
  <p style="{BS['p']}">{CONTACT_INTRO}</p>
  {"".join(fields)}
  {honeypot}
  <button type="submit" id="hzc-submit" style="font:700 12px {SANS};letter-spacing:.12em;text-transform:uppercase;color:{CREAM};background:{CLAY};border:1px solid {CLAY};padding:15px 26px;cursor:pointer">{CONTACT_SUBMIT}</button>
  <p id="hz-contact-status" role="status" aria-live="polite" style="margin:18px 0 0;padding:13px 16px;border-left:2px solid {CLAY};background:rgba(194,78,31,.06);font:600 13.5px/1.6 {SANS};color:{INK}"></p>
  <p style="margin:16px 0 0;font:400 13px/1.6 {SANS};color:{MUTED}"><a href="/privacy" style="color:{MUTED};text-decoration:none;border-bottom:1px solid rgba(22,19,14,.2)">{CONTACT_PRIVACY}</a></p>
  <noscript><p style="{BS['p']}">This form needs JavaScript. Email team@huntz.ai instead and we will pick it up the same way.</p></noscript>
</form>
<div id="hz-contact-done" hidden role="status" style="margin:8px 0 10px;gap:15px;padding:clamp(20px,2.6vw,26px);border:1px solid rgba(22,19,14,.14);border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.34))">
  <span aria-hidden="true" style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:30px;height:30px;margin-top:2px;border-radius:50%;background:{DONE}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="{CREAM}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.2 5.2L20 7"></path></svg></span>
  <div style="min-width:0">
    <h2 id="hz-contact-done-title" tabindex="-1" style="margin:0 0 7px;font:600 clamp(20px,2.2vw,25px)/1.25 {SERIF};letter-spacing:-.012em;color:{INK};outline-offset:4px">{CONTACT_SUCCESS_TITLE}</h2>
    <p style="margin:0 0 17px;font:400 15px/1.6 {SANS};color:{BODYC};text-wrap:pretty">{CONTACT_SUCCESS}</p>
    <button type="button" id="hzc-again" style="padding:11px 18px;border:1px solid rgba(22,19,14,.26);border-radius:12px;background:transparent;font:700 11.5px {SANS};letter-spacing:.12em;text-transform:uppercase;color:{INK};cursor:pointer">{CONTACT_AGAIN}</button>
  </div>
</div>"""


CONTACT_JS = """<script>
(function () {
  var form = document.getElementById('hz-contact');
  if (!form) return;
  var status = document.getElementById('hz-contact-status');
  var submit = document.getElementById('hzc-submit');
  var SUBMIT_LABEL = submit.textContent;
  var heading = document.getElementById('hz-contact-heading');
  var done = document.getElementById('hz-contact-done');
  var doneTitle = document.getElementById('hz-contact-done-title');
  var again = document.getElementById('hzc-again');
  var FIELDS = ['name', 'email', 'reason', 'message'];
  var busy = false;

  function setError(name, msg) {
    var input = document.getElementById('hzc-' + name);
    var slot = document.getElementById('hzc-' + name + '-err');
    if (!input || !slot) return;
    if (msg) { input.setAttribute('aria-invalid', 'true'); slot.textContent = msg; slot.hidden = false; }
    else { input.removeAttribute('aria-invalid'); slot.textContent = ''; slot.hidden = true; }
  }
  function clearErrors() { FIELDS.forEach(function (f) { setError(f, null); }); }
  function say(msg) { status.textContent = msg; }

  var EMAIL = /^[^\s@,;<>()\[\]\\"]+@[^\s@,;<>()\[\]\\".]+\.[^\s@,;<>()\[\]\\"]{2,}$/;
  function localCheck(v) {
    var e = {};
    if (!v.name) e.name = 'Tell us your name.';
    if (!v.email) e.email = 'We need an email address to reply to.';
    else if (!EMAIL.test(v.email)) e.email = 'That email address does not look right.';
    if (!v.reason) e.reason = 'Pick a reason.';
    if (!v.message) e.message = 'Add a message.';
    return e;
  }
  function showErrors(e) {
    clearErrors();
    FIELDS.forEach(function (f) { if (e[f]) setError(f, e[f]); });
    var first = FIELDS.filter(function (f) { return e[f]; })[0];
    if (first) { var el = document.getElementById('hzc-' + first); if (el) el.focus(); }
  }
  function setBusy(on) {
    busy = on;
    submit.disabled = on;
    submit.textContent = on ? 'Sending' : SUBMIT_LABEL;
  }

  function showSuccess() {
    form.reset();
    clearErrors();
    say('');
    if (heading) heading.hidden = true;
    form.hidden = true;
    done.hidden = false;
    // Focus is what reliably announces the new state; role="status" covers
    // readers that would otherwise miss a revealed region.
    doneTitle.focus();
  }

  again.addEventListener('click', function () {
    done.hidden = true;
    if (heading) heading.hidden = false;
    form.hidden = false;
    form.reset();
    clearErrors();
    say('');
    var first = document.getElementById('hzc-name');
    if (first) first.focus();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;                       // no double send while one is in flight
    var v = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      reason: form.reason.value,
      message: form.message.value.trim(),
      company: form.company.value
    };
    var local = localCheck(v);
    if (Object.keys(local).length) { say(''); showErrors(local); return; }
    clearErrors();
    say('');
    setBusy(true);
    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(v)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; });
    }).then(function (o) {
      setBusy(false);
      if (o.r.ok && o.j.ok) { showSuccess(); return; }
      var err = (o.j && o.j.error) || {};
      if (err.fieldErrors && Object.keys(err.fieldErrors).length) { showErrors(err.fieldErrors); say(''); return; }
      // Values are left exactly as typed so nothing has to be retyped.
      say(FAILURE);
    }).catch(function () {
      setBusy(false);
      say(FAILURE);
    });
  });
})();
</script>"""

CONTACT_JS = CONTACT_JS.replace("FAILURE", "'" + CONTACT_FAILURE + "'")
assert "SUCCESS" not in CONTACT_JS, "success copy belongs in the markup, not the script"


content_tpl = apply_content_app_store_switch((BUILD / "content-page.html").read_text())

# Per-page in-copy waitlist sentences (build/pages/*.json), each rewritten by
# hand for its own paragraph rather than a single generic swap, since none of
# them read the same. "meta" covers the <meta name="description">/og:description
# pair (both filled from the same spec["meta_description"], so one substitution
# on the rendered text covers both); "body" covers rendered <p>/<li> fragments
# inside the page's own copy (matched post render_blocks(), i.e. as real HTML,
# not the {a:href|text} source syntax). A slug with no waitlist mention in its
# body, or none in its meta description, simply omits that key.
CONTENT_LIVE_COPY = {
    "about": {
        "meta": (
            "Huntz is the marketplace for accountability: stake-backed challenges with rules published up front. "
            "Built in Oakland by Huntz, Inc. Pre-launch, waitlist open.",
            "Huntz is the marketplace for accountability: stake-backed challenges with rules published up front. "
            "Built in Oakland by Huntz, Inc. Available now on the App Store.",
        ),
        "body": [(
            '<p style="margin:0 0 15px;font:400 15.5px/1.75 \'Figtree\',Arial,Helvetica,sans-serif;color:#4A453C;'
            'text-wrap:pretty">The first Hunts are being developed now, directly with selected creators for their '
            'communities. Self-service tools for creators to launch Hunts independently are planned for later. The '
            '<a href="/#waitlist" style="color:#C24E1F;text-decoration:none;border-bottom:1px solid '
            'rgba(194,78,31,.4)">waitlist</a> is the way in.</p>',
            '<p style="margin:0 0 15px;font:400 15.5px/1.75 \'Figtree\',Arial,Helvetica,sans-serif;color:#4A453C;'
            'text-wrap:pretty">The first Hunts are being developed now, directly with selected creators for their '
            'communities. Self-service tools for creators to launch Hunts independently are planned for later. The '
            f'<a href="{APP_STORE_URL}" style="color:#C24E1F;text-decoration:none;border-bottom:1px solid '
            'rgba(194,78,31,.4)">app</a> is the way in.</p>',
        )],
    },
    "accountability-challenges": {
        "meta": (
            "What accountability challenges are, what good rules look like, and how Huntz runs them with real "
            "stakes and published rules. Pre-launch; iOS waitlist open.",
            "What accountability challenges are, what good rules look like, and how Huntz runs them with real "
            "stakes and published rules. Available now on the App Store.",
        ),
    },
    "contact": {
        "meta": (
            "Reach the Huntz team. Questions about accountability challenges, the waitlist, privacy, or "
            "partnerships: team@huntz.ai. Based in Oakland, California.",
            "Reach the Huntz team. Questions about accountability challenges, the app, privacy, or partnerships: "
            "team@huntz.ai. Based in Oakland, California.",
        ),
        "body": [(
            '<li style="position:relative;font:400 15.5px/1.7 \'Figtree\',Arial,Helvetica,sans-serif;color:#4A453C;'
            'text-wrap:pretty"><span style="position:absolute;left:-20px;top:.62em;width:5px;height:5px;'
            'border-radius:50%;background:#C24E1F;opacity:.55"></span>Problems with the waitlist or this website: '
            'tell us what broke and on what device.</li>',
            '<li style="position:relative;font:400 15.5px/1.7 \'Figtree\',Arial,Helvetica,sans-serif;color:#4A453C;'
            'text-wrap:pretty"><span style="position:absolute;left:-20px;top:.62em;width:5px;height:5px;'
            'border-radius:50%;background:#C24E1F;opacity:.55"></span>Problems with the app or this website: '
            'tell us what broke and on what device.</li>',
        )],
    },
    "faq": {
        "meta": (
            "Plain answers on Hunts, stakes, proof, fees, and privacy. Huntz is pre-launch: the iOS app is in "
            "development and the waitlist at huntz.ai is open.",
            "Plain answers on Hunts, stakes, proof, fees, and privacy. Huntz is live: the iOS app is available "
            "now on the App Store.",
        ),
        "body": [(
            '<p style="margin:0 0 15px;font:400 15.5px/1.75 \'Figtree\',Arial,Helvetica,sans-serif;color:#4A453C;'
            'text-wrap:pretty">Not yet. The first Hunts are being developed now with our first creators. '
            '<a href="/#waitlist" style="color:#C24E1F;text-decoration:none;border-bottom:1px solid '
            'rgba(194,78,31,.4)">Join the waitlist</a> and we will email you when they open. Huntz is for adults '
            '18 and up.</p>',
            '<p style="margin:0 0 15px;font:400 15.5px/1.75 \'Figtree\',Arial,Helvetica,sans-serif;color:#4A453C;'
            'text-wrap:pretty">Yes. Huntz is live on the App Store, with the first Hunts developed directly with '
            f'our first creators. <a href="{APP_STORE_URL}" style="color:#C24E1F;text-decoration:none;'
            'border-bottom:1px solid rgba(194,78,31,.4)">Download the app</a> to join one. Huntz is for adults '
            '18 and up.</p>',
        )],
    },
    "how-it-works": {
        "body": [(
            '<p style="margin:0 0 15px;font:400 15.5px/1.75 \'Figtree\',Arial,Helvetica,sans-serif;color:#4A453C;'
            'text-wrap:pretty">The first Hunts are being developed now, directly with our first creators. '
            '<a href="/#waitlist" style="color:#C24E1F;text-decoration:none;border-bottom:1px solid '
            'rgba(194,78,31,.4)">Join the waitlist</a> and we will email you when they open.</p>',
            '<p style="margin:0 0 15px;font:400 15.5px/1.75 \'Figtree\',Arial,Helvetica,sans-serif;color:#4A453C;'
            'text-wrap:pretty">The first Hunts are live in '
            f'<a href="{APP_STORE_URL}" style="color:#C24E1F;text-decoration:none;border-bottom:1px solid '
            'rgba(194,78,31,.4)">the app</a>.</p>',
        )],
    },
}

PAGES_DIR = BUILD / "pages"
CONTENT_PAGES = []
for spec_path in sorted(PAGES_DIR.glob("*.json")):
    spec = json.loads(spec_path.read_text())
    slug = spec_path.stem
    body = render_blocks(spec["blocks"])
    meta_description = spec["meta_description"]
    if APP_STORE_URL:
        live_copy = CONTENT_LIVE_COPY.get(slug, {})
        if live_copy.get("meta"):
            old_desc, new_desc = live_copy["meta"]
            assert meta_description == old_desc, f"{slug}: meta description drifted from CONTENT_LIVE_COPY's source"
            meta_description = new_desc
        for old_frag, new_frag in live_copy.get("body", []):
            assert body.count(old_frag) == 1, f"{slug}: expected in-copy waitlist sentence not found"
            body = body.replace(old_frag, new_frag)
    page = (content_tpl
            .replace("{{TITLE_TAG}}", spec["title_tag"])
            .replace("{{TITLE}}", spec["h1"])
            .replace("{{EYEBROW}}", spec.get("eyebrow", "HUNTZ"))
            .replace("{{DESC}}", meta_description)
            .replace("{{CANONICAL}}", f"{SITE_URL}/{slug}")
            .replace("{{SITE}}", SITE_URL)
            .replace("{{ICONS}}", ICON_LINKS)
            .replace("{{FONTS_HREF}}", FONTS_HREF)
            .replace("{{BREADCRUMB_LD}}", breadcrumb_ld(spec["h1"], slug))
            .replace("{{NAV_CSS}}", NAV_CSS)
            .replace("{{HEADER_NAV}}", header_nav(f"/{slug}"))
            .replace("{{MENU_BUTTON}}", MENU_BUTTON)
            .replace("{{DRAWER}}", drawer(f"/{slug}", "/#waitlist"))
            .replace("{{FOOTER_NAV}}", footer_nav(f"/{slug}"))
            .replace("{{NAV_JS}}", NAV_JS)
            .replace("{{PAGE_CSS}}", FORM_CSS + "\n" if slug == "contact" else "")
            .replace("{{PAGE_JS}}", CONTACT_JS + "\n" if slug == "contact" else "")
            .replace("{{BODY}}", body))
    assert "{{" not in page, f"unfilled placeholder in {slug}.html"
    # The contact success line is the founder's exact wording and is the one
    # sanctioned em dash; build/check.py asserts it verbatim.
    assert "—" not in body.replace(CONTACT_SUCCESS, ""), f"em dash in {slug} content"
    (ROOT / f"{slug}.html").write_text(page)
    CONTENT_PAGES.append(slug)

# ---- 6c. the blog (2026-08-14) ----
# Articles are structured content in build/blog/*.json, rendered through the same
# block renderer the marketing pages use, so an article is copy rather than a
# hand-built page. Everything below is derived: reading time, heading ids, the
# table of contents, breadcrumbs and the BlogPosting record.

BLOG_DIR = BUILD / "blog"
BLOG_H1 = "Notes on accountability."
BLOG_INTRO = ("Why goals fall apart, what actually holds them together, and how the tools "
              "compare. Written by the team building Huntz.")
BLOG_TITLE_TAG = "Huntz Blog | Accountability, Goals and Follow-Through"
BLOG_DESC = ("Notes on accountability from the team building Huntz: why goals fall apart, "
             "what holds them together, and how the accountability apps compare.")

ARTICLE_CSS = f"""
/* Article body: a measure that stays readable, and a table that restacks rather
   than scrolling sideways on a phone - the same treatment the legal pages give
   their retention table. */
article h2{{ text-wrap:pretty !important }}
[data-hz-toc] a{{ color:{BODYC}; text-decoration:none; border-bottom:1px solid rgba(22,19,14,.16) }}
[data-hz-toc] a:hover{{ color:{CLAY} }}
[data-hz-tablewrap]{{ margin:0 0 22px; overflow-x:auto; -webkit-overflow-scrolling:touch }}
[data-hz-table]{{ width:100%; border-collapse:collapse; font:400 14.5px/1.55 {SANS}; color:{BODYC} }}
[data-hz-table] caption{{ caption-side:bottom; padding-top:12px; font:400 12.5px/1.6 {SANS};
  color:{MUTED}; text-align:left }}
[data-hz-table] th{{ text-align:left; font:700 10.5px {SANS}; letter-spacing:.13em;
  text-transform:uppercase; color:{MUTED}; padding:0 16px 10px 0;
  border-bottom:1px solid rgba(22,19,14,.20) }}
[data-hz-table] td{{ padding:13px 16px 13px 0; border-bottom:1px solid rgba(22,19,14,.10);
  vertical-align:top }}
[data-hz-table] td:first-child{{ font-weight:600; color:{INK} }}
@media (max-width:640px){{
  [data-hz-tablewrap]{{ overflow-x:visible }}
  /* Once the table is no longer a table, caption-side stops applying and the
     caption would jump above the rows. Flex ordering puts it back underneath. */
  [data-hz-table]{{ display:flex; flex-direction:column; width:auto }}
  [data-hz-table] caption{{ order:2; padding-top:10px }}
  [data-hz-table] tbody{{ order:1 }}
  [data-hz-table] tbody,[data-hz-table] tr,[data-hz-table] td{{ display:block; width:auto }}
  [data-hz-table] thead{{ display:none }}
  [data-hz-table] tr{{ padding:15px 0; border-bottom:1px solid rgba(22,19,14,.14) }}
  [data-hz-table] td{{ padding:0 0 8px; border:0 }}
  [data-hz-table] td::before{{ content:attr(data-label); display:block; font:700 9.5px {SANS};
    letter-spacing:.13em; text-transform:uppercase; color:{MUTED}; margin-bottom:3px }}
}}
"""


def reading_time(blocks) -> str:
    words = 0
    for b in blocks:
        words += len(b.get("text", "").split())
        words += sum(len(i.split()) for i in b.get("items", []))
        words += sum(len(c.split()) for row in b.get("rows", []) for c in row)
    return f"{max(1, round(words / 200))} min read"


def heading_id(text: str) -> str:
    keep = [c.lower() if c.isalnum() else "-" for c in text]
    slug = re.sub(r"-+", "-", "".join(keep)).strip("-")
    return "s-" + slug[:60].strip("-")


def human_date(iso: str) -> str:
    from datetime import date
    d = date.fromisoformat(iso)
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def crumbs(trail) -> str:
    """trail: [(name, href)] - the last entry is the page you are on, so it is
    rendered as text rather than a link back to itself. The structured-data
    version below still carries its URL, which is what schema.org expects."""
    out = []
    last = len(trail) - 1
    for i, (name, href) in enumerate(trail):
        sep = ('<li aria-hidden="true" style="color:rgba(22,19,14,.3)">/</li>' if i else "")
        if i == last:
            out.append(sep + f'<li aria-current="page" style="color:{INK}">{H_ESCAPE(name)}</li>')
        else:
            out.append(sep + f'<li><a href="{href}" style="color:{MUTED};text-decoration:none;'
                             f'border-bottom:1px solid rgba(22,19,14,.2)">{H_ESCAPE(name)}</a></li>')
    return "\n      ".join(out)


def crumb_ld(trail):
    items = []
    for i, (name, href) in enumerate(trail, start=1):
        items.append({"@type": "ListItem", "position": i, "name": name,
                      "item": SITE_URL + (href if href else trail[-1][1] or "/")})
    return ld({"@context": "https://schema.org", "@type": "BreadcrumbList",
               "itemListElement": items})


def toc_of(blocks) -> str:
    heads = [b for b in blocks if b["type"] == "h2"]
    if len(heads) < 3:
        return ""
    items = "".join(
        f'<li style="margin:0 0 7px"><a href="#{b["id"]}">{render_text(b["text"])}</a></li>'
        for b in heads)
    return (f'<nav data-hz-toc aria-label="On this page" style="margin:26px 0 6px;padding:18px 20px;'
            f'border:1px solid rgba(22,19,14,.14);border-radius:14px;'
            f'background:rgba(255,255,255,.45)">'
            f'<p style="margin:0 0 10px;font:700 10px {SANS};letter-spacing:.14em;'
            f'text-transform:uppercase;color:{MUTED}">On this page</p>'
            # Unnumbered: these headings already carry their own numbering, and an
            # ordered list would render "1. 1. Nobody knows whether you quit".
            f'<ul style="margin:0;padding:0;list-style:none;font:400 14.5px/1.5 {SANS};color:{BODYC}">'
            f"{items}</ul></nav>")


article_tpl = apply_content_app_store_switch((BUILD / "article-page.html").read_text())
index_tpl = apply_content_app_store_switch((BUILD / "blog-index.html").read_text())
ARTICLES = []

for spec_path in sorted(BLOG_DIR.glob("*.json")):
    a = json.loads(spec_path.read_text())
    slug = spec_path.stem
    route = f"/blog/{slug}"
    for b in a["blocks"]:
        if b["type"] == "h2":
            b["id"] = heading_id(b["text"])

    trail = [("Huntz", "/"), ("Blog", "/blog"), (a["title"], route)]
    posting = ld({
        "@context": "https://schema.org", "@type": "BlogPosting",
        "headline": a["title"],
        "description": a["meta_description"],
        "datePublished": a["published"],
        "dateModified": a["published"],
        "author": {"@type": "Organization", "name": a["author"], "url": SITE_URL + "/"},
        "publisher": {"@type": "Organization", "name": "Huntz",
                      "logo": {"@type": "ImageObject", "url": SITE_URL + "/icon-512.png"}},
        "image": SITE_URL + "/og-image.jpg",
        "mainEntityOfPage": {"@type": "WebPage", "@id": SITE_URL + route},
        "url": SITE_URL + route,
        "inLanguage": "en",
    })

    page = (article_tpl
            .replace("{{TITLE_TAG}}", H_ESCAPE(a["title_tag"]))
            .replace("{{DESC}}", H_ESCAPE(a["meta_description"]))
            .replace("{{CANONICAL}}", SITE_URL + route)
            .replace("{{SITE}}", SITE_URL)
            .replace("{{ICONS}}", ICON_LINKS)
            .replace("{{FONTS_HREF}}", FONTS_HREF)
            .replace("{{BREADCRUMB_LD}}", crumb_ld(trail))
            .replace("{{ARTICLE_LD}}", posting)
            .replace("{{NAV_CSS}}", NAV_CSS)
            .replace("{{ARTICLE_CSS}}", ARTICLE_CSS)
            .replace("{{HEADER_NAV}}", header_nav("/blog"))
            .replace("{{MENU_BUTTON}}", MENU_BUTTON)
            .replace("{{DRAWER}}", drawer("/blog", "/#waitlist"))
            .replace("{{FOOTER_NAV}}", footer_nav("/blog"))
            .replace("{{NAV_JS}}", NAV_JS)
            .replace("{{BREADCRUMBS}}", crumbs(trail))
            .replace("{{EYEBROW}}", a.get("eyebrow", "BLOG"))
            .replace("{{TITLE}}", H_ESCAPE(a["title"]))
            .replace("{{AUTHOR}}", H_ESCAPE(a["author"]))
            .replace("{{PUBLISHED_ISO}}", a["published"])
            .replace("{{PUBLISHED_HUMAN}}", human_date(a["published"]))
            .replace("{{READING_TIME}}", reading_time(a["blocks"]))
            .replace("{{TOC}}", toc_of(a["blocks"]))
            .replace("{{BODY}}", render_blocks(a["blocks"])))
    assert "{{" not in page, f"unfilled placeholder in {route}"
    out = ROOT / "blog" / f"{slug}.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(page)
    ARTICLES.append({"slug": slug, "route": route, "title": a["title"],
                     "description": a["description"], "published": a["published"],
                     "author": a["author"], "reading": reading_time(a["blocks"])})

# Newest first, so the index does not silently depend on filename order.
ARTICLES.sort(key=lambda x: (x["published"], x["title"]), reverse=True)

cards = "\n  ".join(
    f'<article><a data-hz-post href="{x["route"]}" style="display:block;margin:0 0 18px;'
    f'padding:clamp(20px,2.6vw,26px);border:1px solid rgba(22,19,14,.14);border-radius:18px;'
    f'background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.34));'
    f'text-decoration:none;transition:border-color .25s ease">'
    f'<div style="font:500 12px {SANS};color:{MUTED};margin-bottom:9px">'
    f'<time datetime="{x["published"]}">{human_date(x["published"])}</time>'
    f' <span aria-hidden="true">·</span> {x["reading"]}</div>'
    f'<h2 data-hz-posttitle style="margin:0 0 9px;font:600 clamp(21px,2.5vw,27px)/1.25 {SERIF};'
    f'letter-spacing:-.012em;color:{INK};transition:color .25s ease">{H_ESCAPE(x["title"])}</h2>'
    f'<p style="margin:0 0 12px;font:400 15px/1.65 {SANS};color:{BODYC};text-wrap:pretty">'
    f'{H_ESCAPE(x["description"])}</p>'
    f'<span style="font:700 11px {SANS};letter-spacing:.12em;text-transform:uppercase;'
    f'color:{CLAY}">Read the article &#8594;</span></a></article>'
    for x in ARTICLES)

blog_trail = [("Huntz", "/"), ("Blog", "/blog")]
list_ld = ld({"@context": "https://schema.org", "@type": "Blog",
              "name": "Huntz Blog", "url": SITE_URL + "/blog",
              "description": BLOG_DESC,
              "publisher": {"@type": "Organization", "name": "Huntz",
                            "logo": {"@type": "ImageObject", "url": SITE_URL + "/icon-512.png"}},
              "blogPost": [{"@type": "BlogPosting", "headline": x["title"],
                            "url": SITE_URL + x["route"], "datePublished": x["published"],
                            "description": x["description"]} for x in ARTICLES]})

index_page = (index_tpl
              .replace("{{TITLE_TAG}}", H_ESCAPE(BLOG_TITLE_TAG))
              .replace("{{DESC}}", H_ESCAPE(BLOG_DESC))
              .replace("{{CANONICAL}}", SITE_URL + "/blog")
              .replace("{{SITE}}", SITE_URL)
              .replace("{{ICONS}}", ICON_LINKS)
              .replace("{{FONTS_HREF}}", FONTS_HREF)
              .replace("{{BREADCRUMB_LD}}", crumb_ld(blog_trail))
              .replace("{{LIST_LD}}", list_ld)
              .replace("{{NAV_CSS}}", NAV_CSS)
              .replace("{{HEADER_NAV}}", header_nav("/blog"))
              .replace("{{MENU_BUTTON}}", MENU_BUTTON)
              .replace("{{DRAWER}}", drawer("/blog", "/#waitlist"))
              .replace("{{FOOTER_NAV}}", footer_nav("/blog"))
              .replace("{{NAV_JS}}", NAV_JS)
              .replace("{{BREADCRUMBS}}", crumbs(blog_trail))
              .replace("{{H1}}", H_ESCAPE(BLOG_H1))
              .replace("{{INTRO}}", H_ESCAPE(BLOG_INTRO))
              .replace("{{POSTS}}", cards))
assert "{{" not in index_page, "unfilled placeholder in /blog"
(ROOT / "blog.html").write_text(index_page)


# ---- 7. robots + sitemap: canonical, public, 200 pages only ----
SITEMAP_PATHS = (["/", "/terms", "/privacy"] + [f"/{s}" for s in sorted(CONTENT_PAGES)]
                 + ["/blog"] + [a["route"] for a in ARTICLES])
sitemap = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for path in SITEMAP_PATHS:
    sitemap.append(f"  <url><loc>{SITE_URL}{path}</loc></url>")
sitemap.append("</urlset>")
(ROOT / "sitemap.xml").write_text("\n".join(sitemap) + "\n")

# ---- 8. Universal Links: AASA + the /hunt fallback (2026-08-22) ----
# Apple fetches the association file through its CDN and follows no redirects
# (TN3155: "host your AASA at each domain and subdomain included in your
# applinks"), so the file is written as a real static asset rather than served
# by a function, and vercel.json gives it application/json.
#
# APPLE_TEAM_ID is confirmed from the signed Build 7 provisioning profile, whose
# entitlement carries the BARE APEX domain (applinks:huntz.ai) - not www. That is
# what forces the apex to serve this file directly; see the host-scoped redirect
# in vercel.json.
APPLE_TEAM_ID = "JVTW9DH25L"
IOS_BUNDLE_ID = "ai.huntz.app"

# Narrow on purpose. Only app-owned path families are associated, so a
# tapped marketing or blog link never leaves the browser:
#
#   /hunt/*        Hunt invitations. In the modern format the "?" key defaults to
#                  matching any query, so this one entry covers ?ref=<token> too.
#   /auth/callback The Supabase email-confirmation return. Associating it is what
#                  lets an installed app take the confirmation instead of the web
#                  page; the app's deep-link handler treats a /auth/callback URL
#                  carrying ?code= as a PKCE auth return.
AASA = {
    "applinks": {
        "details": [
            {
                "appIDs": [f"{APPLE_TEAM_ID}.{IOS_BUNDLE_ID}"],
                "components": [
                    {
                        "/": "/hunt/*",
                        "comment": "Hunt invitations, including referral links such as "
                                   "/hunt/<id>?ref=<token>",
                    },
                    {
                        "/": "/hunt",
                        "comment": "The bare /hunt path, which /hunt/* does not match",
                    },
                    {
                        "/": "/auth/callback",
                        "comment": "Supabase email-confirmation return, with or without "
                                   "its ?code= query",
                    },
                    {
                        "/": "/mailbox/gmail-action/pair",
                        "comment": "Gmail account pairing; confirmation happens only in the app",
                    },
                ],
            }
        ]
    },
    # ASWebAuthenticationSession's HTTPS callback API requires the callback
    # host to associate the calling app through the webcredentials service.
    # This is association metadata only; Huntz stores no website passwords.
    "webcredentials": {
        "apps": [f"{APPLE_TEAM_ID}.{IOS_BUNDLE_ID}"]
    },
}

AASA_JSON = json.dumps(AASA, indent=2) + "\n"
# Both paths are written from the one object so they cannot drift apart.
AASA_PATHS = [".well-known/apple-app-site-association", "apple-app-site-association"]
for rel in AASA_PATHS:
    out = ROOT / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(AASA_JSON)


# The /hunt fallback. This exact byte stream is what api/hunt.js (2026-09-23)
# serves verbatim whenever it cannot resolve a per-Hunt preview - API non-200,
# unreachable, slow, or no id in the URL at all - and it is also what a
# per-Hunt response starts from: only its <title>/description/og:* values get
# replaced, so the rest of the page (nav, waitlist CTA, the id-display script)
# is guaranteed byte-identical in every case. ?ref=/?via= are still never read
# server-side beyond api/hunt.js's own id/code parsing; neither ever reaches
# this template, a request, or a log line. "/hunt" is not in ROUTES, so it
# stays out of the nav, and not in SITEMAP_PATHS, so it stays unindexed.
HUNT_TITLE_TAG = "Hunt invitation | Huntz"
HUNT_DESC = ("This Hunt invitation opens in the Huntz app. Huntz is in limited beta - "
             "join the waitlist, then reopen your invitation once you have the app.")
hunt_page = ((BUILD / "hunt-page.html").read_text()
             .replace("{{TITLE_TAG}}", HUNT_TITLE_TAG)
             .replace("{{DESC}}", HUNT_DESC)
             .replace("{{SITE}}", SITE_URL)
             .replace("{{ICONS}}", ICON_LINKS)
             .replace("{{FONTS_HREF}}", FONTS_HREF)
             .replace("{{NAV_CSS}}", NAV_CSS)
             .replace("{{HEADER_NAV}}", header_nav("/hunt"))
             .replace("{{MENU_BUTTON}}", MENU_BUTTON)
             # app_store=False: this page must stay "limited beta" and never
             # claim App Store availability (build/check.py), regardless of
             # the marketing site's own APP_STORE_URL switch.
             .replace("{{DRAWER}}", drawer("/hunt", "/#waitlist", app_store=False))
             .replace("{{FOOTER_NAV}}", footer_nav("/hunt"))
             .replace("{{NAV_JS}}", NAV_JS))
assert "{{" not in hunt_page, "unfilled placeholder in hunt-fallback.html"
# Written under api/_lib, NOT the repo root. api/hunt.js now owns /hunt and
# /hunt/:path+ (vercel.json rewrites both there ahead of the filesystem), and
# Vercel gives an existing static file precedence over a rewrite that targets
# its own clean URL - a same-named file at the repo root would keep answering
# /hunt directly via cleanUrls and silently shadow the function for every
# invitation link. The leading _lib keeps this off the function router, the
# same as api/_lib/validate.js, while still shipping in the deployment so
# api/hunt.js can read these exact bytes at runtime (vercel.json's
# functions["api/hunt.js"].includeFiles).
HUNT_FALLBACK_PATH = ROOT / "api" / "_lib" / "hunt-fallback.html"
HUNT_FALLBACK_PATH.parent.mkdir(parents=True, exist_ok=True)
HUNT_FALLBACK_PATH.write_text(hunt_page)


# The /auth/callback browser fallback. Written as auth/callback.html and served
# at /auth/callback by cleanUrls, the same way the blog articles are - no rewrite
# needed. Like the /hunt page it is one constant static file, so a single-use
# auth code cannot be rendered into it or reach any server code of ours.
#
# It exists because a Supabase email confirmation currently returns to a target
# no browser can display, which is what produces the blank desktop page. On an
# iPhone with Huntz installed the universal link wins and this page never
# renders; it is the fallback for desktop, for other browsers, and for anyone
# without the app.
# One static file serves confirmation, password-reset and expired-link arrivals
# alike, so the title and description have to be true for all of them. Only the
# body copy is allowed to name the specific outcome.
AUTH_TITLE_TAG = "Continue in Huntz"
AUTH_DESC = "Finish signing in to Huntz. Email links open in the Huntz app on your phone."
auth_page = ((BUILD / "auth-callback-page.html").read_text()
             .replace("{{TITLE_TAG}}", AUTH_TITLE_TAG)
             .replace("{{DESC}}", AUTH_DESC)
             .replace("{{SITE}}", SITE_URL)
             .replace("{{ICONS}}", ICON_LINKS)
             .replace("{{FONTS_HREF}}", FONTS_HREF)
             .replace("{{NAV_CSS}}", NAV_CSS)
             .replace("{{HEADER_NAV}}", header_nav("/auth/callback"))
             .replace("{{MENU_BUTTON}}", MENU_BUTTON)
             # app_store=False: this page's copy must stay account-agnostic
             # and never claim App Store availability (build/check.py),
             # regardless of the marketing site's own APP_STORE_URL switch.
             .replace("{{DRAWER}}", drawer("/auth/callback", "/#waitlist", app_store=False))
             .replace("{{FOOTER_NAV}}", footer_nav("/auth/callback"))
             .replace("{{NAV_JS}}", NAV_JS))
assert "{{" not in auth_page, "unfilled placeholder in auth/callback.html"
(ROOT / "auth").mkdir(exist_ok=True)
(ROOT / "auth" / "callback.html").write_text(auth_page)

# A browser fallback is required when Gmail's browser or Apple's association
# cache does not hand the HTTPS link to the installed app. No third-party assets.
gmail_pair_dir = ROOT / "mailbox" / "gmail-action"
gmail_pair_dir.mkdir(parents=True, exist_ok=True)
(gmail_pair_dir / "pair.html").write_text((BUILD / "gmail-pair-page.html").read_text())

# Stripe requires HTTPS return/refresh destinations. These browser fallbacks
# hand control to the fixed native route without forwarding provider input.
payout_dir = ROOT / "payouts"
payout_dir.mkdir(exist_ok=True)
payout_page = (BUILD / "payout-return-page.html").read_text()
(payout_dir / "return.html").write_text(payout_page)
(payout_dir / "refresh.html").write_text(payout_page)


print(f"index.html  {(ROOT / 'index.html').stat().st_size:,} bytes")
print(f"app js      {APP_HREF}")
print(f"fonts css   {FONTS_HREF}")
print(f"pages       {', '.join(['terms', 'privacy'] + CONTENT_PAGES)}")
print(f"blog        /blog + {len(ARTICLES)} articles")
print(f"aasa        {APPLE_TEAM_ID}.{IOS_BUNDLE_ID} at {len(AASA_PATHS)} paths")
print(f"hunt        /hunt, /hunt/* -> api/hunt.js (noindex, unlisted; "
      f"falls back to api/_lib/hunt-fallback.html)")
print(f"auth        /auth/callback (noindex, unlisted)")
print(f"sitemap     {len(SITEMAP_PATHS)} urls")
print(f"artifact    {(BUILD / 'huntz-landing.artifact.html').stat().st_size:,} bytes")
