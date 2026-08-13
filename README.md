# Huntz — waitlist landing page

The pre-launch marketing site for [Huntz](https://huntz.ai), the marketplace for
accountability. One self-contained page: no framework to install, no build step
at deploy time, and no external requests at page-view time — React, the design
runtime, the webfonts, and every graphic are inlined into `index.html`.

This repo is **only** the public marketing site. The Huntz product itself lives
in a separate private repo.

```
index.html                       the landing page
about.html … how-it-works.html   marketing pages     → served at /about etc.
terms.html, privacy.html         legal pages         → /terms, /privacy
assets/                          hashed shared assets (fonts css, app js)
robots.txt, sitemap.xml          crawl controls
favicon.ico, apple-touch-icon.png, icon-512.png, og-image.jpg   icons + share card
build/                           the build pipeline (see "Rebuilding")
```


`vercel.json` sets `cleanUrls`, which is what serves `terms.html` at `/terms`.
The landing page also still answers the older `#/terms` and `#/privacy` routes
in-page, so links shared before the real pages existed keep working.

## Deploying

`index.html` at the repo root is a complete static site, so any static host
works with zero configuration.

**Vercel:** import the repo, leave the framework preset as *Other*, and leave
the build command and output directory empty. Vercel serves `index.html`
directly. Every push to `main` redeploys.

**Custom domain:** add `huntz.ai` (and `www.huntz.ai`) under the project's
Domains settings, then point DNS at Vercel from the GoDaddy DNS panel. Note the
existing `A @ → WebsiteBuilder Site` record must be replaced, or GoDaddy will
keep serving its parking page.

Social previews reference `https://huntz.ai/og-image.png` absolutely, so link
previews stay blank until the site answers on that domain. To deploy somewhere
else, change `SITE_URL` in `build/assemble.py` and rebuild.

## Local preview

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` from disk works too —
everything is inlined — but a server matches production more closely.

## The waitlist

Both signup forms post to Mailchimp (audience `huntz.us18`) using Mailchimp's
JSONP endpoint, so there is no backend to run and no API key in this repo. The
`u`/`id` pair in `build/assemble.py` is the same public identifier Mailchimp
puts in any embedded form — it is not a secret.

Behaviour worth knowing:

- Invalid addresses are rejected client-side, then Mailchimp's own message
  (e.g. "This email address looks fake or invalid") is shown inline.
- Someone already on the list is treated as success, not an error.
- Clicking a card in **Upcoming** attaches that Hunt's name and submits it as
  the `INTEREST` merge field. Capturing it requires an `INTEREST` text field on
  the Mailchimp audience; without one, Mailchimp silently drops the value.
- The audience is single opt-in, so Mailchimp sends nothing on signup. The page
  shows its own confirmation. A welcome email needs a Mailchimp automation, and
  is best set up *after* sending-domain authentication so it comes from
  `@huntz.ai` rather than via Mailchimp's domain.

## Rebuilding

Edit `build/assemble.py` (or `build/legal-overlay.html` for the Terms and
Privacy documents), then:

```bash
python3 build/legal_build.py   # only when the legal text changed
python3 build/assemble.py
python3 build/check.py         # route/metadata/copy/nav validation
```

That regenerates every page. Marketing-page copy lives in `build/pages/*.json`
as typed blocks; the legal documents come from `build/source/legal/`. **Do not hand-edit `index.html`** — it is
generated, and the next build overwrites it.

The script takes the immutable Claude Design export in `build/source/` and
applies every change as an explicit, asserted patch, so each deviation from the
original design is documented in one place and a failed assertion means the
upstream design moved rather than silently producing a broken page.

Changes currently applied on top of the design:

- Footer **Contact** goes to `team@huntz.ai`; Blog, Careers and the social
  buttons are removed until those exist.
- The FAQ fee answer avoids naming a percentage until the product config
  settles it.
- Terms of Service and Privacy Policy are added as hash-routed full pages
  (`#/terms`, `#/privacy`) — **drafts, pending legal review**.
- Social/OG metadata, a favicon, and the share card.
- Upcoming cards became explicit "I want this hunt" actions with a removable
  chip, so a curious click cannot silently record an interest.
- Keyboard support and focus rings on the FAQ and cards; muted grey darkened
  for contrast.
- Below 641px the bar is logo + menu button, and a modal sheet carries every
  route plus the waitlist action. One route table in `build/assemble.py`
  generates the header, the sheet and the footers, and stamps the active
  route at build time, so there is no route list to keep in sync by hand and
  no JavaScript is needed to show which page you are on.
- Real email validation with busy and error states.
- Removed `scroll-behavior: smooth`, which stopped every nav link from working:
  the page's 60 fps animation loop cancelled each in-flight smooth scroll.
  Trackpad scrolling was unaffected, which is why it went unnoticed.

## Credits

Designed in Claude Design; assembled into a single deployable file with
[Claude Code](https://claude.com/claude-code).
