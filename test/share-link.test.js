'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { renderHuntHtml } = require('../api/hunt');
const asset = require('../api/_lib/share-link-asset.json');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, asset.href), 'utf8');
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const fallback = fs.readFileSync(path.join(root, 'api/_lib/hunt-fallback.html'), 'utf8');
const hunt = renderHuntHtml(fallback, 'read-12-books', {
  title: 'Read 12 Books', visibility: 'PUBLIC', creatorDisplayName: 'Jordan',
}, 'https://api.huntz.ai', new Date('2026-10-11'), { code: 'ABCD2345' });

function harness(url, navigator) {
  let click;
  const status = { textContent: '' };
  const button = {
    disabled: false,
    getAttribute: (name) => name === 'data-share-url' ? url : null,
    parentElement: { querySelector: () => status },
  };
  vm.runInNewContext(script, {
    document: { addEventListener: (event, listener) => { assert.equal(event, 'click'); click = listener; } },
    navigator,
    // Current-tab tokens and title must never become share payloads.
    location: { href: `${url}?ref=PRIVATE&via=PRIVATE&code=PRIVATE#section` },
  });
  return {
    button, status,
    click: () => click({ target: { closest: () => button }, preventDefault() {} }),
  };
}

test('homepage has two canonical Share controls and the deployed script', () => {
  assert.equal((home.match(/data-share-url="https:\/\/www\.huntz\.ai\/"/g) || []).length, 2);
  assert.ok(home.includes(`<script src="${asset.href}" defer></script>`));
  assert.ok(home.includes('content="Huntz: Become someone who finishes."'));
  assert.ok(home.includes('/og-image.jpg?v=2'));
  assert.equal(script, fs.readFileSync(path.join(root, 'build/share-link.js'), 'utf8'));
  const servedHome = fs.readFileSync(path.join(root, 'api/_lib/home-fallback.html'), 'utf8');
  assert.ok(servedHome.includes('data-share-url="https://www.huntz.ai/"'));
  assert.ok(servedHome.includes(asset.href));
});

test('rendered Hunt shares its apex canonical without invite tokens', () => {
  assert.ok(hunt.includes('data-share-url="https://huntz.ai/hunt/read-12-books"'));
  assert.ok(hunt.includes(`<script src="${asset.href}" defer></script>`));
  assert.ok(hunt.includes('data-share-status role="status"'));
});

for (const url of ['https://www.huntz.ai/', 'https://huntz.ai/hunt/read-12-books']) {
  test(`native sharing passes only the canonical URL: ${url}`, async () => {
    const calls = [];
    const h = harness(url, {
      share: async (payload) => calls.push(payload),
      clipboard: { writeText: async () => assert.fail('native sharing must not copy') },
    });
    await h.click();
    assert.equal(JSON.stringify(calls), JSON.stringify([{ url }]));
    assert.equal(h.status.textContent, '');
    assert.equal(h.button.disabled, false);
  });

  test(`clipboard fallback copies the canonical URL: ${url}`, async () => {
    let copied;
    const h = harness(url, { clipboard: { writeText: async (value) => { copied = value; } } });
    await h.click();
    assert.equal(copied, url);
    assert.equal(h.status.textContent, 'Link copied');
    assert.equal(h.button.disabled, false);
  });
}

test('canceling native sharing does not copy or claim success', async () => {
  const h = harness('https://www.huntz.ai/', {
    share: async () => { throw { name: 'AbortError' }; },
    clipboard: { writeText: async () => assert.fail('cancellation must not copy') },
  });
  await h.click();
  assert.equal(h.status.textContent, '');
  assert.equal(h.button.disabled, false);
});

test('clipboard failure reports failure and allows retry', async () => {
  const h = harness('https://www.huntz.ai/', {
    clipboard: { writeText: async () => { throw new Error('denied'); } },
  });
  await h.click();
  assert.equal(h.status.textContent, 'Could not share. Try again.');
  assert.equal(h.button.disabled, false);
});

test('a second click while sharing is pending does not open another sheet', async () => {
  let finish;
  let calls = 0;
  const h = harness('https://www.huntz.ai/', {
    share: () => { calls++; return new Promise((resolve) => { finish = resolve; }); },
  });
  const pending = h.click();
  await h.click();
  assert.equal(calls, 1);
  finish();
  await pending;
  assert.equal(h.button.disabled, false);
});
