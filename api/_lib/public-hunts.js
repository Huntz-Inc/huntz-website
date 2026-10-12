'use strict';

const API_ORIGIN = process.env.HUNTZ_API_URL || 'https://api.huntz.ai';
const HUNT_ORIGIN = 'https://huntz.ai';
const CACHE_CONTROL = 'public, max-age=0, s-maxage=300, must-revalidate';

function safeHuntId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{1,128}$/u.test(value) &&
    value !== '.' && value !== '..' ? value : null;
}

// Host-written text follows the same copy rules as site-written text.
function copy(value) {
  return typeof value === 'string'
    ? value.replace(/[\u2013\u2014]/g, ', ').replace(/!/g, '.').replace(/join fee/gi, 'service fee').trim()
    : '';
}

function minimumStake(hunt) {
  const minor = hunt?.stakeRange?.minMinor;
  if (typeof minor !== 'string' || !/^\d{1,12}$/.test(minor)) return null;
  return Math.max(2000, Number(minor)) / 100;
}

function stakeLabel(hunt) {
  const stake = minimumStake(hunt);
  return stake === null ? null : 'From ' + new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: stake % 1 ? 2 : 0,
  }).format(stake);
}

// The public Discover endpoint itself guarantees PUBLIC + PUBLISHED. Its card
// DTO omits those fields; refuse explicit contradictory fields if ever added.
function isOpenPublic(hunt, now = new Date()) {
  if (!hunt || hunt.enrollmentStatus !== 'OPEN') return false;
  if (hunt.visibility != null && hunt.visibility !== 'PUBLIC') return false;
  if (hunt.lifecycleState != null && hunt.lifecycleState !== 'PUBLISHED') return false;
  if (hunt.requiresCode === true || hunt.codeRequired === true || hunt.canceledAt || hunt.cancelledAt) return false;
  if (hunt.enrollmentClosesAt != null && !(Date.parse(hunt.enrollmentClosesAt) > now.getTime())) return false;
  return true;
}

/** Only the unauthenticated Discover list, including every cursor page. No
 * stale process cache: Vercel caches the public response for five minutes.
 * An incomplete/failed traversal returns null, never a misleading partial list. */
async function fetchPublicHunts(deps = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.listTimeoutMs || 4000);
  const items = new Map();
  const cursors = new Set();
  let cursor = null;
  try {
    for (let page = 0; page < 100; page++) {
      const url = new URL('/v1/hunts', deps.apiOrigin || API_ORIGIN);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await (deps.fetchImpl || globalThis.fetch)(url.toString(), {
        signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' },
      });
      if (response?.status !== 200) return null;
      const data = await response.json();
      if (!data || !Array.isArray(data.items) ||
          !(data.nextCursor === null || typeof data.nextCursor === 'string' && data.nextCursor.length > 0)) return null;
      for (const item of data.items) {
        if (safeHuntId(item?.id) && copy(item.title) && isOpenPublic(item, deps.now) &&
            Number.isFinite(Date.parse(item.startAt))) items.set(item.id, item);
      }
      if (data.nextCursor === null) {
        return [...items.values()].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id));
      }
      if (cursors.has(data.nextCursor) || data.nextCursor.length > 4096) return null;
      cursors.add(data.nextCursor);
      cursor = data.nextCursor;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { API_ORIGIN, HUNT_ORIGIN, CACHE_CONTROL, safeHuntId, copy, minimumStake, stakeLabel, isOpenPublic, fetchPublicHunts };
