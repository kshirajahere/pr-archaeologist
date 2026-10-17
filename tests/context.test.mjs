import test from 'node:test';
import assert from 'node:assert/strict';
process.env.MOCK = '1';
const { ReviewService, closingIssueNumbers } = await import('../dist/review/review.service.js');
const { GitHub } = await import('../dist/review/github.js');
const { roles, canRead } = await import('../dist/review/policy.js');
const { previousLine, lineCount } = await import('../dist/review/diff.js');

test('context gives patches, issues, shared history and docs without hidden files', async () => {
  const result = await new ReviewService().context('acme/launchpad', 207, roles.readonly);
  assert.equal(result.author, 'leo');
  assert.equal(result.issues[0].number, 201);
  assert.ok(result.related.some(p => p.pr === 42));
  assert.ok(result.files[0].patch.includes('console.log'));
  assert.equal(result.docs.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /FIXTURE_SECRET|service\.pem|\.env/);
});
test('line provenance follows blame -> commit -> PR -> review -> issue', async () => {
  const result = await new ReviewService().why('acme/launchpad', 'src/client.ts', 3, roles.readonly);
  assert.equal(result.blame.sha, 'fix42');
  assert.equal(result.pr.number, 42);
  assert.match(result.explanation, /upstream stall/);
  assert.match(result.thread[0].url, /discussion_r4201/);
  assert.equal(result.issues[0].number, 41);
});
test('not found for denied and missing paths, including traversal and renames', async () => {
  const service = new ReviewService();
  for (const path of ['.env', 'docs/.env.local', 'secrets/key', 'docs/a.pem', '../README.md', 'docs/../.env', 'docs\\setup.md', 'docs/%2e%2e/.env', 'missing']) {
    await assert.rejects(service.why('acme/launchpad', path, 1, roles.readonly), /^Error: not found$/);
  }
  assert.equal((await service.context('acme/launchpad', 209, roles.readonly)).files.length, 0);
  assert.equal(canRead(roles['docs-bot'], 'src/client.ts'), false);
});
test('docs role receives only docs patches and docs history', async () => {
  const result = await new ReviewService().context('acme/launchpad', 207, roles['docs-bot']);
  assert.deepEqual(result.files.map(f => f.filename), ['docs/setup.md']);
  assert.equal(result.related.some(p => p.paths.includes('src/client.ts')), false);
});
test('incomplete history does not invent intent; line bounds are checked', async () => {
  const service = new ReviewService();
  const result = await service.why('acme/launchpad', 'src/client.ts', 1, roles.readonly);
  assert.match(result.explanation, /History incomplete/);
  await assert.rejects(service.why('acme/launchpad', 'src/client.ts', 999, roles.readonly), /not found/);
  await assert.rejects(service.check('acme/launchpad', 999, roles.readonly), /not found/);
  await assert.rejects(service.conflicts('acme/launchpad', 999, roles.readonly), /not found/);
});
test('backwards line mapping handles removed lines and separate hunks', () => {
  const patch = '@@ -1,3 +1,2 @@\n a\n-b\n c\n@@ -8 +7,2 @@\n d\n+e';
  assert.equal(previousLine(patch, 2), 3);
  assert.equal(previousLine(patch, 5), 6);
  assert.equal(previousLine(patch, 8), 'introduced');
});
test('REST adapter paginates file lists and encodes paths without live network', async () => {
  process.env.GITHUB_TOKEN = 'fixture-token';
  const urls = [];
  const github = new GitHub(false, async url => {
    urls.push(url);
    return new Response(JSON.stringify(new URL(url).searchParams.get('page') === '1' ? Array(100).fill({ filename: 'docs/x.md' }) : [{ filename: 'docs/y.md' }]));
  });
  assert.equal((await github.files('acme/launchpad', 207)).length, 101);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /page=2/);
  delete process.env.GITHUB_TOKEN;
});
test('line counts ignore a trailing newline and a phantom line is not found', async () => {
  assert.equal(lineCount(''), 0);
  assert.equal(lineCount('a\n'), 1);
  assert.equal(lineCount('a\nb'), 2);
  assert.equal(lineCount('a\r\nb\r\n'), 2);
  const service = new ReviewService();
  await assert.rejects(service.why('acme/launchpad', 'src/client.ts', 7, roles.readonly), /not found/);
  const line = await service.why('acme/launchpad', 'src/client.ts', 6, roles.readonly);
  assert.equal(typeof line.explanation, 'string');
});
test('closing references ignore unresolved words and other repositories', () => {
  const name = 'acme/launchpad';
  assert.deepEqual(closingIssueNumbers('unresolved #12', name), []);
  assert.deepEqual(closingIssueNumbers('fixing #201', name), []);
  assert.deepEqual(closingIssueNumbers('Fixes https://github.com/other/repo/issues/9', name), []);
  assert.deepEqual(closingIssueNumbers('Fixes: #41', name), [41]);
  assert.deepEqual(closingIssueNumbers('See https://github.com/acme/launchpad/issues/201 and https://github.com/acme/launchpad/pull/42', name), [201, 42]);
  assert.deepEqual(closingIssueNumbers(null, name), []);
});
