'use strict';
// Delivery configuration. Everything the visitor must never influence lives
// here as a constant: the recipient, the envelope sender and the From header
// are compile-time values, so no request can redirect a message or forge a
// sender. Only the credential and the token secret come from the environment.

// Zoho rejects a From that is not the authenticated mailbox or one of its
// aliases ("553 Relaying disallowed"), so these three are deliberately equal.
const MAILBOX = 'team@huntz.ai';

const CONFIG = {
  recipient: MAILBOX,
  envelopeFrom: MAILBOX,
  fromHeader: '"Huntz contact form" <' + MAILBOX + '>',
  // Paid Zoho custom-domain mailboxes are on smtppro; free/personal ones on
  // smtp. Port 465 is implicit TLS — Vercel blocks outbound port 25 only.
  host: process.env.HUNTZ_SMTP_HOST || 'smtppro.zoho.com',
  port: Number(process.env.HUNTZ_SMTP_PORT || 465),
  user: process.env.HUNTZ_SMTP_USER || MAILBOX,
  pass: process.env.HUNTZ_SMTP_PASSWORD || '',
  tokenSecret: process.env.HUNTZ_CONTACT_TOKEN_SECRET || '',
  // EHLO argument. Never a hostname taken from the request.
  ehloName: 'huntz.ai',
  socketTimeoutMs: 15000,
};

// Missing configuration fails closed and is reported as "unconfigured", so a
// half-provisioned deployment cannot look like a working form.
function missing(cfg) {
  const gaps = [];
  if (!cfg.pass) gaps.push('HUNTZ_SMTP_PASSWORD');
  if (!cfg.tokenSecret || cfg.tokenSecret.length < 24) gaps.push('HUNTZ_CONTACT_TOKEN_SECRET');
  if (!cfg.host || !Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) gaps.push('HUNTZ_SMTP_HOST/PORT');
  return gaps;
}

module.exports = { CONFIG, MAILBOX, missing };
