# Huntz — waitlist landing page

The pre-launch marketing site for [Huntz](https://huntz.ai), the marketplace for
accountability. The pages are built ahead of time and committed, so nothing is
compiled at deploy time and nothing is fetched at page-view time — React, the
design runtime, the webfonts, and every graphic are inlined into `index.html`.
The one dependency in the repo is a mail client for the contact function; Vercel
installs it for that function alone and the pages are served exactly as
committed.

This repo is **only** the public marketing site. The Huntz product itself lives
in a separate private repo.

```
index.html                       the landing page
about.html … how-it-works.html   marketing pages     → served at /about etc.
terms.html, privacy.html         legal pages         → /terms, /privacy
assets/                          hashed shared assets (fonts css, app js)
robots.txt, sitemap.xml          crawl controls
favicon.ico, apple-touch-icon.png, icon-512.png, og-image.jpg   icons + share card
api/                             the contact endpoint (see "The contact form")
test/                            its tests: npm test
build/                           the build pipeline (see "Rebuilding")
```

`.vercelignore` keeps `build/` and `test/` out of the deployment, so no build
script or test file is fetchable from the live site. Deleting it changes nothing
about how the site renders; it only makes those paths public again.

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
- The cards under **Upcoming** come from the live public Discover list,
  cached for five minutes. The dated `LIVE_HUNTS` cards in `build/assemble.py`
  remain the outage fallback. Each links to `https://huntz.ai/hunt/<id>`,
  allowing an iPhone tap from www to open the app. They used to attach an
  interest to the waitlist signup; the `INTEREST` merge field is still sent,
  empty, so the Mailchimp audience needs no change either way.
- The audience is single opt-in, so Mailchimp sends nothing on signup. The page
  shows its own confirmation. A welcome email needs a Mailchimp automation, and
  is best set up *after* sending-domain authentication so it comes from
  `@huntz.ai` rather than via Mailchimp's domain.

## App Store launch switch

*(2026-09-25, founder decision)* One constant flips the home page, and the
shared mobile drawer on every page, from "join the waitlist" to "download on
the App Store": `APP_STORE_URL` in `build/assemble.py`, defined with the rest
of the App Store launch switch patch. It is empty by default, which renders
every page exactly as it does today. Like the rest of `index.html`, nothing
here is hand-edited: `APP_STORE_URL` feeds both `index.html`'s `Component`
class field (sitting next to `WAITLIST_ENDPOINT`) and the shared drawer
(`build/assemble.py`'s `drawer()`) directly, so one rebuild keeps both in
sync.

*(Update, 2026-10-09)* The switch is on. `APP_STORE_URL` has pointed at the
live listing since launch day, so the committed pages are the launched site
and the steps below are the record of how it was flipped. The `/hunt`
invitation fallback (`build/hunt-page.html`) was rewritten for the launched app
the same day and keeps no pre-launch variant: `build/assemble.py` stops if it is
run with the switch off.

On approval day:

1. In `build/assemble.py`'s App Store launch switch patch, set
   `APP_STORE_URL = ""` to
   `APP_STORE_URL = "https://apps.apple.com/app/id6802558635"` (the live
   listing). This is the one on/off switch.
2. Rebuild and verify: `python3 build/assemble.py`, then `python3
   build/check.py` and `npm test`. `index.html` is generated; do not
   hand-edit it.
3. Commit the regenerated pages.
4. Deploy.
5. Run `node scripts/verify-production.mjs` as the post-deploy check.

`APP_STORE_URL_LITERAL`, defined right above `HOME_NAV_CSS` in that same
patch, holds that same listing URL independently of the switch: it is what
lets the mobile nav-hide rule match the App Store link without reading a JS
constant (CSS cannot), and it is already set correctly, so it needs no change
on launch day. Only touch it if the listing URL itself ever changes, and keep
it equal to `APP_STORE_URL`'s own value once that is live.

With `APP_STORE_URL` set: the nav link becomes a pill-shaped "Download app"
link to that URL, with a small inline Apple mark ahead of the label (a single
SVG path; the site's existing button font, colours and size are otherwise
unchanged); the hero and the closing CTA carry Apple's own "Download on the App
Store" badge, linked to the same URL (see "The App Store badge" below); the
plates under **Upcoming** link to the live Hunts in either state (since the
launch copy mix, 2026-10-09); and the waitlist form survives as a fallback,
relocated directly under the closing section's badge (it used to be a section
of its own above the footer) and retitled "Not on iPhone? Get notified for
Android.", with its button reading "NOTIFY ME" and posting to the same
Mailchimp audience and honeypot as before. A small muted link under the hero's
badge, "Not on iPhone? Get notified for Android", scrolls to it (`#waitlist`,
still the one anchor; arriving by link shows the form at once instead of
waiting for the closing section's fade-in).

### The App Store badge

*(2026-10-09, founder revision)* The two big accent pills in the hero and the
closing section were replaced by Apple's official badge, black, English
(US-UK). It is Apple's file, used unaltered: no recolouring, no inlining, no
filter, no hover state, nothing animated on the badge itself. Our small accent
pill stays in the nav and the drawer.

- **Source.** Apple's App Store Marketing Tools (the page
  `tools.applemediaservices.com/app-store/` now forwards there), for this app:
  <https://toolbox.marketingtools.apple.com/en-us/app-store/us/app/6802558635>.
  Its "Download Badges" button serves
  `https://toolbox.marketingtools.apple.com/api/v2/badges/download-on-the-app-store/black/en-us/download`,
  a zip whose `black.svg` is `build/source/app-store-badge-black-en-us.svg`
  (fetched 2026-10-09; its SHA-256 is pinned in `build/assemble.py`, so the
  build stops if the file is edited). Apple's rules are at
  <https://developer.apple.com/app-store/marketing/guidelines/>.
- **Served.** `build/assemble.py` copies the bytes to
  `assets/app-store-badge-black.<hash>.svg` (content-hashed like the other
  shared assets, so the immutable cache is safe) and the hero and closing
  links reference it with an `<img>`. If Apple ever reissues the badge,
  replace the source file and its pin in `build/assemble.py` on purpose.
- **Size and space.** 48px high on desktop and 44px at 640px and below (Apple's
  minimum on screen is 40px); whatever sits beside or under a badge is at
  least a quarter of its height away. `test/app-store-badge.test.js` pins all
  of this.

The mobile hamburger drawer's own link (`build/assemble.py`'s `drawer()`,
static markup shared with every other page, outside `index.html`'s reactive
template) is generated from this same `APP_STORE_URL` constant at build time:
empty, it keeps reading "JOIN THE WAITLIST" and targeting `#waitlist` exactly
as today; set, it reads "Download app" with the same Apple mark, pointing at
the App Store URL, on every page, on phones only.

The Smart App Banner (`<meta name="apple-itunes-app"
content="app-id=6802558635">`) is unconditional and already ships on every
public page: Safari only shows it once the app is actually live on the App
Store, so shipping the tag ahead of approval is safe.

### In-app browsers (TikTok, Instagram)

*(2026-10-19)* Visitors who arrive from a creator's TikTok or Instagram post
open the page in that app's own browser, which will not hand a link to the App
Store, so the "Download on the App Store" button looks dead. Inside those two
browsers only, `build/in-app-notice.js` adds a small card: "Having trouble
downloading Huntz?", the steps to open the page in the real browser (TikTok:
"Open in browser"; Instagram: "Open in external browser"), a "Copy link"
button that copies `https://huntz.ai`, and a dismiss control.

- **Where.** `build/assemble.py` inlines the file, as the last script of the
  page, on every generated page with an App Store button: the home page (and
  `api/_lib/home-fallback.html`, which `api/home.js` serves), the content pages,
  the blog and its articles, and `api/_lib/hunt-fallback.html`, which
  `api/hunt.js` serves for every Hunt page, resolved or not. Not on
  `/auth/callback` (its copy never claims the App Store), the legal pages or the
  payout and mailbox pages, which have no button. `build/check.py` and
  `test/in-app-notice.test.js` fail if a page with an App Store link lacks the
  script or a page without one has it.
- **Detection.** Client side, from `navigator.userAgent`. TikTok: `musical_ly`,
  `BytedanceWebview`, `TikTok`, and `trill` as a whole word (Android's
  `trill_<build>`). Instagram: `Instagram`. These are the markers the in-app
  browsers add today; neither app documents them, so they can change with an app
  release. To add or fix one, edit `TIKTOK` or `INSTAGRAM` at the top of
  `build/in-app-notice.js`, add a sample user agent to
  `test/in-app-notice.test.js`, and rebuild.
- **Nothing changes elsewhere.** The card is built by the script, so it is in no
  served HTML: Safari, Chrome, crawlers and every other browser get the page
  exactly as before. The script is plain ES5, never redirects, cancels a click
  or rewrites a link (the App Store buttons are ordinary anchors to
  `https://apps.apple.com/app/id6802558635`), reads nothing from the URL, and
  stores nothing; dismissal lasts for the page view.
- **Placement.** In the flow, under the page's bar, so it never covers a button
  or the bar. Tapping any App Store link still goes to the link; if the webview
  swallows it, the card is scrolled back into view and briefly outlined.
- **Trying it.** There is no TikTok in a desktop browser, so override the user
  agent first: in the console, run
  `Object.defineProperty(navigator, 'userAgent', {get: () => 'musical_ly_36.1.0 BytedanceWebview/d8a21c6'})`
  and then run the page's own notice script again:
  `(0, eval)([...document.scripts].find(s => s.textContent.includes('data-hz-inapp-notice')).textContent)`.

## The contact form

`/contact` posts to `api/contact.js`, a zero-config Vercel Function that mails
the submission to `team@huntz.ai` through the Zoho mailbox that already exists.
There is no form vendor, no database, and no second endpoint. The whole server
side is two files:

```
api/contact.js         the endpoint: POST only, validate, send, answer
api/_lib/validate.js   field rules and limits (the leading _ keeps it off the router)
```

[Nodemailer](https://nodemailer.com) owns the wire — MIME, the encoding choice,
dot-stuffing, `Date` and `Message-ID`. It is a single MIT-0 package with zero
dependencies of its own.

**The visitor never controls where mail goes or who it appears to be from.** The
recipient, the envelope sender and the `From` header are constants in
`api/contact.js`. The submitted address reaches exactly one header, `Reply-To`,
and only after an anchored ASCII-only pattern that cannot admit a newline, a
comma or an angle bracket — which is what stops `Bcc:` being spliced into a
header or a second recipient into the address. The reason is a closed set whose
label builds the `Subject`, so no visitor text reaches a header at all. A hidden
honeypot field is refused with the same wording as any other refusal, so probing
cannot map the checks.

### Environment variables

Set these in Vercel under **Settings → Environment Variables**, for Production,
Preview and Development. Nothing here can reach the browser: the framework
preset is *Other*, so Vercel creates no client-exposed prefixed variables, and
the HTML is generated by `build/` ahead of time, so there is no substitution step
that could inline one.

| Variable | Secret? | Value |
|---|---|---|
| `HUNTZ_SMTP_PASSWORD` | **yes** | the Zoho app-specific password (below) |
| `HUNTZ_SMTP_HOST` | no | optional. Defaults to `smtppro.zoho.com` (paid custom-domain mailboxes). A **free** Zoho mailbox is on `smtp.zoho.com` |
| `HUNTZ_SMTP_PORT` | no | optional. Defaults to `465` (implicit TLS); `587` switches to STARTTLS |
| `HUNTZ_SMTP_USER` | no | optional. Defaults to `team@huntz.ai` |

Without the password the endpoint answers `503` and the form says it is
unavailable, rather than accepting a message it cannot deliver.

### Zoho setup

1. Sign in at <https://accounts.zoho.com> as `team@huntz.ai`.
2. **Security → App passwords → Generate New Password**, name it `huntz-website`.
3. Copy the 12-character passcode — Zoho shows it once — and paste it straight
   into Vercel. It should not be pasted into chat, committed, or written into
   any file in this repo.
4. Redeploy so the function picks it up.

Two things to confirm before expecting mail to arrive:

- **SMTP access needs a paid Zoho plan.** Zoho's Mail Free tier excludes
  IMAP/POP, and SMTP appears to go with them; paid access starts at Mail Lite.
  On the free tier the endpoint answers `502` and the log shows an auth failure.
- **`From` must be the authenticated mailbox.** Zoho refuses a mismatch with
  `553 Relaying disallowed`. Sending as an alias means adding it in Zoho first.

### Production hardening

The form ships with a honeypot, POST-only handling, per-field octet limits and a
16 KB body cap. It does **not** ship with rate limiting, and that is a deliberate
gap rather than an oversight: durable per-IP limiting needs state the function
does not have, and an in-process counter is not one — Vercel scales to many
instances, nothing pins a caller to one, and every deploy resets them.

Before production traffic, add a Vercel WAF rate-limit rule. It is free on Hobby
(one rule per project), configured in the dashboard under **Firewall → Custom
Rules** or from the CLI, and it cannot be expressed in `vercel.json`:

```bash
vercel firewall rules add --name contact-throttle --condition path:pre:/api/ --action rate_limit --rate 10 --window 60 --key ip
```

Vercel's own guidance is to deploy a new rule with the `log` action, watch ten
minutes of traffic, then switch it to `deny`. This matters more than inbox noise:
Zoho throttles a mailbox at roughly 50–500 external messages an hour, so an
unthrottled endpoint can exhaust the team's own sending quota.

One governance note, unrelated: Vercel's Hobby plan is non-commercial-use only,
and a marketing site for a product is commercial usage under their terms.

### Testing it

```bash
npm install
npm test
```

Delivery runs through the real nodemailer transport into a scripted SMTP server
that advertises exactly what Zoho advertises — `AUTH` and `SIZE`, so no
`PIPELINING`, no `8BITMIME` — and splits its greeting across two writes. The
tests therefore check the real wire format, including that non-ASCII goes out
7-bit clean and that a message body containing a lone `.` cannot terminate `DATA`
early and inject SMTP commands. No test sends mail anywhere.

## Rebuilding

Edit `build/assemble.py` (or `build/legal-overlay.html` for the Terms and
Privacy documents), then:

```bash
python3 build/legal_build.py   # only when the legal text changed
python3 build/assemble.py
python3 build/check.py         # route/metadata/copy/nav/form validation
npm test                       # the contact endpoint
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
- Upcoming cards list open public Hunts from Discover and each
  "I want this hunt" links to the apex Universal Link.
- Launch copy mix (2026-10-09, founder-approved): the hero reads "You don't
  need motivation. You need consequences." over "Pick a goal. Put $20 to $500
  on the line. Prove it daily. ..." (the share card's og and twitter
  descriptions repeat that sentence), a "Sound familiar?" block follows the
  marquee strip (a headline in the mechanic's style over three cards, "THE
  GYM", "THE MONDAY" and "THE CAMERA ROLL", on the mechanic steps' own card
  styles: three across on desktop, stacked on phones), the closing section
  reads "Become someone who finishes." over "Quitting just got expensive.",
  and the closing card is "What's live" (iOS app, creator-hosted and private
  Hunts live; Android coming soon). The hero and the closing section carry
  Apple's App Store badge (see "The App Store badge" above), with the Android
  notify form under the closing one and a small link to it under the hero's.
  The giant HUNTZ. wordmark at the very bottom of the closing section stands
  on its own (the line under it, "Put your money where your goals are.", is
  gone), so the footer brand block's "The marketplace for accountability." is
  the page's one tagline; the inner pages' footers have none. The share card's
  og:title and twitter:title read "Huntz: Become someone who finishes.". No em
  or en dashes, no exclamation marks.
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


## Public Hunt pages and live Discover

`api/home.js` serves `/` using the generated homepage and the generated
`api/_lib/hunt-card.html` template. It reads only the unauthenticated public
`GET /v1/hunts`, following cursor pages, and shows every open Hunt in
start-date order, however many there are. A failed or incomplete traversal
returns the original static cards. A successful empty list shows an empty
state.

`index.html` and `sitemap.xml` remain local build/check artifacts. Their exact
copies are generated at `api/_lib/home-fallback.html` and
`api/_lib/sitemap-base.xml` and included in the function bundles. The root
copies are excluded from deployment by `.vercelignore`, because filesystem
routes would otherwise take precedence over the live rewrites.

`api/hunt.js` serves `/hunt/<id>`. A resolved detail renders the cover, title,
description, length, cadence, start date in the Hunt's time zone, minimum stake
(at least $20), and Host. An iPhone-only button uses `huntz:///hunt/<id>` as
accepted by the mobile app. A valid Hunt code may accompany that button.
Referral and share tokens are never read, forwarded, logged or rendered.
Unresolved invitations retain `api/_lib/hunt-fallback.html` byte for byte.

Only details with PUBLIC visibility, OPEN enrollment and a matching entry in
the current public Discover traversal receive an indexable response, an apex
canonical URL and Event JSON-LD. All other responses remain noindex, omit
canonical and structured data, and use `no-store`. The public API owns the
published and visibility filter; explicit contradictory lifecycle or visibility
fields are also rejected locally. No authenticated endpoint is used.

`api/sitemap.js` serves `/sitemap.xml`, adding every eligible Discover URL to
the generated marketing sitemap. It regenerates on cache misses and is called
daily by Vercel Cron at 12:00 UTC. Public HTML and XML responses use a five-minute
Vercel cache with no stale-while-revalidate window. A close, cancellation or
visibility change disappears after that cache expires. Failed Discover reads
serve the marketing-only sitemap uncached, so stale Hunt URLs are not retained.
The cron performs only public reads and does not require a secret or a deploy hook.

The build stays deterministic and offline after its initial asset download:

```sh
python3.12 build/assemble.py && python3.12 build/check.py && npm test
```

After production deployment, run `node scripts/verify-production.mjs`.
For a Vercel preview, set `HUNTZ_VERIFY_ORIGIN` to the preview origin; the script
checks the preview's pages while retaining production canonical expectations,
and skips apex redirect checks that only make sense on production domains.
