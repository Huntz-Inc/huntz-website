'use strict';
// POST /api/contact — delivers one contact-form submission to team@huntz.ai.
//
// Zero-config Vercel Function: files under api/ that begin with an underscore
// are excluded from routing but are still bundled as imports of this route, so
// the whole endpoint ships without a package.json or a build step.

const { CONFIG, missing } = require('./_lib/config');
const { handle } = require('./_lib/handle');
const { send } = require('./_lib/smtp');

module.exports = async (req, res) => {
  // Vercel pauses background work the moment a response is sent, so delivery
  // is awaited rather than fired off.
  await handle(req, res, { config: CONFIG, missing, send, now: () => Date.now() });
};
