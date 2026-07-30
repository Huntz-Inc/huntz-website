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
html = link_re.sub(lambda m: font_style, html)

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
for label, anchor in (("Terms of service", "#/terms"), ("Privacy policy", "#/privacy")):
    old = f"""<a href="#top" style="display:block;font:500 14.5px 'Figtree',Arial,Helvetica,sans-serif;color:#4A453C;text-decoration:none;transition:color .3s ease" style-hover="color:#C24E1F">{label}</a>"""
    assert old in html, label + " link not found"
    html = html.replace(old, old.replace('href="#top"', f'href="{anchor}"'))

legal = (BUILD / "legal-overlay.html").read_text()
assert "</body>" in html
html = html.replace("</body>", legal + "\n</body>")

# ---- 2c. design improvements requested 2026-07-29 (second round) ----

# (I-2) "Upcoming" hunt cards become actionable: click/Enter scrolls to the
# final CTA, focuses the email field, and records the interest (submitted with
# the email once the waitlist backend is wired).
HUNT_NAMES = ["Apply to jobs", "Post content", "Read books", "Stay fit", "Live stream"]
_card_i = {"i": 0}
def _card_attrs(m):
    i = _card_i["i"]; _card_i["i"] += 1
    n = HUNT_NAMES[i]
    return ('<div data-plate="" onClick="{{ pick%d }}" onKeyDown="{{ pickkey%d }}" role="button" tabIndex="0" '
            'aria-label="Join the waitlist: interested in %s" style="cursor:pointer;scroll-snap-align:start;' % (i, i, n))
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
    ("plus a capped share of the stakes forfeited by those who quit — both settled to your account within 48 hours of the hunt closing.",
     "plus a capped share of the stakes forfeited by those who quit. Both are settled to your account within 48 hours of the hunt closing."),
    ("Every hunt publishes its rules before you join — allowed misses, grace days, deadlines.",
     "Every hunt publishes its rules before you join: allowed misses, grace days, deadlines."),
    ("checked against the hunt's rules — an automated first pass, human review for anything unclear,",
     "checked against the hunt's rules: an automated first pass, human review for anything unclear,"),
]
for old, new in EM_DASH_COPY:
    assert old in html, "em-dash copy not found: " + old[:60]
    html = html.replace(old, new)

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
html = html.replace('<script src="./support.js"></script>', inline_scripts)

# ---- 4. standalone page ----
# (I-1) Title, description, social-share (OG/Twitter) tags, favicon.
# The share image is served from SITE_URL/og-image.png — previews stay blank
# until the site actually answers on that domain.
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E"
           "%3Crect width='100' height='100' rx='22' fill='%23F3EFE7'/%3E"
           "%3Ctext x='50' y='56' text-anchor='middle' dominant-baseline='central' "
           "font-family='Arial,Helvetica,sans-serif' font-weight='800' font-size='58' "
           "fill='%2316130E'%3EH%3Ctspan fill='%23C24E1F'%3E.%3C/tspan%3E%3C/text%3E%3C/svg%3E")
HEAD_META = """<title>Huntz · Put your money where your goals are.</title>
<meta name="description" content="Stake $50–$500 of your own money on your own goal. Post proof every day. Finish and you get 100% back, plus a share of the stakes forfeited by everyone who quit.">
<meta property="og:title" content="Huntz · Put your money where your goals are.">
<meta property="og:description" content="Stake $50–$500 on your own goal. Post proof daily. Finish and get 100% back, plus a share of the stakes forfeited by everyone who quit.">
<meta property="og:type" content="website">
<meta property="og:url" content="{site}/">
<meta property="og:image" content="{site}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Huntz · Put your money where your goals are.">
<meta name="twitter:description" content="Stake $50–$500 on your own goal. Post proof daily. Finish and get 100% back.">
<meta name="twitter:image" content="{site}/og-image.png">
<link rel="icon" href="{favicon}">""".replace("{favicon}", FAVICON).replace("{site}", SITE_URL)
html = html.replace(
    "<head>\n<meta charset=\"utf-8\">",
    "<head>\n<meta charset=\"utf-8\">\n" + HEAD_META,
    1,
)
(ROOT / "index.html").write_text(html)

# ---- 5. artifact fragment: no doctype/html/head/body (publisher wraps it) ----
m = re.search(r"<body>\n?(.*)\n?</body>", html, re.S)
body = m.group(1)
# support.js boots on DOMContentLoaded, so keeping the original source order
# (scripts, then the <x-dc> template) is all that matters here.
fragment = inline_scripts + "\n" + body
(BUILD / "huntz-landing.artifact.html").write_text(fragment)

for f in (ROOT / "index.html", BUILD / "huntz-landing.artifact.html"):
    print(f"{f.relative_to(ROOT)}  {f.stat().st_size:,} bytes")
