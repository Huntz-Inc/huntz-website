'use strict';
// Fixtures for the contact-endpoint tests.
//
// Nothing here is a credential; the values are obviously-fake test constants,
// and the real ones live only in Vercel's environment settings.

const http = require('node:http');
const net = require('node:net');
const nodemailer = require('nodemailer');
const { once } = require('node:events');

const TEST_PASSWORD = 'test-password-placeholder';

/**
 * A scripted SMTP server. It advertises exactly what Zoho advertises - AUTH and
 * SIZE, and nothing else, so no PIPELINING, no 8BITMIME, no SMTPUTF8 - and it
 * splits its greeting across two writes, so the client is tested against the
 * shape a real conversation has rather than a tidy one.
 */
async function startSmtpServer({ failAt = null, code = 550 } = {}) {
  const transcript = [];

  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    let buf = '';
    let dataMode = false;
    let body = '';
    const reply = (s) => sock.write(s);
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
          reply('250-mx.zohomail.com Hello\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 53477376\r\n');
        } else if (verb === 'AUTH') {
          reply(failAt === 'auth' ? '535 Authentication Failed\r\n' : '235 Authentication Successful\r\n');
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
          reply('250 ok\r\n');
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
    /** The message the server actually received, as it arrived on the wire. */
    received: () => (transcript.find((t) => t.cmd === 'BODY') || {}).body || '',
    commands: () => transcript.map((t) => t.cmd),
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * Boots the real endpoint on an ephemeral port, delivering through nodemailer
 * to the scripted server above - so the tests exercise the real transport,
 * not a stub of it.
 */
async function startServer({ smtpPort = null, noTransport = false } = {}) {
  const contact = require('../api/contact');
  // No port means the test never gets as far as delivery, so nodemailer's own
  // jsonTransport stands in: it composes a message and connects to nothing.
  const t = noTransport ? null : (smtpPort
    ? nodemailer.createTransport({
        host: '127.0.0.1', port: smtpPort, secure: false, ignoreTLS: true,
        auth: { user: 'team@huntz.ai', pass: TEST_PASSWORD }, name: 'huntz.ai',
      })
    : nodemailer.createTransport({ jsonTransport: true }));

  const server = http.createServer((req, res) => {
    contact.handle(req, res, t ? { transport: t } : {}).catch(() => {
      res.statusCode = 500; res.end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;

  return {
    base,
    close: async () => { if (t) t.close(); await new Promise((r) => server.close(r)); },
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

module.exports = { startServer, startSmtpServer, TEST_PASSWORD };
