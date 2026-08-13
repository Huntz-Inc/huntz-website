'use strict';
// Tests for POST /api/contact and its supporting modules.
//
//     node --test test/
//
// The delivery adapter is stubbed for the endpoint tests, and the SMTP client
// is driven against a scripted server that answers the way Zoho does, so the
// wire format is verified without sending real mail.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { CONFIG, TEST_SECRET, startServer, startSmtpServer } = require('./helpers');
const token = require('../api/_lib/token');
const message = require('../api/_lib/message');
const smtp = require('../api/_lib/smtp');
const ratelimit = require('../api/_lib/ratelimit');
const { validate } = require('../api/_lib/validate');

const NUL = String.fromCharCode(0);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

const GOOD = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  reason: 'partnership',
  message: 'Would like to talk about a collaboration.',
};

// A token minted far enough in the past to clear the minimum-completion floor.
const readyToken = (now = Date.now()) => token.mint(TEST_SECRET, now - (token.MIN_AGE_MS + 1000));

async function withServer(opts, fn) {
  ratelimit.reset();
  const s = await startServer(opts);
  try { return await fn(s); } finally { await s.close(); }
}

// ---------------------------------------------------------------- happy path

test('a valid submission is accepted and handed to the delivery adapter', async () => {
  await withServer({}, async (s) => {
    const res = await s.post({ ...GOOD, token: readyToken() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
    assert.equal(s.sent.length, 1, 'delivery adapter called exactly once');

    const msg = s.sent[0].message;
    assert.match(msg, /^From: "Huntz contact form" <team@huntz\.ai>\r\n/);
    assert.match(msg, /\r\nTo: <team@huntz\.ai>\r\n/);
    assert.match(msg, /\r\nSubject: Huntz contact form: Partnership\r\n/);
    assert.match(msg, /\r\nContent-Transfer-Encoding: base64\r\n/);

    const body = Buffer.from(msg.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
    assert.match(body, /Ada Lovelace/);
    assert.match(body, /Would like to talk about a collaboration\./);
  });
});

test('the visitor address is Reply-To only, never From and never the recipient', async () => {
  await withServer({}, async (s) => {
    await s.post({ ...GOOD, email: 'stranger@elsewhere.example', token: readyToken() });
    const msg = s.sent[0].message;
    const header = (name) => (msg.match(new RegExp('^' + name + ': (.*)$', 'm')) || [])[1];

    assert.equal(header('Reply-To'), '<stranger@elsewhere.example>');
    assert.equal(header('From'), '"Huntz contact form" <team@huntz.ai>');
    assert.equal(header('To'), '<team@huntz.ai>');
    assert.ok(!/^From:.*elsewhere\.example/m.test(msg), 'visitor domain never appears in From');
    // Envelope values come from config, not from the request.
    assert.equal(s.sent[0].cfg.envelopeFrom, 'team@huntz.ai');
    assert.equal(s.sent[0].cfg.recipient, 'team@huntz.ai');
  });
});

test('a recipient supplied by the client is refused, not honoured', async () => {
  await withServer({}, async (s) => {
    const res = await s.post({ ...GOOD, to: 'attacker@evil.example', token: readyToken() });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'rejected');
    assert.equal(s.sent.length, 0);
  });
});

// ---------------------------------------------------------------- validation

test('an invalid email is refused with a field-level error', async () => {
  await withServer({}, async (s) => {
    const res = await s.post({ ...GOOD, email: 'not-an-address', token: readyToken() });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_input');
    assert.ok(res.json.error.fieldErrors.email);
    assert.equal(s.sent.length, 0);
  });
});

test('missing required fields are reported per field', async () => {
  await withServer({}, async (s) => {
    const res = await s.post({ name: '', email: '', reason: '', message: '', token: readyToken() });
    assert.equal(res.status, 400);
    assert.deepEqual(
      Object.keys(res.json.error.fieldErrors).sort(),
      ['email', 'message', 'name', 'reason'],
    );
    assert.equal(s.sent.length, 0);
  });
});

test('oversized fields are refused, measured in UTF-8 octets', async () => {
  await withServer({}, async (s) => {
    const long = await s.post({ ...GOOD, message: 'x'.repeat(5001), token: readyToken() });
    assert.equal(long.status, 400);
    assert.ok(long.json.error.fieldErrors.message);

    // 97 ASCII + one 4-octet emoji = 101 octets but only 99 UTF-16 units, so a
    // String.length check would wave this through.
    const name = 'A'.repeat(97) + String.fromCodePoint(0x1f600);
    assert.equal(name.length, 99);
    const emoji = await s.post({ ...GOOD, name, token: readyToken() });
    assert.equal(emoji.status, 400);
    assert.ok(emoji.json.error.fieldErrors.name);
    assert.equal(s.sent.length, 0);
  });
});

test('an oversized request body is refused before it is parsed', async () => {
  await withServer({}, async (s) => {
    const res = await s.post(JSON.stringify({ ...GOOD, message: 'x'.repeat(40000) }));
    assert.equal(res.status, 413);
    assert.equal(s.sent.length, 0);
  });
});

test('an unknown reason value is refused', async () => {
  await withServer({}, async (s) => {
    const res = await s.post({ ...GOOD, reason: 'anything-else', token: readyToken() });
    assert.equal(res.status, 400);
    assert.ok(res.json.error.fieldErrors.reason);
    assert.equal(s.sent.length, 0);
  });
});

test('CRLF and header-injection attempts never reach a header', async () => {
  const attacks = [
    'a@b.com' + CR + LF + 'Bcc: attacker@evil.example',
    'a@b.com' + LF + 'Bcc: attacker@evil.example',
    'a@b.com' + CR + 'Bcc: attacker@evil.example',
    'a@b.com, attacker@evil.example',
    'a@b.com> <attacker@evil.example',
    'a@b.com' + NUL + 'x',
  ];
  await withServer({}, async (s) => {
    for (const email of attacks) {
      const res = await s.post({ ...GOOD, email, token: readyToken() });
      assert.equal(res.status, 400, 'refused: ' + JSON.stringify(email));
      assert.ok(res.json.error.fieldErrors.email);
    }
    assert.equal(s.sent.length, 0);
  });

  // And the composer refuses independently, so a future caller cannot bypass
  // validation and still emit a spliced header.
  assert.throws(() => message.assertHeaderSafe('Subject: a' + CR + LF + 'Bcc: x@y'), /unsafe_header/);
  assert.throws(() => message.assertHeaderSafe('Subject: a' + LF + 'Bcc: x@y'), /unsafe_header/);
  assert.throws(() => message.assertHeaderSafe('Subject: ' + NUL), /unsafe_header/);
  assert.throws(() => message.assertHeaderSafe(' Subject: folded'), /unsafe_header/);
});

// --------------------------------------------------------------- abuse gates

test('a filled honeypot is refused without a hint that it was the honeypot', async () => {
  await withServer({}, async (s) => {
    const res = await s.post({ ...GOOD, company: 'Acme', token: readyToken() });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'rejected');
    assert.ok(!/honey|trap|bot/i.test(JSON.stringify(res.json)));
    assert.equal(s.sent.length, 0);
  });
});

test('a submission faster than a human can type is refused', async () => {
  await withServer({}, async (s) => {
    const res = await s.post({ ...GOOD, token: token.mint(TEST_SECRET, Date.now()) });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'rejected');
    assert.equal(s.sent.length, 0);
  });
});

test('a missing, forged, or expired token is refused', async () => {
  await withServer({}, async (s) => {
    const now = Date.now();
    const cases = [
      undefined,
      '',
      'garbage',
      '1.' + (now - 10000) + '.wrongsignature',
      token.mint('a-different-secret-entirely-xxxxxxxxx', now - 10000),
      token.mint(TEST_SECRET, now - (token.MAX_AGE_MS + 60000)),
    ];
    for (const t of cases) {
      const res = await s.post({ ...GOOD, token: t });
      assert.equal(res.status, 403, 'refused token: ' + String(t).slice(0, 24));
    }
    assert.equal(s.sent.length, 0);
  });
});

test('repeated submissions from one caller are throttled with Retry-After', async () => {
  await withServer({}, async (s) => {
    let last;
    for (let i = 0; i < ratelimit.MAX_PER_WINDOW + 1; i++) {
      last = await s.post({ ...GOOD, token: readyToken() });
    }
    assert.equal(last.status, 429);
    assert.equal(last.json.error.code, 'rate_limited');
    assert.ok(Number(last.headers.get('retry-after')) > 0);
    assert.equal(s.sent.length, ratelimit.MAX_PER_WINDOW);
  });
});

// -------------------------------------------------------------- failure path

test('a delivery failure is reported generically and leaks nothing', async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (...a) => errors.push(a);
  try {
    await withServer({
      send: async () => { const e = new Error('smtp_auth_535'); e.stage = 'auth'; e.code = 535; throw e; },
    }, async (s) => {
      const res = await s.post({ ...GOOD, token: readyToken() });
      assert.equal(res.status, 502);
      assert.equal(res.json.error.code, 'delivery_failed');
      assert.equal(res.json.error.message, 'We could not send that just now.');
      // The public body names no host, credential, mailbox or SMTP internals.
      const seen = JSON.stringify(res.json);
      for (const secret of ['zoho', 'AUTH', 'password', CONFIG.pass, TEST_SECRET, GOOD.email]) {
        assert.ok(!seen.includes(secret), 'public error leaks ' + secret);
      }
      assert.ok(res.json.error.correlationId, 'operator gets a correlation id');
    });
  } finally { console.error = originalError; }

  // Logs carry diagnostics, never the visitor's identity or prose.
  const logged = JSON.stringify(errors);
  for (const pii of [GOOD.email, GOOD.name, GOOD.message, CONFIG.pass, TEST_SECRET]) {
    assert.ok(!logged.includes(pii), 'log leaks ' + pii);
  }
  assert.ok(logged.includes('535'), 'log keeps the SMTP code');
});

test('a half-configured deployment fails closed rather than pretending to send', async () => {
  await withServer({ config: { ...CONFIG, pass: '' } }, async (s) => {
    const res = await s.post({ ...GOOD, token: readyToken() });
    assert.equal(res.status, 503);
    assert.equal(res.json.error.code, 'unconfigured');
    assert.equal(s.sent.length, 0);
  });
});

test('only POST is accepted', async () => {
  await withServer({}, async (s) => {
    const res = await fetch(s.base + '/api/contact', { method: 'GET' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
  });
});

test('a non-JSON content type is refused', async () => {
  await withServer({}, async (s) => {
    const res = await s.post('name=Ada', { 'Content-Type': 'text/plain' });
    assert.equal(res.status, 415);
    assert.equal(s.sent.length, 0);
  });
});

test('malformed JSON is refused without crashing', async () => {
  await withServer({}, async (s) => {
    const res = await s.post('{"name":');
    assert.equal(res.status, 400);
    assert.equal(s.sent.length, 0);
  });
});

// --------------------------------------------------------------- SMTP client

test('the SMTP conversation matches what Zoho expects', async () => {
  const server = await startSmtpServer();
  try {
    const cfg = { ...CONFIG, host: '127.0.0.1', port: server.port };
    const msg = message.compose(
      { ...GOOD, reasonLabel: 'Partnership' }, cfg, new Date(0), 'test@huntz.ai');
    const out = await smtp.send(cfg, msg, ({ port }) => {
      const s = net.connect({ host: '127.0.0.1', port });
      return new Promise((res, rej) => { s.once('connect', () => res(s)); s.once('error', rej); });
    });
    assert.equal(out.accepted, true);

    const cmds = server.transcript.map((t) => t.cmd);
    assert.equal(cmds[0], 'EHLO huntz.ai');
    assert.equal(cmds[1], 'AUTH LOGIN');
    assert.equal(Buffer.from(cmds[2], 'base64').toString(), 'team@huntz.ai');
    assert.equal(Buffer.from(cmds[3], 'base64').toString(), CONFIG.pass);
    assert.equal(cmds[4], 'MAIL FROM:<team@huntz.ai>');
    assert.equal(cmds[5], 'RCPT TO:<team@huntz.ai>');
    assert.equal(cmds[6], 'DATA');

    const received = server.transcript.find((t) => t.cmd === 'BODY').body;
    assert.match(received, /^From: "Huntz contact form"/);
    assert.ok(!/[^\r]\n/.test(received), 'every line ends CRLF');
    for (const line of received.split('\r\n')) {
      assert.ok(Buffer.byteLength(line, 'utf8') <= 998, 'line within the RFC 5321 limit');
    }
  } finally { await server.close(); }
});

test('a body line of a single dot cannot terminate DATA early', async () => {
  const server = await startSmtpServer();
  try {
    const cfg = { ...CONFIG, host: '127.0.0.1', port: server.port };
    // The classic relay-injection payload, verbatim.
    const evil = ['start', '.', 'MAIL FROM:<spam@evil.example>', 'RCPT TO:<victim@example.com>', 'DATA', 'spam'].join('\n');
    const msg = message.compose(
      { ...GOOD, message: evil, reasonLabel: 'Partnership' }, cfg, new Date(0), 'test@huntz.ai');
    await smtp.send(cfg, msg, ({ port }) => {
      const s = net.connect({ host: '127.0.0.1', port });
      return new Promise((res, rej) => { s.once('connect', () => res(s)); s.once('error', rej); });
    });
    const cmds = server.transcript.map((t) => t.cmd);
    assert.equal(cmds.filter((c) => c.startsWith('MAIL FROM')).length, 1, 'exactly one envelope');
    assert.equal(cmds.filter((c) => c.startsWith('RCPT TO')).length, 1, 'exactly one recipient');
    assert.ok(!cmds.some((c) => c.includes('evil.example')), 'no injected command was executed');

    const received = server.transcript.find((t) => t.cmd === 'BODY').body;
    const decoded = Buffer.from(received.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
    assert.match(decoded, /MAIL FROM:<spam@evil\.example>/, 'the payload survives intact as text');
  } finally { await server.close(); }
});

test('dot-stuffing is applied even to a line that starts the message', () => {
  assert.equal(message.dotStuff('.hello\r\n'), '..hello\r\n');
  assert.equal(message.dotStuff('a\r\n.\r\n'), 'a\r\n..\r\n');
  assert.equal(message.dotStuff('a\r\n..b\r\n'), 'a\r\n...b\r\n');
});

test('an SMTP rejection surfaces its stage and code without the credential', async () => {
  const server = await startSmtpServer({ failAt: 'auth' });
  try {
    const cfg = { ...CONFIG, host: '127.0.0.1', port: server.port };
    await assert.rejects(
      smtp.send(cfg, 'From: x\r\n\r\n', ({ port }) => {
        const s = net.connect({ host: '127.0.0.1', port });
        return new Promise((res, rej) => { s.once('connect', () => res(s)); s.once('error', rej); });
      }),
      (e) => {
        assert.equal(e.stage, 'auth');
        assert.equal(e.code, 535);
        assert.ok(!String(e.message + e.detail).includes(CONFIG.pass), 'no credential in the error');
        return true;
      },
    );
  } finally { await server.close(); }
});

test('TLS is dialled with SNI, hostname verification and a modern floor', () => {
  const o = smtp.tlsOptions({ host: 'smtppro.zoho.com', port: 465 });
  assert.equal(o.servername, 'smtppro.zoho.com', 'Node omits SNI unless servername is set');
  assert.equal(o.rejectUnauthorized, true);
  assert.equal(o.minVersion, 'TLSv1.2');
});

// ------------------------------------------------------------------- tokens

test('tokens are unforgeable, floored and expiring', () => {
  const now = 1_700_000_000_000;
  const t = token.mint(TEST_SECRET, now);
  assert.equal(token.verify(TEST_SECRET, t, now + 5000).ok, true);
  assert.equal(token.verify(TEST_SECRET, t, now + 1000).reason, 'too_fast');
  assert.equal(token.verify(TEST_SECRET, t, now - 1000).reason, 'too_fast');
  assert.equal(token.verify(TEST_SECRET, t, now + token.MAX_AGE_MS + 1).reason, 'expired');
  assert.equal(token.verify('another-secret-entirely-xxxxxxxxxxxx', t, now + 5000).reason, 'bad_signature');
  assert.equal(token.verify(TEST_SECRET, t.slice(0, -1) + 'A', now + 5000).reason, 'bad_signature');
  assert.equal(token.verify(TEST_SECRET, 'x'.repeat(500), now).reason, 'malformed');
  // The issued-at is public; the signature is what cannot be produced.
  assert.equal(token.mint(TEST_SECRET, now), t, 'minting is deterministic for a given instant');
});

test('validation accepts every offered reason and nothing else', () => {
  for (const r of ['create-a-hunt', 'partnership', 'press', 'general-question', 'website-issue']) {
    assert.equal(validate({ ...GOOD, reason: r }).ok, true, r);
  }
  assert.equal(validate({ ...GOOD, reason: 'other' }).ok, false);
});
