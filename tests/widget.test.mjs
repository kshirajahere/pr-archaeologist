import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const html = readFileSync('src/widgets/out/review-card.html', 'utf8');
const fixture = JSON.parse(readFileSync('src/widgets/widget-manifest.json', 'utf8')).widgets[0].examples[0].data;

async function render(data) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
  console.on('error', (...args) => errors.push(new Error(args.join(' '))));
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/review-card', pretendToBeVisual: true, virtualConsole: console,
    beforeParse(window) {
      window.openai = { toolOutput: data, theme: 'light' };
      // jsdom has no layout engine/ResizeObserver. The SDK uses this browser
      // API only for iframe height reporting, outside this DOM contract test.
      window.ResizeObserver = class { observe() {} disconnect() {} };
    } });
  const deadline = Date.now() + 3000;
  while (!dom.window.document.querySelector('main') || !dom.window.__nitroWidgetLayoutActive) {
    if (errors.length || Date.now() > deadline) {
      const state = dom.window.document.readyState;
      dom.window.close(); throw new Error(errors.map(e => e.message).join('\n') || `Widget did not render (${state})`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(errors.length, 0);
  return dom;
}
test('production widget renders host tool output and original source links with embedded CSS', async () => {
  assert.match(html, /\.finding-evidence/);
  const dom = await render(fixture);
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('.finding').length, 4);
    assert.equal(doc.querySelector('a').href, fixture.findings[0].source.url);
    assert.ok(doc.body.textContent.includes('2024-10-17'));
    assert.ok(doc.body.textContent.includes('src/client.ts'));
  } finally { dom.window.close(); }
});
test('widget escapes repository text and rejects unsafe source URLs', async () => {
  const data = structuredClone(fixture);
  data.findings[0].code = '<img src=x onerror="window.compromised=true">';
  data.findings[0].source.url = 'javascript:alert(1)';
  const dom = await render(data);
  try {
    assert.equal(dom.window.document.querySelector('img'), null);
    assert.equal(dom.window.document.querySelector('a').hasAttribute('href'), false);
    assert.equal(dom.window.compromised, undefined);
  } finally { dom.window.close(); }
});
