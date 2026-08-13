'use strict';
// GET /api/contact-token — issues the short-lived signed token the contact form
// must present. See api/_lib/token.js for what this does and does not defend.

const { CONFIG, missing } = require('./_lib/config');
const { mint } = require('./_lib/token');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: { code: 'method_not_allowed' } }));
  }
  // Without no-store a single cached token would be shared by every visitor,
  // which collapses both the minimum-completion-time floor and the expiry.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (missing(CONFIG).length) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: { code: 'unconfigured' } }));
  }
  res.statusCode = 200;
  res.end(JSON.stringify({ token: mint(CONFIG.tokenSecret, Date.now()) }));
};
