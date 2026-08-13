'use strict';
// A minimal SMTP submission client, one message per connection.
//
// Written by hand rather than pulled from npm so the repository keeps its
// defining property: no package.json, no dependency install, nothing to build
// at deploy time. The surface it has to cover is correspondingly small - one
// authenticated submission to one known server - and the protocol facts it
// relies on were measured against Zoho directly:
//
//   * port 465 is implicit TLS, so the socket is encrypted from the first byte
//     and there is no STARTTLS dance;
//   * Zoho advertises AUTH LOGIN and PLAIN and SIZE, and nothing else - no
//     PIPELINING, so every command waits for its reply before the next is
//     written;
//   * replies are multi-line, "NNN-" for a continuation and "NNN " for the
//     last line, and a single socket read is not guaranteed to hold exactly
//     one reply.
//
// Nothing here ever logs, throws or returns a credential.

const tls = require('node:tls');
const { CRLF, dotStuff } = require('./message');

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

class SmtpError extends Error {
  constructor(stage, code, text) {
    super('smtp_' + stage + (code ? '_' + code : ''));
    this.stage = stage;
    this.code = code || 0;
    // Kept for the server log only. Never contains a credential: the stages
    // that carry one report their stage name and nothing else.
    this.detail = text || '';
  }
}

// Buffers socket data and hands back one complete reply at a time.
function makeReader(socket, limit = 65536) {
  let buf = '';
  let waiter = null;
  let failure = null;

  const settle = () => {
    if (!waiter) return;
    if (failure) {
      const w = waiter; waiter = null; w.reject(failure);
      return;
    }
    // A reply is complete at the first line whose code is followed by a space
    // rather than a hyphen. Anything after it belongs to the next reply.
    const lines = buf.split(CRLF);
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i])) {
        const reply = lines.slice(0, i + 1);
        buf = lines.slice(i + 1).join(CRLF);
        const w = waiter; waiter = null;
        w.resolve({ code: Number(lines[i].slice(0, 3)), lines: reply });
        return;
      }
    }
  };

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > limit) failure = new SmtpError('reply_too_large');
    settle();
  });
  socket.on('error', (e) => { failure = failure || e; settle(); });
  socket.on('close', () => { failure = failure || new SmtpError('connection_closed'); settle(); });
  socket.on('timeout', () => { failure = failure || new SmtpError('timeout'); socket.destroy(); settle(); });

  return {
    read: () => new Promise((resolve, reject) => { waiter = { resolve, reject }; settle(); }),
  };
}

// Node's tls.connect does not send SNI unless servername is passed, and setting
// it to anything other than the dialed host breaks hostname verification. Zoho's
// banner name (mx.zohomail.com) deliberately differs from its certificate, so
// the dialed host is the only correct value.
function tlsOptions({ host, port }) {
  return { host, port, servername: host, minVersion: 'TLSv1.2', rejectUnauthorized: true };
}

function connect({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(tlsOptions({ host, port }));
    socket.setTimeout(timeoutMs);
    const onFail = (e) => { socket.destroy(); reject(e instanceof Error ? e : new SmtpError('connect')); };
    socket.once('error', onFail);
    socket.once('timeout', () => onFail(new SmtpError('connect_timeout')));
    socket.once('secureConnect', () => {
      socket.removeListener('error', onFail);
      resolve(socket);
    });
  });
}

/**
 * Deliver one already-composed message.
 * @param {{host,port,user,pass,envelopeFrom,recipient,ehloName,socketTimeoutMs}} cfg
 * @param {string} message  full RFC 5322 message, CRLF line endings
 * @param {(o:object)=>Promise<any>} [connectFn]  seam for tests
 */
async function send(cfg, message, connectFn = connect) {
  const socket = await connectFn({ host: cfg.host, port: cfg.port, timeoutMs: cfg.socketTimeoutMs });
  const reader = makeReader(socket);

  const expect = async (stage, codes) => {
    const reply = await reader.read();
    if (!codes.includes(reply.code)) throw new SmtpError(stage, reply.code, reply.lines.join(' | '));
    return reply;
  };
  // `stage` never names the value being sent, so a failing AUTH cannot put a
  // credential into an error message or a log line.
  const say = async (line, stage, codes) => {
    socket.write(line + CRLF);
    return expect(stage, codes);
  };

  try {
    await expect('greeting', [220]);
    await say('EHLO ' + cfg.ehloName, 'ehlo', [250]);

    await say('AUTH LOGIN', 'auth_start', [334]);
    await say(b64(cfg.user), 'auth_user', [334]);
    await say(b64(cfg.pass), 'auth', [235]);

    await say('MAIL FROM:<' + cfg.envelopeFrom + '>', 'mail_from', [250]);
    await say('RCPT TO:<' + cfg.recipient + '>', 'rcpt_to', [250, 251]);
    await say('DATA', 'data', [354]);

    socket.write(dotStuff(message) + '.' + CRLF);
    const done = await expect('body', [250]);

    socket.write('QUIT' + CRLF);
    return { accepted: true, response: done.lines[done.lines.length - 1] };
  } finally {
    socket.destroy();
  }
}

module.exports = { send, connect, tlsOptions, makeReader, SmtpError };
