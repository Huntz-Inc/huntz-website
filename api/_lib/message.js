'use strict';
// RFC 5322 message construction.
//
// Two decisions remove whole classes of bug rather than defending against them:
//
//  1. Every header value is a compile-time constant or a server-side enum
//     label. No visitor text reaches a header, so there is no encoded-word
//     encoder here and no Subject-injection surface at all. The visitor's name
//     and prose live in the body; the visitor's address appears only inside
//     Reply-To's angle brackets, after passing an anchored ASCII-only pattern.
//  2. The body is base64. Its alphabet is A-Z a-z 0-9 + / = and nothing else,
//     so the encoded text structurally cannot contain a bare CR or LF, cannot
//     begin a line with a period, and cannot exceed the 1000-octet SMTP line
//     limit however much UTF-8 the visitor pastes in.

const CRLF = '\r\n';

// RFC 5322 field bodies: printable US-ASCII plus SP and HTAB. Enforced as an
// allowlist at the point of emission, and leading/trailing whitespace is
// refused too, because a leading space is the header-folding continuation
// marker and would let a value graft itself onto the previous header.
const HEADER_SAFE = /^[\x20\x09\x21-\x7E]*$/;

function assertHeaderSafe(line) {
  if (!HEADER_SAFE.test(line)) throw new Error('unsafe_header');
  if (line !== line.trim()) throw new Error('unsafe_header');
  if (line.length > 998) throw new Error('unsafe_header');
}

// "Thu, 13 Aug 2026 10:04:05 +0000". toUTCString() is right in every respect
// except its trailing "GMT", which RFC 5322 §4.3 lists as obsolete zone syntax.
function rfc5322Date(d) {
  return d.toUTCString().replace(/GMT$/, '+0000');
}

function base64Lines(text) {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const out = [];
  for (let i = 0; i < b64.length; i += 76) out.push(b64.slice(i, i + 76));
  return out.length ? out.join(CRLF) + CRLF : CRLF;
}

function bodyText({ name, email, reasonLabel, message }) {
  return [
    'New message from the huntz.ai contact form.',
    '',
    'Reason:  ' + reasonLabel,
    'Name:    ' + name,
    'Email:   ' + email,
    '',
    'Message:',
    message,
    '',
  ].join('\n').replace(/\r\n?|\n/g, CRLF);
}

/**
 * @param {{name,email,reasonLabel,message}} submission  already validated
 * @param {{fromHeader,recipient}} cfg                   compile-time constants
 */
function compose(submission, cfg, now, messageId) {
  const headers = [
    'From: ' + cfg.fromHeader,
    'To: <' + cfg.recipient + '>',
    'Reply-To: <' + submission.email + '>',
    'Subject: Huntz contact form: ' + submission.reasonLabel,
    'Date: ' + rfc5322Date(now),
    'Message-ID: <' + messageId + '>',
    'Auto-Submitted: auto-generated',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  headers.forEach(assertHeaderSafe);

  const msg = headers.join(CRLF) + CRLF + CRLF + base64Lines(bodyText(submission));

  // Belt and braces: nothing above can produce a bare CR or LF, so if one is
  // present the assumptions have moved and the message must not go out.
  if (/\r(?!\n)|(?<!\r)\n/.test(msg)) throw new Error('bare_newline');
  return msg;
}

// RFC 5321 §4.5.2. Redundant for a base64 body, and kept anyway: it is the one
// guard between a message body and remote SMTP command injection, and it must
// not quietly depend on the encoding choice above staying the same.
function dotStuff(msg) {
  return msg.replace(/\r\n\./g, CRLF + '..').replace(/^\./, '..');
}

module.exports = { compose, dotStuff, assertHeaderSafe, rfc5322Date, base64Lines, bodyText, CRLF };
