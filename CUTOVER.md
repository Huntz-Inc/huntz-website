# Apex universal-links cutover

`huntz.ai` (the bare apex) is the signed Associated Domain in Build 7, and Apple follows no
redirects when it fetches the association file. So the apex has to serve that file itself, which
means the apex→www redirect has to move out of the Vercel dashboard and into `vercel.json`, where
it can be given exceptions.

Two switches, in two different places, and the order matters:

- the **dashboard** domain redirect lives in project config, changes without a redeploy, and runs
  at the domain layer — ahead of everything in the deployment;
- the **`vercel.json`** rule ships with a deployment and only takes effect once the dashboard
  redirect is out of the way.

Deploying first is therefore free: the new rule sits dormant behind the dashboard redirect until
you clear it.

---

## 1. Deploy, with the dashboard redirect still in place

Merge and let the production deployment finish, then:

```
node scripts/verify-production.mjs --pre
```

This must pass before you touch anything. It proves `www` is untouched — which is the half of the
change that could take the site down, and the half you can test while the apex is still shielded.

## 2. Record what you are about to change

So there is something exact to restore:

```
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/huntz-website/domains/huntz.ai?teamId=$TEAM_ID"
```

Note `redirect` (expected `www.huntz.ai`) and `redirectStatusCode` (expected `308`).

## 3. Clear the domain redirect

Dashboard: **Project Settings → Domains → `huntz.ai` → Edit → "Redirect to" → no redirect → Save.**

Or:

```
curl -X PATCH "https://api.vercel.com/v9/projects/huntz-website/domains/huntz.ai?teamId=$TEAM_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"redirect": null, "redirectStatusCode": null}'
```

This does not unassign the domain — `huntz.ai` stays a verified production domain on the project.

## 4. Verify immediately

```
node scripts/verify-production.mjs
```

The single most important line is `https://www.huntz.ai/` returning **200**. If it returns a 308,
the host condition is matching `www` as well as the apex, every www request is redirecting to
itself, and the site is down. Roll back now, do not debug first.

Check from `curl` or a fresh browser profile, never your daily browser: the old apex 308s may be
cached locally and will make you misdiagnose whatever you are looking at.

## 5. Rollback

Restoring the dashboard redirect is complete and immediate — it runs ahead of deployment routes,
so it supersedes the `vercel.json` rule entirely. You do not need to revert the deploy.

```
curl -X PATCH "https://api.vercel.com/v9/projects/huntz-website/domains/huntz.ai?teamId=$TEAM_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"redirect": "www.huntz.ai", "redirectStatusCode": 308}'
```

---

## Afterwards

Apple's CDN fetches the association file within 24 hours, devices re-check about weekly, and there
is **no way to invalidate it**. A broken file is therefore a week-long outage, and a domain
redirect quietly reintroduced later breaks universal links without any visible symptom on the
website. Run `node scripts/verify-production.mjs` on a schedule, or wire it into CI.

To check a device, on an iPhone with the build installed: **Settings → Developer → Associated
Domains Development → Diagnostics**, then enter the full URL. On a Mac,
`sudo swcutil dl -d huntz.ai` fetches what Apple would fetch, and
`sudo swcutil verify -d huntz.ai -j .well-known/apple-app-site-association` validates a local file
before it ships.

## Known limits of this cutover

- Build 7's entitlement is `applinks:huntz.ai` only, so `www.huntz.ai/hunt/...` will **not** open
  the app. Distribute apex links. A future build should carry both entries, each with its own
  association file.
- One behaviour change to expect in logs: apex `/faq/` now takes two hops (a relative redirect to
  `/faq` on the apex, then the redirect to www) where the dashboard redirect did it in one. It
  terminates, and does not loop.
