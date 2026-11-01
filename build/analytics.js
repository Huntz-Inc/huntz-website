/* Huntz website analytics (PostHog), inlined into <head> by build/assemble.py.
 *
 * This header is not shipped; build/assemble.py strips it. Three tokens are
 * filled in at build time from Python constants, so nothing here is edited by
 * hand when the token or the App Store switch changes:
 *
 *   __POSTHOG_TOKEN__   POSTHOG_PROJECT_TOKEN, a public write-only project token
 *   __WAITLIST_CTA__    "android_notify" while APP_STORE_URL is set, else "join_waitlist"
 *   __WAITLIST_FORM__   "android_notify" while APP_STORE_URL is set, else "waitlist"
 *
 * What it does, and what it refuses to do:
 *   - Runs on huntz.ai and www.huntz.ai only. Vercel previews, localhost and any
 *     other host get no network request, no storage and no listeners.
 *   - Runs nowhere a visitor sends Do Not Track or Global Privacy Control.
 *   - Loads PostHog's own array.js asynchronously (the official snippet), so the
 *     page renders and behaves the same with the script blocked or offline.
 *   - Autocapture is off. Only $pageview, $pageleave and the explicit events
 *     below are sent, each with a small flat property set. No email address, no
 *     form text, no query string from a private route is ever sent.
 *   - before_send removes the query and fragment from any URL it finds that
 *     points at /hunt, /auth, /mailbox or /payouts, because those carry
 *     referral tokens, auth codes and pairing secrets.
 *
 * Events: website_cta_clicked, website_hunt_viewed, website_waitlist_submitted,
 * website_contact_submitted. See README.md, "Analytics".
 *
 * Plain ES5 on purpose, like in-app-notice.js: it must run in old webviews.
 * It must not contain a closing script tag. test/analytics.test.js pins the
 * shape of everything below.
 */
(function () {
  'use strict';

  // ---- guards: where and for whom this may run ----
  var HOSTS = ['huntz.ai', 'www.huntz.ai'];
  if (HOSTS.indexOf(location.hostname) < 0) return;

  function signalOn(v) { return v === true || v === 1 || v === '1' || v === 'yes' || v === 'true'; }
  // PostHog's respect_dnt is set below as well; this earlier check means a
  // visitor who asks not to be tracked also never loads the PostHog script.
  if (signalOn(navigator.doNotTrack) || signalOn(window.doNotTrack) ||
      signalOn(navigator.msDoNotTrack) || signalOn(navigator.globalPrivacyControl)) return;

  // Only valid while this script runs: api/hunt.js stamps the Hunt id on the
  // tag it serves for a resolved /hunt/<id> page. Every other page has none.
  var self = document.currentScript;
  var huntId = self && self.getAttribute ? self.getAttribute('data-hz-hunt-id') : null;

  // Invitation, sign-in, pairing and payout routes keep secrets in their query
  // string. Applied to every string in every event, so the current URL, the
  // referrer and the person properties are all covered.
  var PRIVATE_URL = /^https?:\/\/[^\/?#]+\/(?:hunt|auth|mailbox|payouts)(?:[\/?#]|$)/;
  function clean(v, depth) {
    if (typeof v === 'string') return PRIVATE_URL.test(v) ? v.replace(/[?#][\s\S]*$/, '') : v;
    if (!v || typeof v !== 'object' || depth > 3) return v;
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) v[k] = clean(v[k], depth + 1);
    }
    return v;
  }
  function scrub(event) { return clean(event, 0); }

  // ---- PostHog: the official loader stub (posthog.com/docs/libraries/js), unchanged ----
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  try {
    posthog.init('__POSTHOG_TOKEN__', {
      api_host: 'https://us.i.posthog.com',
      defaults: '2026-08-30',            // pin behaviour: array.js is always the latest build
      capture_pageview: true,            // one $pageview per page load (a static, multi-page site)
      capture_pageleave: true,
      autocapture: false,                // explicit events only
      persistence: 'localStorage+cookie',// one anonymous id per browser, so new and returning visitors can be told apart
      cross_subdomain_cookie: false,     // cookie on the page host only (www.huntz.ai), never on .huntz.ai, so it is not sent to api. or ops.
      person_profiles: 'always',         // every visitor gets a person, so people who clicked Download can be browsed
      respect_dnt: true,
      // The landing URL is stored in the visitor's cookie and storage. These three
      // are the invitation parameters, so their values are replaced with a mask there.
      mask_personal_data_properties: true,
      custom_personal_data_properties: ['ref', 'via', 'code'],
      disable_session_recording: true,
      advanced_disable_flags: true,      // no /flags call, and no remote config: nothing is switched on from the PostHog dashboard
      before_send: scrub
    });
  } catch (e) { return; }

  // ---- events ----
  function track(name, props) {
    try {
      if (window.posthog && typeof window.posthog.capture === 'function') {
        // sendBeacon + send_instantly: a click on the App Store link leaves the
        // page at once, and an ordinary queued request would be dropped.
        window.posthog.capture(name, props, { transport: 'sendBeacon', send_instantly: true });
      }
    } catch (e) { /* analytics must never break the page */ }
  }

  var APP_STORE = /^https:\/\/apps\.apple\.com\//;
  var WAITLIST_CTA = '__WAITLIST_CTA__';
  var WAITLIST_FORM = '__WAITLIST_FORM__';
  // CTAs that also write person properties, so the people who clicked can be browsed.
  var PERSON_CTA = { download_app: 1, join_waitlist: 1, android_notify: 1 };

  // Same-site links keep their path and fragment, everything else keeps origin
  // and path; the query is always dropped. Non-web schemes (mailto:, huntz:) are ignored.
  function hrefOf(a) {
    try {
      var u = new URL(a.getAttribute('href') || '', location.href);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      return u.origin === location.origin ? u.pathname + u.hash : u.origin + u.pathname;
    } catch (e) { return null; }
  }

  function locationOf(a) {
    if (a.closest('[aria-modal="true"]')) return 'drawer';
    if (a.closest('footer, [data-hz-footernav]')) return 'footer';
    if (a.closest('#hz-nav, header, [data-hz-desknav]')) return 'nav';
    if (a.closest('#hunts')) return 'hunts';
    if (a.closest('#hz-hero')) return 'hero';
    if (a.closest('#cta')) return 'final';
    if (a.closest('aside[data-cta]')) return 'plate';
    return 'content';
  }

  function ctaOf(a, href) {
    if (a.hasAttribute('data-hunt-link')) return 'hunt_card';
    if (APP_STORE.test(href)) return 'download_app';
    if (/#waitlist$/.test(href)) return WAITLIST_CTA;
    if (a.closest('[aria-modal="true"], footer, [data-hz-footernav], #hz-nav, header, [data-hz-desknav]')) return 'nav';
    return null;
  }

  document.addEventListener('click', function (e) {
    try {
      var t = e.target;
      if (t && t.nodeType !== 1) t = t.parentElement;
      var a = t && t.closest ? t.closest('a[href]') : null;
      if (!a) return;
      var href = hrefOf(a);
      if (!href) return;
      var cta = ctaOf(a, href);
      if (!cta) return;
      var where = locationOf(a);
      var props = { cta: cta, location: where, href: href };
      if (PERSON_CTA[cta]) {
        var set = {}, once = {};
        set['clicked_' + cta] = true;
        set['last_' + cta + '_click_location'] = where;
        once['first_' + cta + '_click_at'] = new Date().toISOString();
        props.$set = set;
        props.$set_once = once;
      }
      track('website_cta_clicked', props);
    } catch (err) { /* ignore */ }
  }, true);

  // The email form submits (Android notify, or the waitlist before launch). The address is never sent.
  document.addEventListener('submit', function (e) {
    try {
      var f = e.target;
      if (!f || !f.querySelector || f.id === 'hz-contact') return;
      if (f.querySelector('input[type=email]')) track('website_waitlist_submitted', { form: WAITLIST_FORM });
    } catch (err) { /* ignore */ }
  }, true);

  // The contact form validates in script and answers by revealing its success
  // panel, so that reveal is the signal: it counts messages that were sent, not attempts.
  function watchContact() {
    try {
      var done = document.getElementById('hz-contact-done');
      if (!done || !window.MutationObserver) return;
      new MutationObserver(function () {
        if (!done.hidden) track('website_contact_submitted', { form: 'contact' });
      }).observe(done, { attributes: true, attributeFilter: ['hidden'] });
    } catch (err) { /* ignore */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchContact);
  else watchContact();

  // api/hunt.js marks a resolved /hunt/<id> page; the id was already validated there.
  if (huntId && /^[A-Za-z0-9._~-]{1,128}$/.test(huntId)) {
    track('website_hunt_viewed', { huntId: huntId, path: '/hunt/' + huntId });
  }
})();
