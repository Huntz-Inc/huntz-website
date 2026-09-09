const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'build/payout-return-page.html'), 'utf8');

test('return and refresh pages are reproducible private fallbacks', () => {
  for (const name of ['return', 'refresh']) {
    const html = fs.readFileSync(path.join(root, `payouts/${name}.html`), 'utf8');
    assert.equal(html, template);
    assert.match(html, /name="referrer" content="no-referrer"/);
    assert.match(html, /name="robots" content="noindex, nofollow"/);
    assert.doesNotMatch(html, /fetch\(|localStorage|sessionStorage|console\.|<iframe|<img/);
  }
});

test('the fallback discards provider input and opens only the fixed native route after a tap', () => {
  const script = template.match(/<script>([\s\S]*?)<\/script>/)[1];
  let ready;
  let click;
  const navigations = [];
  const history = [];
  vm.runInNewContext(script, {
    location: { pathname: '/payouts/return', search: '?account=acct_secret', assign: (url) => navigations.push(url) },
    history: { replaceState: (...args) => history.push(args) },
    document: {
      addEventListener: (_event, fn) => { ready = fn; },
      getElementById: () => ({ addEventListener: (_event, fn) => { click = fn; } }),
    },
  });
  ready();
  assert.deepEqual(navigations, []);
  assert.equal(history[0][2], '/payouts/return');
  click();
  assert.deepEqual(navigations, ['huntz:///integrations/payouts/return']);
});

test('deployment headers protect both payout callback pages', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const rule = config.headers.find((item) => item.source === '/payouts/(return|refresh)');
  const headers = Object.fromEntries(rule.headers.map((item) => [item.key, item.value]));
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.match(headers['Content-Security-Policy'], /default-src 'none'/);
});
