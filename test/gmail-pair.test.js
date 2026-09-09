const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'mailbox/gmail-action/pair.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const valid = new URLSearchParams({pairingId:'12345678-1234-1234-1234-123456789abc',pairingCode:'HZP-TESTONLYCODE1',signature:'a'.repeat(43)});
function run(query, brokenHistory = false) {
  const result = {navigations:[], history:[], click:null, domReady:null};
  const button = {hidden:true,addEventListener(event, fn){assert.equal(event,'click');result.click=fn;}};
  const status = {textContent:'initial'};
  const context = {
    URLSearchParams,
    location:{search:query,hash:'#discard',pathname:'/mailbox/gmail-action/pair',assign(url){result.navigations.push(url);}},
    history:{replaceState(...args){if(brokenHistory) throw Error('unavailable');result.history.push(args);}},
    document:{addEventListener(event,fn){assert.equal(event,'DOMContentLoaded');result.domReady=fn;},getElementById(id){return id==='open-huntz'?button:status;}}
  };
  vm.runInNewContext(script,context);
  result.domReady();
  return {...result,button,status};
}
test('valid signed bundle opens fixed native route only on explicit tap',()=>{
  const r=run('?'+valid+'&redirect=https://evil.example');
  assert.equal(r.button.hidden,false);
  assert.equal(r.navigations.length,0);
  assert.equal(r.history[0][2],'/mailbox/gmail-action/pair');
  r.click();
  const url=new URL(r.navigations[0]);
  assert.equal(url.protocol,'huntz:');
  assert.equal(url.hostname,'');
  assert.equal(url.pathname,'/mailbox/gmail-action/pair');
  assert.deepEqual([...url.searchParams],[...valid]);
});
test('missing, malformed, duplicate and overlong credentials fail closed',()=>{
  for(const query of ['', '?code=HZP-TESTONLYCODE1', '?'+valid+'&pairingId=duplicate', '?'+valid.toString().replace('HZP-TESTONLYCODE1','%3Cscript%3E'), '?'+valid.toString().replace('a'.repeat(43),'x'.repeat(65))]) {
    const r=run(query);
    assert.equal(r.button.hidden,true);
    assert.equal(r.click,null);
    assert.equal(r.navigations.length,0);
    assert.match(r.status.textContent,/fresh link/);
  }
  assert.equal(run('?'+valid,true).button.hidden,true);
});
test('static page is private, untracked, not indexed and generated reproducibly',()=>{
  assert.equal(html,fs.readFileSync(path.join(root,'build/gmail-pair-page.html'),'utf8'));
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(html, /<script[^>]+src=|<iframe|<img|fetch\(|localStorage|sessionStorage|console\./);
  const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  const headers=Object.fromEntries(config.headers.find(h=>h.source==='/mailbox/gmail-action/pair').headers.map(h=>[h.key,h.value]));
  assert.equal(headers['Cache-Control'],'no-store');
  assert.equal(headers['Referrer-Policy'],'no-referrer');
  assert.match(headers['Content-Security-Policy'],/default-src 'none'/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'sitemap.xml'),'utf8'),/gmail-action\/pair/);
});
