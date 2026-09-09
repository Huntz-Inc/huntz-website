#!/usr/bin/env python3
"""SEO/route validation for the built site.

    python3 build/check.py

Run after build/assemble.py. Exits non-zero on the first category of failure,
so CI or a pre-commit run cannot ship a page with missing or duplicated
metadata, a broken sitemap, or re-embedded legal copy.
"""
import json
import pathlib
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://www.huntz.ai"

PAGES = {
    "/": "index.html",
    "/terms": "terms.html",
    "/privacy": "privacy.html",
    "/about": "about.html",
    "/contact": "contact.html",
    "/faq": "faq.html",
    "/how-it-works": "how-it-works.html",
    "/accountability-challenges": "accountability-challenges.html",
    "/blog": "blog.html",
    "/blog/best-accountability-apps-2026": "blog/best-accountability-apps-2026.html",
    "/blog/why-you-dont-achieve-your-goals": "blog/why-you-dont-achieve-your-goals.html",
}
# Articles keep the author's voice, em dashes and all, so they are excluded from
# the marketing-copy rules that apply to the hand-written pages.
ARTICLES = ["/blog/best-accountability-apps-2026", "/blog/why-you-dont-achieve-your-goals"]

failures = []


def fail(msg: str):
    failures.append(msg)


def one(pattern: str, text: str, page: str, what: str) -> str:
    found = re.findall(pattern, text, re.S)
    if len(found) != 1:
        fail(f"{page}: expected exactly 1 {what}, found {len(found)}")
        return ""
    return found[0]


titles, descriptions, canonicals = {}, {}, {}

for path, fname in PAGES.items():
    f = ROOT / fname
    if not f.exists():
        fail(f"{path}: {fname} missing")
        continue
    t = f.read_text()

    if not re.search(r'<html\s[^>]*lang="en"', t):
        fail(f"{path}: <html> lacks lang=\"en\"")

    title = one(r"<title>([^<]+)</title>", t, path, "<title>")
    desc = one(r'<meta name="description" content="([^"]*)"', t, path, "meta description")
    canon = one(r'<link rel="canonical" href="([^"]*)"', t, path, "canonical")
    h1s = re.findall(r"<h1[\s>]", t)
    if len(h1s) != 1:
        fail(f"{path}: expected exactly 1 <h1>, found {len(h1s)}")

    if title:
        if title in titles:
            fail(f"{path}: duplicate title with {titles[title]}: {title!r}")
        titles[title] = path
        if len(title) > 75:
            fail(f"{path}: title {len(title)} chars (>75)")
    if desc:
        if desc in descriptions:
            fail(f"{path}: duplicate description with {descriptions[desc]}")
        descriptions[desc] = path
        if len(desc) > 165:
            fail(f"{path}: description {len(desc)} chars (>165)")
    if canon:
        expected = SITE + ("" if path == "/" else path) + ("/" if path == "/" else "")
        if canon != expected:
            fail(f"{path}: canonical {canon!r} != {expected!r}")
        canonicals[canon] = path

    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', t, re.S):
        try:
            json.loads(m.group(1))
        except json.JSONDecodeError as e:
            fail(f"{path}: invalid JSON-LD ({e})")

    # Build placeholders are spaceless uppercase ({{TITLE}}). The design
    # runtime's own bindings ({{ busy1 }}) are legitimate and always spaced.
    if re.search(r"\{\{[A-Z_]+\}\}", t):
        fail(f"{path}: unfilled build placeholder present")
    if "localhost" in t or "127.0.0.1" in t:
        fail(f"{path}: staging/localhost URL leaked into output")

    for asset in re.findall(r'(?:href|src)="(/assets/[^"]+)"', t):
        if not (ROOT / asset.lstrip("/")).exists():
            fail(f"{path}: references missing asset {asset}")

# Home-specific: legal documents must NOT be embedded, labels must exist.
home = (ROOT / "index.html").read_text()
for marker in ("Governing law", "BINDING", "Arbitration Association", "hz-terms-doc"):
    if marker in home:
        fail(f"/: legal-document marker {marker!r} still embedded in home")
if home.count('aria-label="Email address"') != 2:
    fail("/: email inputs missing aria-label")
if "Example outcome. Each Hunt's rules and verification method are shown before you join." not in home:
    fail("/: example-outcome caption missing")
# The dark HUNT No.0412 example card carries the founder-approved "PAID IN 48H"
# chip (restored 2026-08-13) and is captioned as an example. Exactly one, and no
# other wording of the promise anywhere on the page.
if home.count("PAID IN 48H") != 1:
    fail(f"/: expected exactly 1 'PAID IN 48H' chip, found {home.count('PAID IN 48H')}")
rest = home.replace("PAID IN 48H", "")
for phrase in ("48H", "48h", "48 hours", "48-hour", "48 hour"):
    if phrase in rest:
        fail(f"/: unsupported 48-hour settlement promise {phrase!r} outside the example card")
if "IN PRE-LAUNCH" in home:
    fail("/: removed hero pre-launch disclaimer has reappeared")
for link in ("/how-it-works", "/accountability-challenges", "/faq", "/about", "/contact", "/terms", "/privacy"):
    if f'href="{link}"' not in home:
        fail(f"/: footer link to {link} missing")

# Content pages: no em dashes in marketing copy (legal keeps counsel's own).
# The contact form's success line is the founder's exact wording and is the
# single sanctioned exception; it is asserted verbatim further down.
CONTACT_SUCCESS = "Thanks\u2014your message reached the Huntz team."
for path in ("/about", "/contact", "/faq", "/how-it-works", "/accountability-challenges"):
    t = (ROOT / PAGES[path]).read_text()
    body = t[t.index("<main"):].replace(CONTACT_SUCCESS, "")
    if "—" in body:
        fail(f"{path}: em dash in marketing copy")

# robots + sitemap
robots = ROOT / "robots.txt"
if not robots.exists() or "Sitemap: https://www.huntz.ai/sitemap.xml" not in robots.read_text():
    fail("robots.txt missing or lacks sitemap line")
if "Disallow: /" in (robots.read_text() if robots.exists() else ""):
    fail("robots.txt contains a broad Disallow")

sm = ROOT / "sitemap.xml"
if not sm.exists():
    fail("sitemap.xml missing")
else:
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    locs = [e.text for e in ET.parse(sm).getroot().findall("s:url/s:loc", ns)]
    expected_locs = {SITE + p for p in PAGES}
    expected_locs.remove(SITE + "/")
    expected_locs.add(SITE + "/")
    if set(locs) != expected_locs:
        fail(f"sitemap URLs mismatch: {sorted(set(locs) ^ expected_locs)}")
    for loc in locs:
        path = loc.replace(SITE, "") or "/"
        if path not in PAGES:
            fail(f"sitemap contains unknown path {path}")

# 2026-08-13 correction-pass regressions
outputs = [ROOT / f for f in PAGES.values()] + [ROOT / "build/huntz-landing.artifact.html"]
for f in outputs:
    txt = f.read_text()
    if 'href="#challenges"' in txt or 'href="/#challenges"' in txt:
        fail(f"{f.name}: legacy #challenges link present")
    if '"#join"' in txt or '"/#join"' in txt:
        fail(f"{f.name}: stale #join anchor present")
if 'id="waitlist"' not in home:
    fail("/: #waitlist form anchor missing")
if 'location.replace("/accountability-challenges")' not in home:
    fail("/: legacy #challenges hash redirect missing")
if "focusWaitlist" not in home:
    fail("/: waitlist focus behavior missing")
faq_html = (ROOT / "faq.html").read_text()
if "Who creates Hunts at launch?" not in faq_html or "works directly with selected creators" not in faq_html:
    fail("/faq: launch-model Q&A missing")
if "Huntz publishes the Hunts" in faq_html:
    fail("/faq: contradictory launch-model claim present")
for path in ("/about", "/contact", "/faq", "/how-it-works", "/accountability-challenges"):
    body = (ROOT / PAGES[path]).read_text()
    body = body[body.index("<main"):]
    for marker in ("Status as of", "August 2026", "pre-launch", "Pre-launch", "iOS app is in development"):
        if marker in body:
            fail(f"{path}: status-strip language {marker!r} still in body")
    full = (ROOT / PAGES[path]).read_text()
    if "Join the waitlist and we'll email you when the first Hunts open." not in full:
        fail(f"{path}: corrected CTA sentence missing")

# ---- icons and share images ----
# Dimensions are read from the file headers rather than with Pillow, so this
# checker stays runnable with nothing but the standard library.

def png_size(data: bytes):
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    return (int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big"))


def ico_sizes(data: bytes):
    if data[:4] != b"\x00\x00\x01\x00":
        return None
    n = int.from_bytes(data[4:6], "little")
    out = []
    for i in range(n):
        e = 6 + i * 16
        w, h = data[e], data[e + 1]
        out.append((w or 256, h or 256))
    return sorted(out)


# path -> expected square size. The ICO is checked separately: it is one file
# holding several sizes.
ICON_PNGS = {
    "favicon-48x48.png": 48,
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}
ICO_EXPECTED = [(16, 16), (32, 32), (48, 48)]

for f in ("og-image.jpg",):
    if not (ROOT / f).exists():
        fail(f"{f} missing")

for name, expected in ICON_PNGS.items():
    path = ROOT / name
    if not path.exists():
        fail(f"{name} missing")
        continue
    size = png_size(path.read_bytes())
    if size is None:
        fail(f"{name} is not a PNG")
    elif size != (expected, expected):
        fail(f"{name} is {size[0]}x{size[1]}, expected {expected}x{expected}")

ico = ROOT / "favicon.ico"
if not ico.exists():
    fail("favicon.ico missing")
else:
    sizes = ico_sizes(ico.read_bytes())
    if sizes is None:
        fail("favicon.ico is not an ICO")
    else:
        if sizes != ICO_EXPECTED:
            fail(f"favicon.ico holds {sizes}, expected {ICO_EXPECTED}")
        for w, h in sizes:
            if w != h:
                fail(f"favicon.ico contains a non-square {w}x{h} image")

# Every route, including the legal pages, carries the same icon set.
ICON_REFS = [
    '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">',
    '<link rel="icon" href="/favicon-48x48.png" type="image/png" sizes="48x48">',
    '<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">',
    '<link rel="icon" href="/icon-512.png" type="image/png" sizes="512x512">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">',
]
for path, fname in PAGES.items():
    t = (ROOT / fname).read_text()
    for ref in ICON_REFS:
        if ref not in t:
            fail(f"{path}: missing icon reference {ref}")
    # No stale references: the old inline lettermark, and nothing pointing at an
    # icon file that is not on disk.
    for href in re.findall(r'<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"', t):
        if href.startswith("data:"):
            fail(f"{path}: icon reference is a data URI, not a stable root URL")
        elif not href.startswith("/"):
            fail(f"{path}: icon reference {href!r} is not a root-relative URL")
        elif not (ROOT / href.lstrip("/")).exists():
            fail(f"{path}: icon reference {href} has no file on disk")

# The Organization logo search engines read must be the 512px absolute URL.
home_ld = [json.loads(m) for m in
           re.findall(r'<script type="application/ld\+json">(.*?)</script>', home, re.S)]
org = [b for b in home_ld if b.get("@type") == "Organization"]
if not org:
    fail("/: Organization structured data missing")
elif org[0].get("logo") != SITE + "/icon-512.png":
    fail(f"/: Organization logo is {org[0].get('logo')!r}, expected {SITE + '/icon-512.png'!r}")
elif not (ROOT / "icon-512.png").exists():
    fail("/: Organization logo points at a file that does not exist")


# ---- navigation, active route, footer (2026-08-13) ----
ROUTES = ["/", "/how-it-works", "/accountability-challenges", "/faq", "/about",
          "/contact", "/terms", "/privacy"]
NAV_PAGES = {p: f for p, f in PAGES.items() if p not in ("/terms", "/privacy")}

for path, fname in NAV_PAGES.items():
    t = (ROOT / fname).read_text()
    # A visitor arriving from search has no useful Back history, so every page
    # that carries the primary nav must carry the whole route map with it.
    if 'data-hz-menu-btn' not in t:
        fail(f"{path}: mobile menu button missing")
    for attr in ('aria-controls="hz-menu"', 'aria-expanded="false"', 'aria-label="Menu"'):
        if attr not in t:
            fail(f"{path}: menu button missing {attr}")
    if 'id="hz-menu"' not in t or 'role="dialog"' not in t or 'aria-modal="true"' not in t:
        fail(f"{path}: mobile menu dialog missing or not modal")
    if "data-hz-menu-close" not in t:
        fail(f"{path}: mobile menu has no close button")
    for r in ROUTES:
        if f'<a href="{r}" data-hz-drawerlink' not in t:
            fail(f"{path}: mobile menu missing {r}")
    if t.count("JOIN THE WAITLIST") < 1:
        fail(f"{path}: mobile menu missing the waitlist action")
    # Active route is baked in at build time: no JS, no flash, works with JS off.
    marked = re.findall(r'<a href="([^"]+)"[^>]*aria-current="page"', t)
    # An article has no navigation entry of its own, so the nav marks the
    # section it lives in; the breadcrumb is what marks the article itself.
    expected = "/blog" if path in ARTICLES else ("/" if path == "/" else path)
    if not marked:
        fail(f"{path}: nothing marked aria-current=\"page\"")
    if set(marked) != {expected}:
        fail(f"{path}: aria-current marks {sorted(set(marked))}, expected only {expected!r}")
    if path in ARTICLES and 'aria-current="page"' not in t[t.index('aria-label="Breadcrumb"'):t.index("</ol>")]:
        fail(f"{path}: the breadcrumb does not mark the current article")

# The footer route row: Home added, two even columns on phones, real hub link.
for path in ("/about", "/contact", "/faq", "/how-it-works", "/accountability-challenges"):
    t = (ROOT / PAGES[path]).read_text()
    row = re.search(r"<nav data-hz-footernav.*?</nav>", t, re.S)
    if not row:
        fail(f"{path}: footer nav missing")
        continue
    row = row.group(0)
    for r in ROUTES:
        if f'href="{r}"' not in row:
            fail(f"{path}: footer nav missing {r}")
    # The legal pair is wrapped in a span so it can sit right on desktop. That
    # wrapper carries an inline display:flex, so without !important it stays a
    # single grid cell on phones and Terms/Privacy fall out of the two columns.
    t_ = (ROOT / PAGES[path]).read_text()
    if "[data-hz-footernav] > span{ display:contents !important }" not in t_:
        fail(f"{path}: footer legal pair will not join the phone grid")

# Legal pages keep their own minimal chrome and counsel's text, untouched.
for path in ("/terms", "/privacy"):
    t = (ROOT / PAGES[path]).read_text()
    if "hz-menu" in t or "data-hz-menu-btn" in t:
        fail(f"{path}: navigation drawer leaked into a legal page")
    if "BACK TO HUNTZ" not in t:
        fail(f"{path}: legal page chrome changed")

# ---- waitlist: still exactly one Mailchimp integration ----
MC_ENDPOINT = "huntz.us18.list-manage.com/subscribe/post"
if home.count(MC_ENDPOINT) != 1:
    fail(f"/: expected 1 Mailchimp endpoint, found {home.count(MC_ENDPOINT)}")
n_email = home.count('type="email"')
if n_email != 2:
    fail(f"/: expected the 2 existing waitlist email inputs, found {n_email}")
if "b_b7144d02c740628b3280ff55f_3ee28a30af" not in home:
    fail("/: Mailchimp honeypot field missing")
if "INTEREST" not in home:
    fail("/: Mailchimp interest capture missing")
for f in [ROOT / v for v in PAGES.values()]:
    t = f.read_text()
    if f.name != "index.html" and MC_ENDPOINT in t:
        fail(f"{f.name}: a second waitlist form appeared off the home page")

# ---- contact form ----
contact = (ROOT / "contact.html").read_text()
for exact in (
    "Questions, partnerships, press, or interested in creating a Hunt? Send us a note.",
    CONTACT_SUCCESS,
    "Message sent.",
    "Send another message",
    "Something went wrong. Please email team@huntz.ai.",
    "We'll use your information only to respond to your message.",
    "Send message",
    "I want to create a Hunt", "Partnership", "Press", "General question", "Website issue",
):
    if exact not in contact:
        fail(f"/contact: exact copy missing: {exact!r}")
if ">team@huntz.ai</a>. We read everything.</p>" not in contact:
    fail("/contact: 'Email: team@huntz.ai. We read everything.' missing or address not linked")
if "We read everything;" in contact:
    fail("/contact: superseded delayed-reply sentence still present")
src = json.loads((ROOT / "build/pages/contact.json").read_text())
if not any(b.get("text") == "Email: team@huntz.ai. We read everything." for b in src["blocks"]):
    fail("/contact: source copy is not the founder's exact sentence")
if 'href="/privacy"' not in contact:
    fail("/contact: privacy line is not linked to /privacy")
if 'id="hzc-company"' not in contact:
    fail("/contact: honeypot field missing")
if "/api/contact" not in contact:
    fail("/contact: form does not post to the same-origin endpoint")
if re.search(r'<form[^>]*action="mailto:', contact):
    fail("/contact: form uses mailto: as its action")
if "tel" in re.findall(r'<input[^>]*type="([a-z]+)"', contact):
    fail("/contact: form asks for a phone number")
for fid in ("hzc-name", "hzc-email", "hzc-reason", "hzc-message"):
    if f'<label for="{fid}"' not in contact:
        fail(f"/contact: {fid} has no visible label")
    if f'aria-describedby="{fid}-err"' not in contact:
        fail(f"/contact: {fid} errors are not associated with the field")
if 'role="status"' not in contact or 'aria-live="polite"' not in contact:
    fail("/contact: submission result is not announced")
# Success replaces the form with its own panel rather than writing a wide
# notification under the button; failure keeps the form and the notification.
if 'id="hz-contact-done"' not in contact or "showSuccess()" not in contact:
    fail("/contact: success state panel missing")
if 'id="hz-contact-done-title" tabindex="-1"' not in contact:
    fail("/contact: success heading cannot receive focus")
if 'role="status"' not in contact:
    fail("/contact: success state is not announced")
if "doneTitle.focus()" not in contact:
    fail("/contact: focus does not move to the success heading")
if 'id="hzc-again"' not in contact:
    fail("/contact: no way back to a clean form")
# An inline display would outrank the [hidden] attribute and leave the card
# rendering under the form on every page load. Assert the invariant itself.
done_tag = re.search(r'<div id="hz-contact-done"[^>]*>', contact)
if not done_tag:
    fail("/contact: success card missing")
elif "display:" in done_tag.group(0):
    fail("/contact: success card carries an inline display that defeats [hidden]")
if "#hz-contact-done[hidden]{ display:none !important }" not in contact:
    fail("/contact: success card has no [hidden] guard")
if "min-height" in (done_tag.group(0) if done_tag else ""):
    fail("/contact: success card reserves height instead of staying compact")
# The card matches the page's own card language, and carries its own indicator.
for token in ("border-radius:18px", "border:1px solid rgba(22,19,14,.14)",
              "linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.34))"):
    if done_tag and token not in done_tag.group(0):
        fail(f"/contact: success card does not use the site card treatment ({token})")
if '<span aria-hidden="true"' not in contact or "<svg" not in contact:
    fail("/contact: success card has no checkmark indicator")
check_svg = re.search(r'<span aria-hidden="true"[^>]*>\s*<svg', contact)
if not check_svg:
    fail("/contact: the checkmark is not hidden from assistive technology")
if "say(SUCCESS)" in contact or "say('Thanks" in contact:
    fail("/contact: the wide success notification is back under the button")

# Both terminal UI states, and the guard that stops a second send while one is
# still in flight, must survive any future edit of the page script.
for behaviour in ("submit.disabled = on", "if (busy) return", "form.reset()", "setBusy(false)"):
    if behaviour not in contact:
        fail(f"/contact: submit-state behaviour missing: {behaviour!r}")
if "novalidate" not in contact:
    fail("/contact: form does not defer to its own accessible validation")

# ---- no credential or environment value may reach a generated page ----
API = ROOT / "api"
SECRET_NAMES = ("HUNTZ_SMTP_PASSWORD",)
for f in [ROOT / v for v in PAGES.values()] + sorted(ROOT.glob("assets/*")):
    t = f.read_text()
    for n in SECRET_NAMES:
        if n in t:
            fail(f"{f.name}: environment variable {n} referenced in a client artifact")
    if "smtppro.zoho.com" in t or "AUTH LOGIN" in t:
        fail(f"{f.name}: SMTP details leaked into a client artifact")
if API.exists():
    js = sorted(API.rglob("*.js"))
    if len(js) != 2:
        fail(f"api/: expected 2 files (the endpoint and its validator), found {len(js)}")
    for f in js:
        t = f.read_text()
        for n in SECRET_NAMES:
            # Names are fine; a literal default value next to one is not.
            m = re.search(re.escape(n) + r"\s*(?:\|\||=)\s*['\"]([^'\"]+)['\"]", t)
            if m:
                fail(f"api/{f.name}: {n} has a hard-coded value")


# ---- blog (2026-08-14) ----
BLOG_SOURCES = sorted((ROOT / "build/blog").glob("*.json"))
if len(BLOG_SOURCES) != len(ARTICLES):
    fail(f"blog: {len(BLOG_SOURCES)} source files but {len(ARTICLES)} routes expected")

blog_index = (ROOT / "blog.html").read_text()

for route in ARTICLES:
    t = (ROOT / PAGES[route]).read_text()
    slug = route.rsplit("/", 1)[1]
    src = json.loads((ROOT / f"build/blog/{slug}.json").read_text())

    # Structured data: a real BlogPosting whose identity matches the route.
    blocks = {}
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', t, re.S):
        try:
            b = json.loads(m.group(1))
        except json.JSONDecodeError as e:
            fail(f"{route}: invalid JSON-LD ({e})")
            continue
        blocks[b.get("@type")] = b
    post = blocks.get("BlogPosting")
    if not post:
        fail(f"{route}: BlogPosting structured data missing")
    else:
        if post.get("headline") != src["title"]:
            fail(f"{route}: BlogPosting headline does not match the source title")
        if post.get("url") != SITE + route:
            fail(f"{route}: BlogPosting url is {post.get('url')!r}")
        if post.get("datePublished") != src["published"]:
            fail(f"{route}: BlogPosting datePublished does not match the source")
        if (post.get("author") or {}).get("name") != src["author"]:
            fail(f"{route}: BlogPosting author does not match the source")
        if not str((post.get("publisher") or {}).get("logo", {}).get("url", "")).startswith(SITE):
            fail(f"{route}: BlogPosting publisher logo is not an absolute Huntz URL")
    crumb = blocks.get("BreadcrumbList")
    if not crumb or len(crumb.get("itemListElement", [])) != 3:
        fail(f"{route}: breadcrumb structured data should be Huntz > Blog > article")

    # Visible publication metadata, and the reading time the layout derives.
    if f'datetime="{src["published"]}"' not in t:
        fail(f"{route}: publication date missing from the page")
    if src["author"] not in t:
        fail(f"{route}: author missing from the page")
    if not re.search(r"\d+ min read", t):
        fail(f"{route}: reading time missing from the page")
    if 'aria-label="Breadcrumb"' not in t:
        fail(f"{route}: visible breadcrumbs missing")
    if "data-hz-toc" not in t:
        fail(f"{route}: table of contents missing")

    # Every h2 the source declares should be reachable from the contents list.
    for b in src["blocks"]:
        if b["type"] == "h2":
            head = re.sub(r"<[^>]+>", "", b["text"])
            if head.split(" ")[0] not in t:
                fail(f"{route}: section {head!r} did not render")

    # Article-to-article and article-to-product links, and the real CTA.
    others = [r for r in ARTICLES if r != route]
    if not any(f'href="{o}"' in t for o in others):
        fail(f"{route}: does not link to the other article")
    if 'href="/how-it-works"' not in t:
        fail(f"{route}: does not link to the how-it-works page")
    if 'href="/#waitlist"' not in t:
        fail(f"{route}: does not use the real waitlist CTA")

    # External citations open safely and are absolute.
    for href in re.findall(r'<a href="(https://[^"]+)"[^>]*>', t):
        tag = re.search(r'<a href="' + re.escape(href) + r'"[^>]*>', t).group(0)
        if 'rel="noopener noreferrer"' not in tag or 'target="_blank"' not in tag:
            fail(f"{route}: external link {href} is not target=_blank + rel=noopener noreferrer")

    # No placeholder or dead internal link.
    for href in re.findall(r'<a [^>]*href="(/[^"#][^"]*)"', t):
        clean = href.split("#")[0].rstrip("/")
        if clean and clean not in PAGES and not (ROOT / clean.lstrip("/")).exists():
            fail(f"{route}: internal link {href} goes nowhere")

# The comparison table restacks rather than overflowing on a phone.
comp = (ROOT / PAGES["/blog/best-accountability-apps-2026"]).read_text()
if "data-hz-table" not in comp:
    fail("/blog/best-accountability-apps-2026: comparison table missing")
if comp.count("data-label=") < 21:
    fail("/blog/best-accountability-apps-2026: table cells are not labelled for the stacked layout")
if "[data-hz-table] thead{ display:none }" not in comp:
    fail("/blog/best-accountability-apps-2026: table does not restack on mobile")
if "Disclosure:" not in comp:
    fail("/blog/best-accountability-apps-2026: the Huntz disclosure is missing")

# The index lists every article, and the blog is reachable from the navigation.
for route in ARTICLES:
    if f'href="{route}"' not in blog_index:
        fail(f"/blog: index does not link to {route}")
if blog_index.count("data-hz-post") < len(ARTICLES):
    fail("/blog: an article card is missing")
for path, fname in PAGES.items():
    if path in ARTICLES or path in ("/terms", "/privacy"):
        continue
    if 'href="/blog"' not in (ROOT / fname).read_text():
        fail(f"{path}: /blog is not reachable from the navigation")

# Sitemap already checked above against PAGES; assert the blog routes explicitly.
sitemap_text = (ROOT / "sitemap.xml").read_text()
for route in ["/blog"] + ARTICLES:
    if f"<loc>{SITE}{route}</loc>" not in sitemap_text:
        fail(f"sitemap missing {route}")

# ---- universal links: AASA + the /hunt fallback (2026-08-22) ----
# A wrong appID, an accidentally indexed invitation page, or a referral token
# that survives into the HTML all fail silently in production, so each is
# asserted here rather than left to review.
AASA_FILES = [".well-known/apple-app-site-association", "apple-app-site-association"]
aasa_raw = {}
for rel in AASA_FILES:
    f = ROOT / rel
    if not f.exists():
        fail(f"AASA missing at /{rel}")
        continue
    aasa_raw[rel] = f.read_text()

if len(aasa_raw) == len(AASA_FILES) and len(set(aasa_raw.values())) != 1:
    fail("AASA copies differ between /.well-known and the root path")

if aasa_raw:
    rel, raw = sorted(aasa_raw.items())[0]
    try:
        aasa = json.loads(raw)
    except json.JSONDecodeError as e:
        aasa = None
        fail(f"AASA is not valid JSON: {e}")

    if aasa is not None:
        try:
            detail, = aasa["applinks"]["details"]
            app_ids = detail["appIDs"]
            components = detail["components"]
            webcredential_apps = aasa["webcredentials"]["apps"]
        except (KeyError, TypeError, ValueError) as e:
            detail = app_ids = components = webcredential_apps = None
            fail(f"AASA is not in the expected applinks/webcredentials shape: {e}")

        # A placeholder that reaches production breaks universal links with no
        # visible symptom, so the app id is pattern-checked, not eyeballed.
        PLACEHOLDERS = ("REALTEAMID", "TEAMID", "APPLE_TEAM_ID", "ABCDE12345",
                        "XXXXXXXXXX", "YOURTEAMID", "TODO", "CHANGEME")
        # Read from the signed Build 7 provisioning profile, whose entitlement is
        # applinks:huntz.ai. Pinned rather than merely pattern-checked because an
        # earlier, well-formed but WRONG candidate (GDRCC5G29F, taken from a
        # development certificate) very nearly shipped, and a wrong team id
        # breaks universal links with no visible symptom.
        EXPECTED_APP_ID = "JVTW9DH25L.ai.huntz.app"
        if webcredential_apps != [EXPECTED_APP_ID]:
            fail(f"AASA: webcredentials apps is {webcredential_apps!r}, expected "
                 f"[{EXPECTED_APP_ID!r}]")
        if app_ids is not None:
            if len(app_ids) != 1:
                fail(f"AASA: expected exactly one appID, found {len(app_ids)}")
            for app_id in app_ids:
                team, _, bundle = app_id.partition(".")
                if bundle != "ai.huntz.app":
                    fail(f"AASA: appID bundle is {bundle!r}, expected 'ai.huntz.app'")
                if not re.fullmatch(r"[A-Z0-9]{10}", team):
                    fail(f"AASA: {team!r} is not a 10-character Apple Team ID")
                if any(ph in app_id.upper() for ph in PLACEHOLDERS):
                    fail(f"AASA: appID {app_id!r} contains a placeholder identifier")
                if app_id != EXPECTED_APP_ID:
                    fail(f"AASA: appID is {app_id!r}, expected {EXPECTED_APP_ID!r} from "
                         "the signed Build 7 provisioning profile")

        # Evaluate the components the way Apple does, so the assertions below are
        # about real matching behaviour rather than the presence of a substring.
        # Every omitted key defaults to "*", which matches everything - including
        # an absent component. That is why a missing "/" has to match ANY path
        # rather than be skipped: an entry like {"?": {"utm_source": "*"}} would
        # associate the whole site, and skipping it would let that through.
        def _glob(pat):
            return "".join(".*" if ch == "*" else "." if ch == "?" else re.escape(ch)
                           for ch in str(pat))

        def _matches(components, path, query=""):
            parsed = dict(urllib.parse.parse_qsl(query, keep_blank_values=True))
            for c in components:
                if not re.fullmatch(_glob(c.get("/", "*")), path):
                    continue
                q = c.get("?")
                if isinstance(q, dict):
                    if not all(k in parsed and re.fullmatch(_glob(v), parsed[k])
                               for k, v in q.items()):
                        continue
                elif isinstance(q, str):
                    if not re.fullmatch(_glob(q), query):
                        continue
                if not re.fullmatch(_glob(c.get("#", "*")), ""):
                    continue
                return not c.get("exclude", False)
            return False

        if components is not None:
            # Invitations, with and without a referral token, must be associated.
            for path, query in [("/hunt/abc123", ""),
                                ("/hunt/abc123", "ref=SOMETOKEN"),
                                ("/hunt/01HZY9K3", "ref=a&utm_source=x"),
                                ("/hunt", ""),
                                ("/auth/callback", ""),
                                ("/auth/callback", "code=SOMEPKCECODE"),
                                ("/mailbox/gmail-action/pair", "pairingId=test&pairingCode=test&signature=test"),
                                ("/auth/callback", "error=access_denied")]:
                if not _matches(components, path, query):
                    fail(f"AASA does not associate /hunt path {path!r} (query {query!r})")
            # Nothing else may leave the browser for the app. Each is tried bare
            # AND with a query, because a component can match on the query alone -
            # {"?": {"utm_source": "*"}} with no "/" key would associate the whole
            # site, and a bare-path check would never notice.
            for path in ["/", "/about", "/contact", "/faq", "/how-it-works",
                         "/accountability-challenges", "/blog",
                         "/blog/best-accountability-apps-2026", "/terms", "/privacy",
                         "/hunts/abc", "/.well-known/apple-app-site-association",
                         "/auth", "/auth/other", "/auth/callbackx", "/auth/reset",
                         "/authx/callback", "/mailbox", "/mailbox/gmail-action/pairx"]:
                for query in ["", "utm_source=x", "ref=y", "code=z", "a=1&b=2"]:
                    if _matches(components, path, query):
                        fail(f"AASA associates unrelated route {path} (query {query!r})")

hunt_file = ROOT / "hunt.html"
if not hunt_file.exists():
    fail("hunt.html was not generated")
else:
    hunt = hunt_file.read_text()

    # The page is one static file served for every invitation. Nothing in it may
    # read the query string, and nothing may carry an id or token into a request.
    for banned, why in [
        ("location.search", "reads the query string"),
        ("URLSearchParams", "parses the query string"),
        ("searchParams", "parses the query string"),
        ("location.href", "captures the full URL including ?ref="),
        ("document.referrer", "captures the referring URL"),
        ("fetch(", "makes a network request"),
        ("XMLHttpRequest", "makes a network request"),
        ("navigator.sendBeacon", "exfiltrates to an endpoint"),
        ("localStorage", "persists invitation data"),
        ("sessionStorage", "persists invitation data"),
        ("document.cookie", "persists invitation data"),
        ("location.replace", "redirects in JavaScript"),
        ("location.assign", "redirects in JavaScript"),
        ("huntz://", "uses a custom-scheme trick"),
        # The mirror image of the /auth/callback rule. An auth code must not
        # survive in the URL; an invitation must, because the recipient has to
        # reopen this exact link after installing the app. Stripping it here
        # would quietly make every invitation single-use.
        ("history.replaceState", "rewrites the URL, so the invitation could not be reopened"),
        ("history.pushState", "rewrites the URL, so the invitation could not be reopened"),
    ]:
        if banned in hunt:
            fail(f"hunt.html {why} ({banned!r}) - referral tokens must never be read")

    # No hunt id or referral token can be baked in: the file is constant.
    for leak in ["?ref=", "&ref=", "abc123"]:
        if leak in hunt:
            fail(f"hunt.html contains {leak!r} - the served bytes must be invitation-agnostic")

    if '<meta name="robots" content="noindex">' not in hunt:
        fail("hunt.html is not noindex")
    if "<link rel=\"canonical\"" in hunt:
        fail("hunt.html declares a canonical - it is one file for many URLs")
    if 'href="/#waitlist"' not in hunt:
        fail("hunt.html does not offer the real waitlist CTA")
    if "limited beta" not in hunt:
        fail("hunt.html does not explain that Huntz is in limited beta")
    if "reopen" not in hunt.lower() and "open the original invitation" not in hunt.lower():
        fail("hunt.html does not tell the recipient to reopen the invitation after installing")

    # Claims Huntz cannot make yet.
    for phrase in ["App Store", "apps.apple.com", "TestFlight", "testflight.apple.com",
                   "Download the app", "automatically join", "automatically added"]:
        if phrase.lower() in hunt.lower():
            fail(f"hunt.html claims {phrase!r}, which is not true of a limited beta")

    if f"<loc>{SITE}/hunt" in (ROOT / "sitemap.xml").read_text():
        fail("sitemap lists a /hunt URL - invitation pages must stay unindexed")

# Hosting wiring. Vercel reserves /.well-known from redirects and rewrites, so
# the file has to be a real static asset; assert nothing has started routing it.
vercel = json.loads((ROOT / "vercel.json").read_text())
rewrites = vercel.get("rewrites", [])
# The destination is the clean URL, not hunt.html: cleanUrls serves the file at
# /hunt and 308s the .html path, so /hunt.html does not resolve as a rewrite
# target. ":path+" rather than ":path*" keeps /hunt from matching its own rewrite.
if not any(r.get("source") == "/hunt/:path+" and r.get("destination") == "/hunt"
           for r in rewrites):
    fail("vercel.json does not rewrite /hunt/<id> to the /hunt page")
# Vercel reserves /.well-known from redirects and rewrites. Whether a rule would
# actually move the file is asserted behaviourally by the routing matrix further
# down; here we only bar a REWRITE from targeting it, which the matrix does not
# model.
def _rewrite_regex(src: str) -> str:
    """path-to-regexp params as a regex: ":n*" spans segments, ":n+" needs one, ":n" is one."""
    src = re.sub(r":[A-Za-z_][A-Za-z0-9_]*\*", ".*", src)
    src = re.sub(r":[A-Za-z_][A-Za-z0-9_]*\+", ".+", src)
    return re.sub(r":[A-Za-z_][A-Za-z0-9_]*", "[^/]+", src)


for rule in rewrites:
    if re.fullmatch(_rewrite_regex(rule.get("source", "")),
                    "/.well-known/apple-app-site-association"):
        fail("a rewrite would move /.well-known, which Vercel reserves")
# A page that receives single-use auth codes must not be stored anywhere, and the
# header form of the referrer policy beats the meta tag where both apply.
cb_hdrs = next((h for h in vercel.get("headers", []) if h.get("source") == "/auth/callback"), None)
if cb_hdrs is None:
    fail("vercel.json sets no headers for /auth/callback")
else:
    got = {k.get("key", "").lower(): k.get("value", "") for k in cb_hdrs.get("headers", [])}
    if got.get("cache-control") != "no-store":
        fail("/auth/callback is not sent with Cache-Control: no-store")
    if got.get("referrer-policy") != "no-referrer":
        fail("/auth/callback is not sent with Referrer-Policy: no-referrer")
    if got.get("x-content-type-options") != "nosniff":
        fail("/auth/callback is not sent with X-Content-Type-Options: nosniff")
    csp = got.get("content-security-policy", "")
    for directive in ["default-src 'none'", "frame-ancestors 'none'", "form-action 'none'"]:
        if directive not in csp:
            fail(f"/auth/callback CSP is missing {directive!r}")

for rel in AASA_FILES:
    entry = next((h for h in vercel.get("headers", []) if h.get("source") == "/" + rel), None)
    if entry is None:
        fail(f"vercel.json sets no headers for /{rel}")
    elif not any(k.get("key", "").lower() == "content-type"
                 and k.get("value") == "application/json" for k in entry.get("headers", [])):
        fail(f"vercel.json does not serve /{rel} as application/json")


# ---- auth callback fallback + apex routing (2026-08-22, Option B) ----
cb_file = ROOT / "auth" / "callback.html"
if not cb_file.exists():
    fail("auth/callback.html was not generated")
else:
    cb = cb_file.read_text()

    # The page is loaded with a single-use auth code in its query string. It may
    # READ the URL - it has to, to tell success from an expired link - but it may
    # never render a value from it, never transmit one, and never persist one.
    for banned, why in [
        ("innerHTML", "writes markup, so a URL value could reach the DOM"),
        ("insertAdjacentHTML", "writes markup, so a URL value could reach the DOM"),
        ("textContent", "writes text, so a URL value could reach the DOM"),
        ("document.write", "writes markup, so a URL value could reach the DOM"),
        ("fetch(", "makes a network request"),
        ("XMLHttpRequest", "makes a network request"),
        ("navigator.sendBeacon", "exfiltrates to an endpoint"),
        ("localStorage", "persists an auth value"),
        ("sessionStorage", "persists an auth value"),
        ("document.cookie", "persists an auth value"),
        ("error_description", "would render Supabase's attacker-controllable text"),
        ("URLSearchParams", "extracts a value from the URL; only presence may be tested"),
        ("searchParams", "extracts a value from the URL; only presence may be tested"),
        (".exec(", "captures a value from the URL; only presence may be tested"),
    ]:
        if banned in cb:
            fail(f"auth/callback.html {why} ({banned!r})")

    # The single-use code must not survive in the address bar or in history.
    if "history.replaceState" not in cb:
        fail("auth/callback.html does not clear the query and fragment from history")
    if '<meta name="referrer" content="no-referrer">' not in cb:
        fail("auth/callback.html does not set a no-referrer policy, so the code would "
             "ride along in subresource Referer headers and into the access log")
    # The referrer policy is only useful if it is parsed before the stylesheet.
    ref_at, css_at = cb.find('name="referrer"'), cb.find('<link rel="stylesheet"')
    if ref_at >= 0 and css_at >= 0 and ref_at > css_at:
        fail("auth/callback.html declares its referrer policy after the stylesheet link")

    if '<meta name="robots" content="noindex">' not in cb:
        fail("auth/callback.html is not noindex")
    if '<link rel="canonical"' in cb:
        fail("auth/callback.html declares a canonical - it is one file for many URLs")

    # No specimen auth value may be baked into the served bytes.
    for leak in ["?code=", "&code=", "access_token", "refresh_token", "token_hash",
                 "@gmail.com", "@huntz.ai"]:
        if leak in cb:
            fail(f"auth/callback.html contains {leak!r} - the served bytes must be "
                 "account-agnostic")

    # Copy: truthful about what actually happens next.
    # A spent password-reset link must never be told its email was confirmed.
    if "flow=recovery" not in cb:
        fail("auth/callback.html cannot tell a password reset from a signup confirmation")
    if 'href="huntz://"' not in cb:
        fail("auth/callback.html does not offer the approved custom-scheme app fallback")
    if "sign in" not in cb.lower():
        fail("auth/callback.html does not tell the user they still need to sign in")
    for phrase in ["App Store", "apps.apple.com", "TestFlight", "testflight.apple.com",
                   "automatically signed in", "you are now signed in", "signed you in"]:
        if phrase.lower() in cb.lower():
            fail(f"auth/callback.html claims {phrase!r}, which it must not")
    # Neutral is the no-JS default. "Confirmed" must never be what someone sees
    # without positive evidence in the URL: mail scanners prefetch these links
    # and burn the token, so a bare visit is not proof that anything worked.
    for block in ("neutral", "ok", "error", "recovery"):
        if f'data-when="{block}"' not in cb:
            fail(f"auth/callback.html has no {block} branch")
    if "[data-when]{ display:none }" not in cb or \
       '[data-when="neutral"]{ display:block }' not in cb:
        fail("auth/callback.html does not default to the neutral branch")
    for state in ("ok", "error", "recovery"):
        if f'html[data-auth="{state}"] [data-when="{state}"]{{ display:block }}' not in cb:
            fail(f"auth/callback.html never reveals its {state} branch")
    if 'data-auth="ok"' in cb[:cb.index("<style")]:
        fail("auth/callback.html hard-codes the confirmed state")

    if f"<loc>{SITE}/auth" in (ROOT / "sitemap.xml").read_text():
        fail("sitemap lists /auth/callback - it must stay unindexed")

# The entitlement signed into Build 7 is applinks:huntz.ai - the bare apex. That
# is only meaningful if the apex serves the file itself, which is what the
# routing matrix below proves. Recorded here so the connection is not lost.
SIGNED_ASSOCIATED_DOMAIN = "applinks:huntz.ai"

# Production routing, simulated. The apex redirect is the one change here that can
# take the live marketing site down: if the host condition matched www as well as
# the apex, every www request would redirect to itself in a loop. So rather than
# trusting one reading of Vercel's matching rules, the rule is evaluated under
# BOTH possible semantics - an unanchored regex search, and Vercel wrapping the
# value as ^(?:value)$ - and required to behave identically and correctly under
# each. Writing the value with explicit anchors is what makes that true.
vercel = json.loads((ROOT / "vercel.json").read_text())
redirects = vercel.get("redirects", [])
if len(redirects) != 1:
    fail(f"expected exactly one redirect rule, found {len(redirects)}")
else:
    rule = redirects[0]

    def host_matches(value, host, wrap):
        rx = f"^(?:{value})$" if wrap else value
        return re.search(rx, host) is not None

    def source_matches(source, path):
        # path-to-regexp compiles "/(<re>)" to "^/(<re>)" with an optional
        # trailing delimiter; Vercel matches the pathname only, never the query.
        return re.fullmatch(source.replace("(?!", "(?!") + r"[/#?]?", path) \
            or re.fullmatch(source, path)

    def outcome(host, path, wrap):
        if not host_matches(rule["has"][0]["value"], host, wrap):
            return "SERVE"
        m = source_matches(rule["source"], path)
        if not m:
            return "SERVE"
        return rule["destination"].replace("$1", m.group(1))

    APEX, WWW = "huntz.ai", "www.huntz.ai"
    MATRIX = [
        # The apex serves these directly. Everything Apple fetches, plus the two
        # universal-link paths: an auth callback in particular must never be
        # bounced to another origin carrying its code.
        (APEX, "/.well-known/apple-app-site-association", "SERVE"),
        (APEX, "/apple-app-site-association", "SERVE"),
        (APEX, "/hunt", "SERVE"),
        (APEX, "/hunt/test-hunt", "SERVE"),
        (APEX, "/hunt/test-hunt/", "SERVE"),
        (APEX, "/auth/callback", "SERVE"),
        # A trailing slash must not push a path back into the cross-host
        # redirect - least of all the auth callback, which would carry its
        # single-use code to another origin.
        (APEX, "/auth/callback/", "SERVE"),
        (APEX, "/apple-app-site-association/", "SERVE"),
        # The two apex-served pages load these, and /auth/callback ships a CSP
        # whose 'self' is the apex. Bounced to www they would be refused as
        # cross-origin and the page would render unstyled.
        (APEX, "/assets/fonts.601bc53b.css", "SERVE"),
        (APEX, "/favicon.ico", "SERVE"),
        (APEX, "/favicon-48x48.png", "SERVE"),
        (APEX, "/icon-192.png", "SERVE"),
        (APEX, "/icon-512.png", "SERVE"),
        (APEX, "/apple-touch-icon.png", "SERVE"),
        # Ordinary apex marketing traffic still goes to the canonical www host.
        (APEX, "/", "https://www.huntz.ai/"),
        (APEX, "/about", "https://www.huntz.ai/about"),
        (APEX, "/how-it-works", "https://www.huntz.ai/how-it-works"),
        (APEX, "/faq", "https://www.huntz.ai/faq"),
        (APEX, "/blog", "https://www.huntz.ai/blog"),
        (APEX, "/blog/best-accountability-apps-2026",
               "https://www.huntz.ai/blog/best-accountability-apps-2026"),
        (APEX, "/contact", "https://www.huntz.ai/contact"),
        (APEX, "/terms", "https://www.huntz.ai/terms"),
        (APEX, "/privacy", "https://www.huntz.ai/privacy"),
        (APEX, "/accountability-challenges",
               "https://www.huntz.ai/accountability-challenges"),
        (APEX, "/sitemap.xml", "https://www.huntz.ai/sitemap.xml"),
        # Near-misses must not be mistaken for the exempt paths.
        (APEX, "/hunts/foo", "https://www.huntz.ai/hunts/foo"),
        (APEX, "/apple-app-site-association-x",
               "https://www.huntz.ai/apple-app-site-association-x"),
        (APEX, "/auth/callbackx", "https://www.huntz.ai/auth/callbackx"),
        (APEX, "/auth/other", "https://www.huntz.ai/auth/other"),
        (APEX, "/assetsx/a.css", "https://www.huntz.ai/assetsx/a.css"),
        (APEX, "/iconography.png", "https://www.huntz.ai/iconography.png"),
        (APEX, "/api/contact", "https://www.huntz.ai/api/contact"),
        # THE LOOP TEST. www is the canonical host and must never be redirected,
        # whatever the path, under either matching semantics.
        (WWW, "/", "SERVE"),
        (WWW, "/about", "SERVE"),
        (WWW, "/blog", "SERVE"),
        (WWW, "/hunt/test-hunt", "SERVE"),
        (WWW, "/auth/callback", "SERVE"),
        (WWW, "/.well-known/apple-app-site-association", "SERVE"),
    ]
    for wrap in (False, True):
        how = "wrapped as ^(?:v)$" if wrap else "unanchored search"
        for host, path, expected in MATRIX:
            got = outcome(host, path, wrap)
            if got != expected:
                fail(f"routing ({how}): {host}{path} -> {got}, expected {expected}")

    # The AASA must be unreachable by any future redirect, not merely by this one.
    for r in redirects + vercel.get("rewrites", []):
        for aasa_path in ["/.well-known/apple-app-site-association",
                          "/apple-app-site-association"]:
            if r in redirects:
                if outcome(APEX, aasa_path, True) != "SERVE" or \
                   outcome(WWW, aasa_path, True) != "SERVE":
                    fail(f"a redirect rule would move {aasa_path}")
            elif re.fullmatch(r["source"].replace(":path*", ".*"), aasa_path):
                fail(f"a rewrite rule would move {aasa_path}")


if failures:
    print(f"FAIL ({len(failures)}):")
    for m in failures:
        print("  -", m)
    sys.exit(1)
print(f"OK: {len(PAGES)} pages, {len(titles)} unique titles, sitemap + robots + icons verified")
print(f"OK: AASA at {len(AASA_FILES)} paths for {EXPECTED_APP_ID}, {SIGNED_ASSOCIATED_DOMAIN}, /hunt fallback token-safe")
print(f"OK: /auth/callback fallback code-safe, apex routing matrix {len(MATRIX)}x2 verified")
