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
if "48H" in home or "48 hours" in home:
    fail("/: unsupported 48-hour settlement promise present")
if "IN PRE-LAUNCH" in home:
    fail("/: removed hero pre-launch disclaimer has reappeared")
for link in ("/how-it-works", "/accountability-challenges", "/faq", "/about", "/contact", "/terms", "/privacy"):
    if f'href="{link}"' not in home:
        fail(f"/: footer link to {link} missing")

# Content pages: no em dashes in marketing copy (legal keeps counsel's own).
for path in ("/about", "/contact", "/faq", "/how-it-works", "/accountability-challenges"):
    t = (ROOT / PAGES[path]).read_text()
    body = t[t.index("<main"):]
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

# icons and share images
for f in ("favicon.ico", "apple-touch-icon.png", "icon-512.png", "og-image.jpg"):
    if not (ROOT / f).exists():
        fail(f"{f} missing")

if failures:
    print(f"FAIL ({len(failures)}):")
    for m in failures:
        print("  -", m)
    sys.exit(1)
print(f"OK: {len(PAGES)} pages, {len(titles)} unique titles, sitemap + robots + icons verified")
