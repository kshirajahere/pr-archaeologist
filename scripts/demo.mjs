import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const client = new Client({ name: 'archaeologist-demo', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['scripts/mcp.mjs'],
  env: { ...process.env, MOCK: '1', MCP_API_KEY: 'demo-readonly', NITRO_MCP_PROTOCOL_VERSION: 'legacy' }, stderr: 'pipe' });
// Drain framework diagnostics; report tool failures explicitly below.
let diagnostics = '';
transport.stderr?.on('data', chunk => { diagnostics += chunk; });
const output = {};
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result));
  const data = result.structuredContent ?? JSON.parse(result.content.find(c => c.type === 'text').text);
  output[name] = data;
  return data;
}
try {
  await client.connect(transport);
  const args = { repo: 'acme/launchpad', pr: 207 };
  const context = await call('pr_context', args);
  console.log(`BEFORE: #207 removes three lines of boilerplate. A diff alone omits the incident and team decisions. (${context.files.length} visible files)`);
  const why = await call('why_line', { repo: args.repo, path: 'src/client.ts', line: 3 });
  assert.equal(why.pr.number, 42);
  console.log(`WHY: ${why.explanation}\n  ${why.thread[0].url}`);
  const rulebook = await call('extract_team_rules', { repo: args.repo });
  const check = await call('check_pr_against_rules', args);
  assert.equal(rulebook.rules.length, 4); assert.equal(check.findings.length, 4);
  for (const f of check.findings) console.log(`RULE: ${f.path}:${f.line} — ${f.rule}\n  "${f.source.quote}"\n  ${f.source.url}`);
  const conflicts = await call('decision_conflicts', args);
  assert.ok(conflicts.conflicts.some(c => c.past_pr === 42));
  console.log(`CONFLICT: ${conflicts.conflicts[0].warning}`);
  const people = await call('find_reviewers', args);
  console.log(`REVIEWERS: ${people.reviewers.map(p => `${p.login} (${p.score})`).join(', ')}`);
  const draft = await call('draft_review', args);
  assert.equal(draft.posted, false);
  assert.equal(draft.review.expected_head, context.head);
  console.log(`DRAFT: ${draft.review.comments.length} cited inline suggestions, pinned to ${draft.review.expected_head}.`);
  const review = await call('post_review', draft.review);
  assert.equal(review.dry_run, true);
  console.log('REVIEW: readonly dry run; no GitHub write.');
  const denied = await client.callTool({ name: 'why_line', arguments: { repo: args.repo, path: '.env', line: 1 } });
  assert.equal(denied.isError, true); assert.match(JSON.stringify(denied), /not found/);
  output.denied = denied;
  console.log('BOUNDARY: readonly asks for .env → not found');
  for (const uri of ['repo://rules', 'repo://decisions', 'audit://log']) await client.readResource({ uri });
  mkdirSync('logs', { recursive: true });
  writeFileSync('logs/demo-output.json', JSON.stringify(output, null, 2) + '\n');
  console.log('PASS: complete MCP demo; evidence saved to logs/demo-output.json');
} catch (error) { console.error(error, diagnostics); process.exitCode = 1; }
finally { await client.close(); }
