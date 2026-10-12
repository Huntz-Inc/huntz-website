'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HUNT_ORIGIN, CACHE_CONTROL, fetchPublicHunts } = require('./_lib/public-hunts');
const { escapeHtml } = require('./hunt');

async function handle(req, res, deps = {}) {
  const base = deps.baseSitemap ?? fs.readFileSync(path.join(process.cwd(), 'api/_lib/sitemap-base.xml'), 'utf8');
  const hunts = await fetchPublicHunts(deps);
  // On failure serve only the marketing URLs. Never retain old Hunt URLs when
  // their enrollment or visibility can no longer be confirmed.
  const urls = (hunts || []).map((hunt) =>
    `  <url><loc>${escapeHtml(HUNT_ORIGIN + '/hunt/' + encodeURIComponent(hunt.id))}</loc></url>`).join('\n');
  const xml = base.replace('</urlset>', () => (urls ? urls + '\n' : '') + '</urlset>');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', hunts === null ? 'no-store' : CACHE_CONTROL);
  res.end(xml);
}

module.exports = (req, res) => handle(req, res);
module.exports.handle = handle;
