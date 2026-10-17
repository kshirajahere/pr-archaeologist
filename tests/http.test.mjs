import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('production HTTP authenticates tools and resources; identities remain isolated', { timeout: 25000 }, async () => {
  const portServer = createServer().listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const child = spawn(process.execPath, ['dist/index.js'], { env: { ...process.env, MOCK: '1', MCP_TRANSPORT_TYPE: 'http',
    PORT: String(port), HOST: '127.0.0.1', MCP_API_KEY: 'demo-reviewer', NITRO_MCP_PROTOCOL_VERSION: 'auto' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  child.stdout.on('data', chunk => { logs += chunk; });
  const clients = [];
  try {
    // Readiness is an actual listening health response, not a fixed delay.
    const deadline = Date.now() + 12000;
    while (true) {
      try { const response = await fetch(`http://127.0.0.1:${port}/mcp/health`); if (response.ok) break; } catch {}
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`HTTP server did not start: ${logs}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    for (const key of ['demo-readonly', 'demo-docs-bot', undefined]) {
      const client = new Client({ name: 'http-check', version: '1' }); clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: key ? { headers: { Authorization: `Bearer ${key}` } } : {}
      }));
      const args = { repo: 'acme/launchpad', pr: 207 };
      const result = await client.callTool({ name: 'pr_context', arguments: args });
      const draftResult = await client.callTool({ name: 'draft_review', arguments: args });
      const followups = await Promise.all([
        ['read_pr_file', { path: 'docs/setup.md' }], ['pr_discussion', {}],
        ['pr_changes_since', { since: 'a'.repeat(40) }], ['recheck_findings', { previous_findings: [] }]
      ].map(([name, extra]) => client.callTool({ name, arguments: { ...args, ...extra } })));
      if (!key) {
        assert.equal(result.isError, true);
        assert.equal(draftResult.isError, true);
        assert.ok(followups.every(r => r.isError === true));
        await assert.rejects(client.getPrompt({ name: 'review-pr-update', arguments: { repo: 'acme/launchpad', pr: '207', since: 'a'.repeat(40) } }), /not found/);
        await assert.rejects(client.readResource({ uri: 'repo://rules' }), /not found/);
        continue;
      }
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.equal(draftResult.isError, undefined, JSON.stringify(draftResult));
      assert.ok(followups.every(r => r.isError === undefined), JSON.stringify(followups));
      assert.match(JSON.stringify(followups[0]), /head207/);
      const draft = draftResult.structuredContent ?? JSON.parse(draftResult.content.find(c => c.type === 'text').text);
      assert.equal(draft.posted, false);
      assert.equal(draft.review.expected_head, 'head207');
      const rules = await client.readResource({ uri: 'repo://rules' });
      const data = JSON.parse(rules.contents[0].text);
      assert.equal(data.rules.length, key === 'demo-docs-bot' ? 1 : 4);
      if (key === 'demo-docs-bot') {
        assert.equal(draft.review.body, '');
        assert.ok(draft.review.comments.every(c => c.path.startsWith('docs/')));
        assert.doesNotMatch(JSON.stringify(draft), /src\/client/);
        assert.doesNotMatch(JSON.stringify(followups), /src\/client|FIXTURE_SECRET|credentials\.md/);
        assert.doesNotMatch(JSON.stringify(result), /src\/client/);
        const examples = await client.readResource({ uri: 'widget://examples' });
        assert.doesNotMatch(JSON.stringify(examples), /src\/client/);
      }
    }
    const counts = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const result = await clients[index % 2].readResource({ uri: 'repo://rules' });
      return JSON.parse(result.contents[0].text).rules.length;
    }));
    assert.deepEqual(counts, Array.from({ length: 12 }, (_, index) => index % 2 ? 1 : 4));
  } catch (error) {
    throw new Error(`${error.message}\nServer output: ${logs}`);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    child.kill();
    if (child.exitCode === null) await once(child, 'exit');
  }
});
