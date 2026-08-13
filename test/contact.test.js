'use strict';
// Tests for POST /api/contact.
//
//     npm test          (or: node --test "test/*.test.js")
//
// Delivery runs through the real nodemailer transport into a scripted SMTP
// server that answers the way Zoho does, so the wire format and the refusal
// paths are verified without sending mail anywhere.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, startSmtpServer, TEST_PASSWORD } = require('./helpers');
const { validate } = require('../api/_lib/validate');
const contact = require('../api/contact');

const NUL = String.fromCharCode(0);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

const GOOD = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  reason: 'partnership',
  message: 'Would like to talk about a collaboration.',
};

// Every test that needs a mailbox gets a fresh scripted server plus the real
// endpoint in front of it.
async function withMail(opts, fn) {
  const smtp = await startSmtpServer(opts);
  const s = await startServer({ smtpPort: smtp.port });
  try { return await fn(s, smtp); } finally { await s.close(); await smtp.close(); }
}

// Refusal tests never reach a transport, so they do not need one.
async function withServer(fn) {
  const s = await startServer({});
  try { return await fn(s); } finally { await s.close(); }
}

// ------------------------------------------------------------- valid delivery

test('a valid submission is delivered, and the message says what it should', async () => {
  await withMail({}, async (s, smtp) => {
    const res = await s.post(GOOD);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });

    const cmds = smtp.commands();
    assert.equal(cmds.filter((c) => c.startsWith('MAIL FROM')).length, 1);
    assert.equal(cmds.filter((c) => c.startsWith('RCPT TO')).length, 1);
    assert.ok(cmds.includes('MAIL FROM:<team@huntz.ai>'), 'envelope sender is our own mailbox');
    assert.ok(cmds.includes('RCPT TO:<team@huntz.ai>'), 'recipient is the compile-time constant');

    const msg = smtp.received();
    const header = (n) => (msg.match(new RegExp('^' + n + ': (.*)$', 'm')) || [])[1];
    assert.equal(header('Reply-To'), 'ada@example.com');
    assert.match(header('From'), /<team@huntz\.ai>$/);
    assert.equal(header('Subject'), 'Huntz contact form: Partnership');
    assert.ok(/^Date: /m.test(msg) && /^Message-ID: /m.test(msg));
    assert.match(msg, /Ada Lovelace/);
    assert.match(msg, /Would like to talk about a collaboration\./);
  });
});

test('the visitor address is Reply-To only, and never From', async () => {
  await withMail({}, async (s, smtp) => {
    await s.post({ ...GOOD, email: 'stranger@elsewhere.example' });
    const msg = smtp.received();
    assert.match(msg, /^Reply-To: stranger@elsewhere\.example$/m);
    assert.ok(!/^From:.*elsewhere\.example/m.test(msg), 'visitor domain never appears in From');
    assert.ok(!/^To:.*elsewhere\.example/m.test(msg), 'visitor never becomes a recipient');
    assert.ok(!smtp.commands().some((c) => c.includes('elsewhere.example')), 'nor in the envelope');
  });
});

test('a recipient supplied by the client is refused, not honoured', async () => {
  await withServer(async (s) => {
    const res = await s.post({ ...GOOD, to: 'attacker@evil.example' });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'rejected');
  });
});

test('non-ASCII survives the trip without putting high bytes on the wire', async () => {
  await withMail({}, async (s, smtp) => {
    // Zoho advertises no 8BITMIME, so raw UTF-8 in DATA would be out of spec.
    const res = await s.post({ ...GOOD, name: 'Ada Løvelace', message: 'naïve café 日本語' });
    assert.equal(res.status, 200);
    const msg = smtp.received();
    assert.ok(Buffer.from(msg, 'utf8').every((b) => b < 128), 'message is 7-bit clean on the wire');
    for (const line of msg.split('\r\n')) {
      assert.ok(Buffer.byteLength(line, 'utf8') <= 998, 'line within the RFC 5321 limit');
    }
    assert.match(msg, /charset=utf-8/i);
  });
});

// ------------------------------------------------------------ malformed input

test('an invalid email is refused with a field-level error', async () => {
  await withServer(async (s) => {
    const res = await s.post({ ...GOOD, email: 'not-an-address' });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_input');
    assert.ok(res.json.error.fieldErrors.email);
  });
});

test('missing required fields are reported per field', async () => {
  await withServer(async (s) => {
    const res = await s.post({ name: '', email: '', reason: '', message: '' });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.json.error.fieldErrors).sort(),
      ['email', 'message', 'name', 'reason']);
  });
});

test('oversized fields are refused, measured in UTF-8 octets', async () => {
  await withServer(async (s) => {
    const long = await s.post({ ...GOOD, message: 'x'.repeat(5001) });
    assert.equal(long.status, 400);
    assert.ok(long.json.error.fieldErrors.message);

    // 97 ASCII + one 4-octet emoji is 101 octets but only 99 UTF-16 units, so a
    // String.length check would wave this through.
    const name = 'A'.repeat(97) + String.fromCodePoint(0x1f600);
    assert.equal(name.length, 99);
    const emoji = await s.post({ ...GOOD, name });
    assert.equal(emoji.status, 400);
    assert.ok(emoji.json.error.fieldErrors.name);
  });
});

test('an oversized request body is refused before it is parsed', async () => {
  await withServer(async (s) => {
    const res = await s.post(JSON.stringify({ ...GOOD, message: 'x'.repeat(40000) }));
    assert.equal(res.status, 413);
  });
});

test('an unknown reason value is refused', async () => {
  await withServer(async (s) => {
    const res = await s.post({ ...GOOD, reason: 'anything-else' });
    assert.equal(res.status, 400);
    assert.ok(res.json.error.fieldErrors.reason);
  });
});

test('only POST is accepted', async () => {
  await withServer(async (s) => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(s.base + '/api/contact', { method });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get('allow'), 'POST');
    }
  });
});

test('a non-JSON content type and malformed JSON are both refused', async () => {
  await withServer(async (s) => {
    assert.equal((await s.post('name=Ada', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await s.post('{"name":')).status, 400);
  });
});

// --------------------------------------------------------------- injection

test('header-injection attempts are refused and never reach the wire', async () => {
  const attacks = [
    'a@b.com' + CR + LF + 'Bcc: attacker@evil.example',
    'a@b.com' + LF + 'Bcc: attacker@evil.example',
    'a@b.com' + CR + 'Bcc: attacker@evil.example',
    'a@b.com, attacker@evil.example',
    'a@b.com> <attacker@evil.example',
    'a@b.com' + NUL + 'x',
    '"a"@b.com' + LF + 'X-Injected: 1',
  ];
  await withMail({}, async (s, smtp) => {
    for (const email of attacks) {
      const res = await s.post({ ...GOOD, email });
      assert.equal(res.status, 400, 'refused: ' + JSON.stringify(email));
      assert.ok(res.json.error.fieldErrors.email);
    }
    assert.equal(smtp.commands().length, 0, 'no SMTP conversation was ever opened');
  });
});

test('control characters in the name and message are refused', async () => {
  await withServer(async (s) => {
    assert.ok((await s.post({ ...GOOD, name: 'Ada' + NUL })).json.error.fieldErrors.name);
    assert.ok((await s.post({ ...GOOD, message: 'hi' + NUL + 'there' })).json.error.fieldErrors.message);
  });
});

test('a body line of a single dot cannot terminate DATA early', async () => {
  await withMail({}, async (s, smtp) => {
    // The classic relay-injection payload, verbatim.
    const evil = ['start', '.', 'MAIL FROM:<spam@evil.example>', 'RCPT TO:<victim@example.com>', 'DATA', 'spam'].join('\n');
    assert.equal((await s.post({ ...GOOD, message: evil })).status, 200);

    const cmds = smtp.commands();
    assert.equal(cmds.filter((c) => c.startsWith('MAIL FROM')).length, 1, 'exactly one envelope');
    assert.equal(cmds.filter((c) => c.startsWith('RCPT TO')).length, 1, 'exactly one recipient');
    assert.ok(!cmds.some((c) => c.includes('evil.example')), 'no injected command was executed');
    assert.match(smtp.received(), /MAIL FROM:<spam@evil\.example>/, 'the payload survives as text');
  });
});

// ------------------------------------------------- defects found under review

test('a hostile JSON type is refused, not thrown out of validation', async () => {
  // An object whose own toString is a non-callable value has no ToPrimitive
  // path, so String() on it throws. name and the honeypot were the two fields
  // coerced without a typeof guard, and validate() is called outside the only
  // try/catch — so this used to leave the request unanswered.
  const hostile = { toString: 1 };
  await withServer(async (s) => {
    for (const body of [
      { ...GOOD, name: hostile },
      { ...GOOD, company: hostile },
      { ...GOOD, name: ['Ada', hostile] },
      { ...GOOD, name: 42 },
      { ...GOOD, name: null },
      { ...GOOD, company: {} },
      { ...GOOD, email: { toString: 1 } },
      { ...GOOD, message: [hostile] },
    ]) {
      const res = await s.post(body);
      assert.equal(res.status, 400, 'answered: ' + JSON.stringify(Object.keys(body)));
      assert.ok(res.json && res.json.error, 'a refusal envelope came back');
    }
  });
});

test('validate never throws, whatever shape the body is', () => {
  const shapes = [
    { name: { toString: 1 } }, { company: { toString: 1 } }, { name: Object.create(null) },
    { name: [] }, { name: {} }, { company: [] }, { company: 0 }, { company: false },
    JSON.parse('{"__proto__":{"polluted":true}}'), { constructor: 'x' },
    {}, { name: undefined }, { message: { toString: 1 } },
  ];
  for (const raw of shapes) {
    assert.doesNotThrow(() => validate(raw), JSON.stringify(raw));
  }
  assert.equal({}.polluted, undefined, 'no prototype pollution');
});

test('a cross-origin form POST cannot reach the endpoint', async () => {
  // application/json is not a CORS "simple" content type, so a third-party
  // page cannot produce this request without a preflight it will not survive.
  // The three content types a plain <form> can send must all be refused —
  // including when the host has already parsed the body into an object.
  await withMail({}, async (s, smtp) => {
    const form = 'name=Ada&email=ada%40example.com&reason=press&message=hi';
    for (const ct of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data']) {
      const res = await s.post(form, { 'Content-Type': ct });
      assert.equal(res.status, 415, ct);
    }
    // …and the same body pre-parsed by the host, as Vercel would hand it over.
    const preParsed = await new Promise((resolve) => {
      const http = require('node:http');
      const req = http.request(s.base + '/api/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }, (r) => { r.resume(); resolve(r.statusCode); });
      req.end(form);
    });
    assert.equal(preParsed, 415);
    assert.equal(smtp.commands().length, 0, 'nothing was sent');
  });
});

test('an oversize chunked body gets a 413, not a dropped connection', async () => {
  // With Transfer-Encoding: chunked there is no Content-Length to check, so the
  // streaming cap is the only ceiling. Destroying the socket there lost the
  // response envelope and the caller saw ECONNRESET instead of a refusal.
  await withServer(async (s) => {
    const http = require('node:http');
    const status = await new Promise((resolve, reject) => {
      const req = http.request(s.base + '/api/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      }, (r) => { r.resume(); resolve(r.statusCode); });
      req.on('error', reject);
      req.write('{"message":"' + 'x'.repeat(40000));
      req.end('"}');
    });
    assert.equal(status, 413);
  });
});

// --------------------------------------------------------------- honeypot

test('a filled honeypot is refused without hinting that it was the honeypot', async () => {
  await withMail({}, async (s, smtp) => {
    const res = await s.post({ ...GOOD, company: 'Acme' });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'rejected');
    assert.ok(!/honey|trap|bot|company/i.test(JSON.stringify(res.json)));
    assert.equal(smtp.commands().length, 0, 'nothing was sent');
  });
});

// ---------------------------------------------------------- failure handling

test('a delivery failure is reported generically and leaks nothing', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  try {
    await withMail({ failAt: 'auth' }, async (s) => {
      const res = await s.post(GOOD);
      assert.equal(res.status, 502);
      assert.equal(res.json.error.code, 'delivery_failed');
      assert.equal(res.json.error.message, 'We could not send that just now.');
      const seen = JSON.stringify(res.json);
      for (const leak of ['zoho', 'AUTH', 'password', TEST_PASSWORD, GOOD.email]) {
        assert.ok(!seen.includes(leak), 'public error leaks ' + leak);
      }
    });
  } finally { console.error = original; }

  const logged = JSON.stringify(errors);
  for (const pii of [GOOD.email, GOOD.name, GOOD.message, TEST_PASSWORD]) {
    assert.ok(!logged.includes(pii), 'log leaks ' + pii);
  }
});

test('a refused recipient is also reported generically', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    await withMail({ failAt: 'rcpt_to' }, async (s) => {
      const res = await s.post(GOOD);
      assert.equal(res.status, 502);
      assert.equal(res.json.error.code, 'delivery_failed');
    });
  } finally { console.error = original; }
});

test('a half-configured deployment fails closed rather than pretending to send', async () => {
  const original = console.error;
  const saved = contact.CONFIG.pass;
  console.error = () => {};
  contact.CONFIG.pass = '';
  try {
    // No stand-in transport here: this is the path where the endpoint would
    // have had to build its own, and has no credential to do it with.
    const s = await startServer({ noTransport: true });
    try {
      const res = await s.post(GOOD);
      assert.equal(res.status, 503);
      assert.equal(res.json.error.code, 'unconfigured');
    } finally { await s.close(); }
  } finally { contact.CONFIG.pass = saved; console.error = original; }
});

// ------------------------------------------------------------------ secrets

test('no credential is hard-coded anywhere in the endpoint', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'api');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else if (f.endsWith('.js')) files.push(f);
    }
  })(dir);
  assert.equal(files.length, 2, 'the endpoint is two files: the route and its validator');
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/pass\s*:\s*['"][^'"]+['"]/.test(src), f + ' hard-codes a password');
    assert.match(src.includes('HUNTZ_SMTP_PASSWORD') ? src : 'process.env',
      /process\.env/, 'the credential only ever comes from the environment');
  }
});

test('validation accepts every offered reason and nothing else', () => {
  for (const r of ['create-a-hunt', 'partnership', 'press', 'general-question', 'website-issue']) {
    assert.equal(validate({ ...GOOD, reason: r }).ok, true, r);
  }
  assert.equal(validate({ ...GOOD, reason: 'other' }).ok, false);
});
