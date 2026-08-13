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
api/                             the contact endpoint (see "The contact form")
test/                            its tests: node --test "test/*.test.js"
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
- Clicking a card in **Upcoming** attaches that Hunt's name and submits it as
  the `INTEREST` merge field. Capturing it requires an `INTEREST` text field on
  the Mailchimp audience; without one, Mailchimp silently drops the value.
- The audience is single opt-in, so Mailchimp sends nothing on signup. The page
  shows its own confirmation. A welcome email needs a Mailchimp automation, and
  is best set up *after* sending-domain authentication so it comes from
  `@huntz.ai` rather than via Mailchimp's domain.

## The contact form

`/contact` carries a real form that delivers to `team@huntz.ai` through the
existing Zoho mailbox. There is no third-party form service, no database, and
nothing new to install: `api/contact.js` and `api/contact-token.js` are
zero-config Vercel Functions, and everything they import lives under
`api/_lib/`, whose leading underscore keeps those files out of routing while
still bundling them.

**The visitor never controls where mail goes or who it appears to be from.**
The recipient, the envelope sender and the `From` header are constants in
`api/_lib/config.js`. The submitted address appears in exactly one place, the
`Reply-To` header, and only after passing an anchored ASCII-only pattern, so
neither a newline nor a second address can be spliced in. The message body is
base64, whose alphabet cannot produce a bare newline or a line-leading period,
which is what stops a crafted message from injecting SMTP commands.

### Environment variables

Set both in Vercel under **Settings → Environment Variables**, for Production,
Preview and Development. Neither can reach the browser: this project's framework
preset is *Other*, so Vercel creates no client-exposed prefixed variables, and
the HTML is generated ahead of time by `build/` rather than at deploy time, so
there is no substitution step that could inline one.

| Variable | Secret? | Value |
|---|---|---|
| `HUNTZ_SMTP_PASSWORD` | **yes** | the Zoho app-specific password (below) |
| `HUNTZ_CONTACT_TOKEN_SECRET` | **yes** | any random string, 32+ characters. `openssl rand -base64 32` |
| `HUNTZ_SMTP_HOST` | no | optional. Defaults to `smtppro.zoho.com` (paid custom-domain mailboxes). A **free** Zoho mailbox is on `smtp.zoho.com` |
| `HUNTZ_SMTP_PORT` | no | optional. Defaults to `465` (implicit TLS) |
| `HUNTZ_SMTP_USER` | no | optional. Defaults to `team@huntz.ai` |

Missing or short secrets fail closed: the endpoint answers `503 unconfigured`
and the form says it is unavailable, rather than accepting a message it cannot
deliver.

### Zoho setup

1. Sign in at <https://accounts.zoho.com> as `team@huntz.ai`.
2. **Security → App passwords → Generate New Password**, name it `huntz-website`.
3. Copy the 12-character passcode immediately — Zoho shows it once — and paste
   it straight into Vercel as `HUNTZ_SMTP_PASSWORD`. It should not be pasted
   into chat, committed, or written into any file in this repo.
4. Redeploy the branch so the function picks the variables up.

Two things to confirm before expecting mail to arrive:

- **SMTP access needs a paid Zoho plan.** Zoho's Mail Free tier excludes
  IMAP/POP, and SMTP appears to go with them; paid access starts at Mail Lite.
  If `team@huntz.ai` is on the free tier, the endpoint will answer
  `502 delivery_failed` with `stage: "auth"` in the server log.
- **`From` must be the authenticated mailbox.** Zoho refuses a mismatch with
  `553 Relaying disallowed`. Sending as an alias means adding it in Zoho first.

### Abuse controls

In the code: a honeypot field; a server-signed token that the form has to fetch
before it can submit, with a three-second minimum completion time and a
thirty-minute expiry; strict per-field limits; and a per-instance burst brake.

**None of that is a rate limit**, and the burst brake in particular is not one:
Vercel scales to many concurrent instances, nothing pins a caller to one, and
every deploy resets them. Zoho throttles a mailbox at roughly 50-500 external
messages an hour, so an unthrottled endpoint can exhaust the team's own sending
quota, not just fill the inbox.

The durable control is a Vercel WAF rate-limit rule, free on Hobby (one rule per
project). It is dashboard- or CLI-configured, not expressible in `vercel.json`.
Add it under **Firewall → Custom Rules**, or:

```bash
vercel firewall rules add --name contact-throttle --condition path:pre:/api/ --action rate_limit --rate 10 --window 60 --key ip
```

Match on the `/api/` **prefix**, not on `/api/contact` alone — otherwise the
token endpoint is left uncapped. Vercel's own guidance is to deploy a new rule
with the `log` action first, watch ten minutes of traffic, then switch it to
`deny`.

One governance note, unrelated to abuse: Vercel's Hobby plan is
non-commercial-use only, and a marketing site for a product is commercial usage
under their terms. Worth resolving before launch.

### Testing it

`node --test "test/*.test.js"` covers validation, header injection, the
honeypot, token forgery and expiry, throttling, delivery failure, and the SMTP
conversation itself against a scripted server that answers the way Zoho does.
No test sends real mail.

To drive the form locally, point `api/_lib/handle.js`'s `send` at a stub — the
delivery adapter is injected, not imported at the call site — or set the two
environment variables and let it talk to Zoho for real.

## Rebuilding

Edit `build/assemble.py` (or `build/legal-overlay.html` for the Terms and
Privacy documents), then:

```bash
python3 build/legal_build.py   # only when the legal text changed
python3 build/assemble.py
python3 build/check.py         # route/metadata/copy/nav/form validation
node --test "test/*.test.js"   # the contact endpoint
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
