import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

test('real stdio server discovers tools and returns context and provenance', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'],
    env: { ...process.env, MOCK: '1', MCP_API_KEY: 'demo-readonly', MCP_TRANSPORT_TYPE: 'stdio', NITRO_MCP_PROTOCOL_VERSION: 'legacy' }, stderr: 'pipe' });
  const client = new Client({ name: 'archaeologist-tests', version: '1.0.0' });
  transport.stderr?.on('data', chunk => process.stderr.write(chunk));
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.ok(list.tools.some(t => t.name === 'pr_context'));
    assert.equal(list.tools.length, 8);
    assert.equal(list.tools.find(t => t.name === 'draft_review').annotations.readOnlyHint, true);
    for (const [name, args] of [['pr_context', { repo: 'acme/launchpad', pr: 207 }], ['why_line', { repo: 'acme/launchpad', path: 'src/client.ts', line: 3 }]]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.match(JSON.stringify(result), name === 'pr_context' ? /console.log/ : /discussion_r4201/);
    }
    for (const name of ['extract_team_rules', 'check_pr_against_rules', 'decision_conflicts', 'find_reviewers']) {
      const result = await client.callTool({ name, arguments: { repo: 'acme/launchpad', pr: 207 } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
    }
    const draftResult = await client.callTool({ name: 'draft_review', arguments: { repo: 'acme/launchpad', pr: 207 } });
    assert.equal(draftResult.isError, undefined, JSON.stringify(draftResult));
    const draft = draftResult.structuredContent ?? JSON.parse(draftResult.content.find(c => c.type === 'text').text);
    assert.equal(draft.posted, false);
    const dryRun = await client.callTool({ name: 'post_review', arguments: draft.review });
    assert.equal(dryRun.isError, undefined, JSON.stringify(dryRun));
    const dryRunData = dryRun.structuredContent ?? JSON.parse(dryRun.content.find(c => c.type === 'text').text);
    assert.equal(dryRunData.dry_run, true);
    const stale = await client.callTool({ name: 'post_review', arguments: { ...draft.review, expected_head: 'old-head' } });
    assert.equal(stale.isError, true);
    assert.match(JSON.stringify(stale), /PR changed/);
    const denied = await client.callTool({ name: 'why_line', arguments: { repo: 'acme/launchpad', path: '.env', line: 1 } });
    assert.equal(denied.isError, true);
    assert.match(JSON.stringify(denied), /not found/);
    assert.doesNotMatch(JSON.stringify(denied), /FIXTURE_SECRET/);
    const resources = await client.listResources();
    assert.ok(resources.resources.some(r => r.uri === 'repo://rules'));
    const rules = await client.readResource({ uri: 'repo://rules' });
    assert.equal(JSON.parse(rules.contents[0].text).rules.length, 4);
    assert.ok((await client.listPrompts()).prompts.some(p => p.name === 'review-like-a-senior'));
    const prompt = await client.getPrompt({ name: 'review-like-a-senior', arguments: { repo: 'acme/launchpad', pr: '207' } });
    assert.match(prompt.messages[0].content.text, /decision_conflicts/);
  } finally { await client.close(); }
});

test('desktop launcher works from another working directory', async () => {
  const client = new Client({ name: 'desktop-config-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../scripts/mcp.mjs', import.meta.url))], cwd: tmpdir(),
    env: { ...process.env, MOCK: '1', MCP_API_KEY: 'demo-readonly', NITRO_MCP_PROTOCOL_VERSION: 'legacy' }, stderr: 'ignore' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'pr_context', arguments: { repo: 'acme/launchpad', pr: 207 } });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result), /head207/);
  } finally { await client.close(); }
});
