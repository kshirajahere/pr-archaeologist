import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
process.env.MOCK = '1';
const { createServer } = await import('../dist/bootstrap.js');
const { RoleGuard, principal } = await import('../dist/security/access.js');
const { readAudit } = await import('../dist/security/audit.js');
const { ReviewService } = await import('../dist/review/review.service.js');
const { roles } = await import('../dist/review/policy.js');
const server = await createServer();
const logger = { info() {}, warn() {}, error() {}, debug() {} };
function context(key) { return { requestId: randomUUID(), logger, metadata: key ? { apiKey: key } : {}, auth: { subject: 'forged', claims: { role: 'reviewer' } } }; }
function call(name, args, key = 'demo-readonly') { return server.getTool(name).execute(args, context(key)); }
const repo = 'acme/launchpad';
const review = { repo, pr: 207, body: 'Please retain the timeout.', comments: [{ path: 'src/client.ts', line: 3, body: 'Keep the timeout from the old fix.' }] };

test('every registered tool rejects missing/invalid credentials and forged auth', async () => {
  for (const name of server.getTools().keys()) {
    await assert.rejects(call(name, { repo, pr: 207 }, ''), /not found/);
    await assert.rejects(call(name, { repo, pr: 207 }, 'bad-key'), /not found/);
  }
});
test('role comes from credentials; tool arguments cannot escalate or select another repository', async () => {
  await assert.rejects(call('pr_context', { repo: 'private/other', pr: 207 }), /not found/);
  const docs = await call('pr_context', { repo, pr: 207, role: 'reviewer' }, 'demo-docs-bot');
  assert.deepEqual(docs.files.map(f => f.filename), ['docs/setup.md']);
  for (const path of ['.env', 'docs/.env.production', 'secrets/a.pem', '../README.md', 'src/client.ts']) {
    await assert.rejects(call('why_line', { repo, path, line: 1 }, 'demo-docs-bot'), /not found/);
  }
});
test('readonly posting is a dry run; reviewer posting uses the mock backend', async () => {
  assert.equal((await call('post_review', review)).dry_run, true);
  const posted = await call('post_review', review, 'demo-reviewer');
  assert.equal(posted.posted, true);
  assert.equal(posted.mock, true);
  assert.equal(posted.result.id, 9001);
});
test('docs-bot posts only docs inline comments with an empty summary', async () => {
  const docs = { repo, pr: 207, body: '', comments: [{ path: 'docs/setup.md', line: 2, body: 'Add the sh language tag.' }] };
  assert.equal((await call('post_review', docs, 'demo-docs-bot')).posted, true);
  await assert.rejects(call('post_review', review, 'demo-docs-bot'), /not found/);
  await assert.rejects(call('post_review', { ...docs, body: 'General summary' }, 'demo-docs-bot'), /not found/);
});
test('posting rejects hidden paths, renames and invalid line locations before any write', async () => {
  const service = new ReviewService();
  for (const [path, line] of [['.env', 1], ['src/client.ts', 999], ['src/client.ts', 1], ['docs/../.env', 1]]) {
    await assert.rejects(service.post(repo, 207, { body: 'Review', comments: [{ path, line, body: 'x' }] }, roles.reviewer), /not found/);
  }
  await assert.rejects(service.post(repo, 209, { body: '', comments: [{ path: 'docs/credentials.md', line: 1, body: 'x' }] }, roles.reviewer), /not found/);
  assert.equal(service.github.posted.length, 0);
});
test('rate limit blocks the sixth call for the same verified identity', async () => {
  const key = 'x'.repeat(48);
  process.env.READONLY_API_KEY = key;
  // One call already consumed by this identity in preceding tests.
  for (let i = 0; i < 4; i++) await call('post_review', review, key);
  await assert.rejects(call('post_review', review, key), /limit/i);
  delete process.env.READONLY_API_KEY;
});
test('posting aborts on a changed head before sending any review', async () => {
  const service = new ReviewService();
  const pull = service.github.pull.bind(service.github);
  let calls = 0;
  service.github.pull = async (...args) => {
    const value = structuredClone(await pull(...args));
    if (++calls > 1) value.head.sha = 'changed';
    return value;
  };
  await assert.rejects(service.post(repo, 207, { body: 'Review', comments: [] }, roles.reviewer), /PR changed/);
  assert.equal(service.github.posted.length, 0);
});
test('audit records successes, denied calls, validation errors and cache hits without secrets', async () => {
  await call('extract_team_rules', { repo });
  await call('extract_team_rules', { repo });
  await assert.rejects(call('why_line', { repo, path: '.env', line: 1 }), /not found/);
  await assert.rejects(call('pr_context', { repo, pr: -1 }), /greater|positive/i);
  const actor = context('demo-readonly');
  new RoleGuard().canActivate(actor);
  const rows = readAudit(actor);
  assert.ok(rows.some(r => r.access === 'denied' && r.tool === 'why_line'));
  assert.ok(rows.filter(r => r.tool === 'extract_team_rules').length >= 2);
  assert.ok(rows.some(r => r.tool === 'post_review' && r.args.body?.length === review.body.length));
  const raw = readFileSync(process.env.AUDIT_FILE ?? 'logs/audit.jsonl', 'utf8');
  assert.doesNotMatch(raw, /demo-readonly|demo-reviewer|FIXTURE_SECRET|\.env|bad-key/);
  assert.equal(rows.some(r => r.role === 'reviewer'), false);
});
test('JWT signature, expiry, issuer and role are verified; unsigned payloads are rejected', () => {
  process.env.JWT_SECRET = 's'.repeat(48);
  function jwt(payload, secret = process.env.JWT_SECRET, alg = 'HS256') {
    const prefix = [Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify(payload)).toString('base64url')].join('.');
    return prefix + '.' + createHmac('sha256', secret).update(prefix).digest('base64url');
  }
  const claims = { sub: 'ava', role: 'reviewer', iss: 'pr-archaeologist', aud: 'pr-archaeologist', exp: Date.now() / 1000 + 60 };
  const good = context(); good.metadata = { authorization: `Bearer ${jwt(claims)}` };
  assert.equal(new RoleGuard().canActivate(good), true);
  assert.equal(principal(good).role, 'reviewer');
  for (const token of [jwt(claims, 'wrong'), jwt({ ...claims, exp: 1 }), jwt({ ...claims, role: 'admin' }), jwt({ ...claims, iss: 'attacker' }), jwt(claims, undefined, 'none'), jwt(claims) + '.', jwt({ ...claims, nbf: Date.now() / 1000 + 3600 })]) {
    const bad = context(); bad.metadata = { authorization: `Bearer ${token}` };
    assert.throws(() => new RoleGuard().canActivate(bad), /not found/);
  }
  delete process.env.JWT_SECRET;
});
test('demo API keys are unavailable in live mode; HTTP cannot inherit stdio credentials', () => {
  process.env.MOCK = '0'; process.env.MCP_API_KEY = 'demo-reviewer'; process.env.MCP_TRANSPORT_TYPE = 'http';
  assert.throws(() => new RoleGuard().canActivate(context('demo-reviewer')), /not found/);
  assert.throws(() => new RoleGuard().canActivate(context()), /not found/);
  process.env.MOCK = '1'; delete process.env.MCP_API_KEY; delete process.env.MCP_TRANSPORT_TYPE;
});
