'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HUNT_ORIGIN, CACHE_CONTROL, copy, stakeLabel, fetchPublicHunts } = require('./_lib/public-hunts');
const { escapeHtml, formatDuration, formatCadence } = require('./hunt');

// Host copy goes through HTML escaping AND literal template escaping. The
// homepage runtime evaluates {{ expressions }} after decoding HTML entities;
// a zero-width separator keeps braces readable without allowing expressions.
function escapeTemplateText(value) {
  return escapeHtml(copy(value)).replace(/\{/g, '{&#8203;');
}

function renderCard(template, hunt, index) {
  let starts;
  try {
    starts = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric',
      timeZone: hunt.timeZone || 'UTC' }).format(new Date(hunt.startAt));
  } catch {
    starts = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(hunt.startAt));
  }
  const values = {
    NUMBER: String(index + 1).padStart(2, '0'), TITLE: hunt.title,
    URL: HUNT_ORIGIN + '/hunt/' + encodeURIComponent(hunt.id),
    CADENCE: formatCadence(hunt).toUpperCase(),
    LENGTH: (formatDuration(hunt.duration, hunt.lengthLabel) || 'See Hunt details').toUpperCase(),
    STAKE: (stakeLabel(hunt) || 'See Hunt details').toUpperCase(), STARTS: starts.toUpperCase(),
  };
  return template.replace(/%%([A-Z]+)%%/g, (_, key) => escapeTemplateText(values[key]));
}

async function handle(req, res, deps = {}) {
  const fallback = deps.fallbackHtml ?? fs.readFileSync(path.join(process.cwd(), 'api/_lib/home-fallback.html'), 'utf8');
  const hunts = await fetchPublicHunts(deps);
  let html = fallback;
  if (hunts !== null) {
    const template = deps.cardTemplate ?? fs.readFileSync(path.join(process.cwd(), 'api/_lib/hunt-card.html'), 'utf8');
    const cards = hunts.map((hunt, i) => renderCard(template, hunt, i)).join('\n');
    // An empty successful response is not an outage: do not advertise closed Hunts.
    html = fallback.replace(/<!-- HUNT_RAIL_START -->[\s\S]*?<!-- HUNT_RAIL_END -->/, () =>
      '<!-- HUNT_RAIL_START -->\n' + (cards || '<p>No Hunts are open right now. Check back soon.</p>') + '\n<!-- HUNT_RAIL_END -->');
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', hunts === null ? 'no-store' : CACHE_CONTROL);
  res.end(html);
}

module.exports = (req, res) => handle(req, res);
module.exports.handle = handle;
module.exports.renderCard = renderCard;
module.exports.escapeTemplateText = escapeTemplateText;
