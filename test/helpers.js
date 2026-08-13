'use strict';
// Shared fixtures for the contact-endpoint tests.
//
// Nothing in here is a credential. The values below are obviously-fake test
// constants; the real ones live only in Vercel's environment settings.

const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');

const TEST_SECRET = 'test-token-secret-not-used-anywhere-real';
const TEST_PASSWORD = 'test-password-placeholder';

const CONFIG = {
  recipient: 'team@huntz.ai',
  envelopeFrom: 'team@huntz.ai',
  fromHeader: '"Huntz contact form" <team@huntz.ai>',
  host: 'smtp.invalid',
  port: 465,
  user: 'team@huntz.ai',
  pass: TEST_PASSWORD,
  tokenSecret: TEST_SECRET,
  ehloName: 'huntz.ai',
  socketTimeoutMs: 2000,
};

const missing = require('../api/_lib/config').missing;

/** Boots the real handler on an ephemeral port with a stubbed delivery adapter. */
async function startServer({ config = CONFIG, now = () => Date.now(), send } = {}) {
  const { handle } = require('../api/_lib/handle');
  const sent = [];
  const adapter = send || (async (cfg, message) => { sent.push({ cfg, message }); return { accepted: true }; });
  const server = http.createServer((req, res) => {
    handle(req, res, { config, missing, send: adapter, now }).catch(() => {
      res.statusCode = 500; res.end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    base,
    sent,
    close: () => new Promise((r) => server.close(r)),
    post: async (body, headers = {}) => {
      const res = await fetch(base + '/api/contact', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      return { status: res.status, json, headers: res.headers };
    },
  };
}

/**
 * A scripted SMTP server over plain TCP. Replies are deliberately split across
 * writes and include multi-line 250 blocks, so the client's reply reader is
 * tested against the shape Zoho actually sends rather than a tidy one.
 */
async function startSmtpServer({ failAt = null, code = 550 } = {}) {
  const transcript = [];
  let dataMode = false;
  let body = '';

  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    let buf = '';
    const reply = (s) => sock.write(s);
    // Split the greeting mid-line to prove the reader buffers across reads.
    sock.write('220 mx.zohomail.com SMTP Server');
    setTimeout(() => sock.write(' ready\r\n'), 5);

    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (dataMode) {
          if (line === '.') {
            dataMode = false;
            transcript.push({ cmd: 'BODY', body });
            reply(failAt === 'body' ? code + ' rejected\r\n' : '250 2.0.0 OK\r\n');
          } else {
            body += line + '\r\n';
          }
          continue;
        }
        transcript.push({ cmd: line });
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO') {
          if (failAt === 'ehlo') { reply(code + ' no\r\n'); continue; }
          // Multi-line, continuation-then-final, exactly as Zoho answers.
          reply('250-mx.zohomail.com Hello\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 53477376\r\n');
        } else if (verb === 'AUTH') {
          reply('334 VXNlcm5hbWU6\r\n');
        } else if (verb === 'MAIL') {
          reply(failAt === 'mail_from' ? code + ' no\r\n' : '250 2.1.0 Ok\r\n');
        } else if (verb === 'RCPT') {
          reply(failAt === 'rcpt_to' ? code + ' no\r\n' : '250 2.1.5 Ok\r\n');
        } else if (verb === 'DATA') {
          dataMode = true;
          reply('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (verb === 'QUIT') {
          reply('221 closing\r\n'); sock.end();
        } else {
          // The two base64 AUTH continuation lines land here.
          const seen = transcript.filter((t) => /^[A-Za-z0-9+/=]+$/.test(t.cmd)).length;
          if (seen === 1) reply('334 UGFzc3dvcmQ6\r\n');
          else reply(failAt === 'auth' ? '535 Authentication Failed\r\n' : '235 Authentication Successful\r\n');
        }
      }
    });
    sock.on('error', () => {});
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port,
    transcript,
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { CONFIG, TEST_SECRET, TEST_PASSWORD, startServer, startSmtpServer };
