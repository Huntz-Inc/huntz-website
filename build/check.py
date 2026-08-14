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
}

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
    expected = "/" if path == "/" else path
    if not marked:
        fail(f"{path}: nothing marked aria-current=\"page\"")
    if set(marked) != {expected}:
        fail(f"{path}: aria-current marks {sorted(set(marked))}, expected only {expected!r}")

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

if failures:
    print(f"FAIL ({len(failures)}):")
    for m in failures:
        print("  -", m)
    sys.exit(1)
print(f"OK: {len(PAGES)} pages, {len(titles)} unique titles, sitemap + robots + icons verified")
