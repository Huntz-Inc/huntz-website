// Live verification for the apex universal-link cutover.
//
//     node scripts/verify-production.mjs              full run
//     node scripts/verify-production.mjs --pre        skip apex checks (dashboard redirect still on)
//
// Run it three times around the cutover:
//   --pre   after deploying, while the Vercel domain redirect is still active.
//           Proves www is untouched, which is what rules out a redirect loop.
//   full    immediately after clearing "Redirect to" on huntz.ai.
//   full    any time later. Apple caches the association file for about a week
//           and cannot be invalidated, so if the domain redirect is ever
//           reintroduced, universal links break silently for days. This script
//           is the cheapest way to notice.
//
// Exit code is non-zero on any failure, so it can gate a rollback.

const APEX = 'https://huntz.ai';
const WWW = 'https://www.huntz.ai';
const APP_ID = 'JVTW9DH25L.ai.huntz.app';
const PRE_ONLY = process.argv.includes('--pre');

const failures = [];
const fail = (m) => { failures.push(m); console.log(`  FAIL  ${m}`); };
const pass = (m) => console.log(`  ok    ${m}`);

async function head(url, opts = {}) {
  const res = await fetch(url, { redirect: 'manual', headers: opts.headers || {} });
  return { status: res.status, location: res.headers.get('location'),
           type: res.headers.get('content-type'), res };
}

// --- the association file, on whichever host is being checked ---
async function checkAasa(origin, path) {
  const label = `${origin}${path}`;
  const r = await head(origin + path);
  if (r.status !== 200) return fail(`${label} returned ${r.status}, expected 200`);
  if (r.location) return fail(`${label} redirects to ${r.location}; Apple follows no redirects`);
  if (!(r.type || '').startsWith('application/json')) {
    fail(`${label} content-type is ${r.type}, expected application/json`);
  }
  let body;
  try { body = JSON.parse(await r.res.text()); }
  catch (e) { return fail(`${label} is not valid JSON: ${e.message}`); }
  const ids = body?.applinks?.details?.[0]?.appIDs;
  if (!Array.isArray(ids) || ids[0] !== APP_ID) {
    return fail(`${label} appIDs is ${JSON.stringify(ids)}, expected ["${APP_ID}"]`);
  }
  const comps = (body.applinks.details[0].components || []).map((c) => c['/']);
  for (const want of ['/hunt/*', '/hunt', '/auth/callback']) {
    if (!comps.includes(want)) fail(`${label} does not associate ${want}`);
  }
  pass(`${label} 200, no redirect, application/json, ${APP_ID}`);

  // Apple's fetcher IPs are unpublished, so a WAF or bot rule that answers a
  // non-browser agent with a challenge page breaks universal links while the
  // file still looks perfect in a browser.
  const bot = await head(origin + path, { headers: { 'user-agent': 'AASA-Bot/1.0' } });
  if (bot.status !== 200) fail(`${label} returns ${bot.status} to a non-browser user agent`);
  else pass(`${label} also 200 for a non-browser user agent`);
}

// --- routes that must still serve normally on the canonical host ---
const MARKETING = ['/', '/how-it-works', '/accountability-challenges', '/faq', '/blog',
                   '/blog/best-accountability-apps-2026', '/blog/why-you-dont-achieve-your-goals',
                   '/about', '/contact', '/terms', '/privacy', '/sitemap.xml', '/robots.txt'];

async function main() {
  console.log(`\n== canonical host (${WWW}) must be untouched ==`);
  for (const p of MARKETING) {
    const r = await head(WWW + p);
    if (r.status !== 200) fail(`${WWW}${p} returned ${r.status}, expected 200`);
    else if (r.location) fail(`${WWW}${p} redirects to ${r.location}; www must never redirect`);
  }
  if (!failures.length) pass(`${MARKETING.length} www routes 200 with no redirect (no loop)`);

  console.log('\n== canonicals and sitemap unchanged ==');
  const sm = await (await fetch(`${WWW}/sitemap.xml`)).text();
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (locs.length !== 11) fail(`sitemap has ${locs.length} urls, expected 11`);
  else pass('sitemap still lists 11 canonical www urls');
  for (const bad of ['/hunt', '/auth']) {
    if (locs.some((l) => l.includes(bad))) fail(`sitemap leaks ${bad}`);
  }
  const home = await (await fetch(`${WWW}/about`)).text();
  if (!home.includes(`<link rel="canonical" href="${WWW}/about">`)) {
    fail('/about canonical is not the www url');
  } else pass('canonicals still point at the www host');

  console.log('\n== association file ==');
  await checkAasa(WWW, '/.well-known/apple-app-site-association');
  if (PRE_ONLY) {
    console.log('\n-- skipping apex checks (--pre: dashboard redirect still active) --');
  } else {
    await checkAasa(APEX, '/.well-known/apple-app-site-association');
    await checkAasa(APEX, '/apple-app-site-association');

    console.log('\n== apex marketing still redirects to www (no duplicate content) ==');
    for (const p of ['/about', '/', '/faq', '/blog', '/how-it-works', '/terms']) {
      const r = await head(APEX + p);
      const want = WWW + p;
      if (r.status !== 308 && r.status !== 301) fail(`${APEX}${p} returned ${r.status}, expected 308`);
      else if (r.location !== want) fail(`${APEX}${p} redirects to ${r.location}, expected ${want}`);
    }
    if (!failures.length) pass('apex marketing routes still 308 to their www equivalent');

    console.log('\n== apex universal-link paths serve directly ==');
    for (const p of ['/hunt/test-hunt', '/hunt/test-hunt?ref=REDACTED_TEST_TOKEN', '/auth/callback']) {
      const r = await head(APEX + p);
      if (r.status !== 200) fail(`${APEX}${p} returned ${r.status}, expected 200`);
      else if (r.location) fail(`${APEX}${p} redirects to ${r.location}`);
      else pass(`${APEX}${p} 200`);
    }

    console.log('\n== apex serves what those pages load (its CSP self is the apex) ==');
    for (const p of ['/assets/fonts.601bc53b.css', '/favicon.ico', '/apple-touch-icon.png',
                     '/icon-192.png']) {
      const r = await head(APEX + p);
      if (r.location) fail(`${APEX}${p} redirects to ${r.location}; /auth/callback's CSP will refuse it`);
      else if (r.status !== 200) fail(`${APEX}${p} returned ${r.status}, expected 200`);
    }
    if (!failures.length) pass('apex serves the stylesheet and icons directly, no cross-origin hop');

    // The referral token must not survive into the page the browser renders.
    const withToken = await (await fetch(`${APEX}/hunt/test-hunt?ref=REDACTED_TEST_TOKEN`)).text();
    if (withToken.includes('REDACTED_TEST_TOKEN')) fail('the referral token appears in the rendered HTML');
    else pass('referral token absent from the rendered HTML');
    const cb = await (await fetch(`${APEX}/auth/callback?code=VERIFY_ONLY_CODE`)).text();
    if (cb.includes('VERIFY_ONLY_CODE')) fail('the auth code appears in the rendered HTML');
    else pass('auth code absent from the rendered HTML');
  }

  // What a device actually reads. iOS never fetches huntz.ai for this: it asks
  // Apple's CDN, which pulls the origin within about 24 hours and then caches
  // with no way to invalidate. A green origin therefore proves the file is
  // publishable, not that any phone can see it yet - so this is reported
  // separately, and only a WRONG cached file is treated as a failure.
  console.log('\n== what Apple\'s CDN is serving to devices ==');
  try {
    const r = await fetch(`https://app-site-association.cdn-apple.com/a/v1/huntz.ai`);
    if (r.status === 200) {
      const body = await r.json();
      const ids = body?.applinks?.details?.[0]?.appIDs;
      const comps = (body?.applinks?.details?.[0]?.components || []).map((c) => c['/']);
      if (ids?.[0] !== APP_ID) {
        fail(`Apple's CDN is serving appIDs ${JSON.stringify(ids)}, expected ["${APP_ID}"] - ` +
             `devices will use this for about a week and it cannot be invalidated`);
      } else if (!['/hunt/*', '/hunt', '/auth/callback'].every((c) => comps.includes(c))) {
        fail(`Apple's CDN has a stale component list: ${JSON.stringify(comps)}`);
      } else {
        pass(`Apple's CDN is serving ${APP_ID} with ${comps.length} components`);
      }
    } else {
      console.log(`  note  Apple's CDN has not picked the file up yet (HTTP ${r.status}). ` +
                  `It fetches within ~24h; re-run this tomorrow. Universal links will not ` +
                  `work on any device until it does.`);
    }
  } catch (e) {
    console.log(`  note  could not reach Apple's CDN: ${e.message}`);
  }

  console.log(failures.length ? `\nFAILED (${failures.length}) - roll back the domain setting\n`
                              : '\nAll production checks passed.\n');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
