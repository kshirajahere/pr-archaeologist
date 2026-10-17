import test from 'node:test';
import assert from 'node:assert/strict';
process.env.MOCK = '1';
const { ReviewService } = await import('../dist/review/review.service.js');
const { roles } = await import('../dist/review/policy.js');
const repo = 'acme/launchpad';

test('draft combines cited findings and conflicts without posting and can be dry-run', async () => {
  const service = new ReviewService();
  const draft = await service.draft(repo, 207, roles.readonly);
  assert.equal(draft.posted, false);
  assert.equal(draft.review.expected_head, 'head207');
  assert.equal(draft.review.repo, repo);
  assert.equal(draft.review.pr, 207);
  assert.match(draft.review.body, /suggestions|manual review/i);
  assert.ok(draft.review.comments.some(c => /discussion_r4201/.test(c.body)));
  assert.ok(draft.review.comments.some(c => /reverts the fix from #42/.test(c.body)));
  assert.ok(draft.review.comments.every(c => c.path && c.line > 0));
  assert.equal(service.github.posted.length, 0);
  const result = await service.post(repo, 207, draft.review, roles.readonly, draft.review.expected_head);
  assert.equal(result.dry_run, true);
  assert.equal(result.head, 'head207');
});
test('draft turns exact historical replacements into commit-ready suggestions', async () => {
  const service = new ReviewService();
  const draft = await service.draft(repo, 207, roles.reviewer);
  const fetch = draft.review.comments.find(c => c.line === 3 && c.body.includes('```suggestion'));
  const logged = draft.review.comments.find(c => c.body.includes('console.log'));
  const retry = draft.review.comments.find(c => c.body.includes('randomUUID'));
  assert.match(fetch.body, /```suggestion\n {2}const response = await fetch\(url, \{ signal: AbortSignal\.timeout\(5000\) \}\);\n```/);
  assert.match(logged.body, /```suggestion\n {2}logger\.info\(\{ status: response\.status \}, "upstream response"\);\n```/);
  assert.doesNotMatch(retry.body, /```suggestion/);
  assert.equal(draft.apply_ready, 2);
  const posted = await service.post(repo, 207, draft.review, roles.reviewer, draft.review.expected_head);
  assert.equal(posted.posted, true);
  assert.match(service.github.posted[0].comments.find(c => c.line === 3).body, /```suggestion/);
});

test('draft respects docs-only scope and never writes for a posting role', async () => {
  const service = new ReviewService();
  const docs = await service.draft(repo, 207, roles['docs-bot']);
  assert.equal(docs.review.body, '');
  assert.equal(docs.review.comments.length, 1);
  assert.ok(docs.review.comments.every(c => c.path.startsWith('docs/')));
  assert.doesNotMatch(JSON.stringify(docs), /src\/client|FIXTURE_SECRET|\.env/);
  await service.draft(repo, 207, roles.reviewer);
  assert.equal(service.github.posted.length, 0);
});

test('clean and hidden-file drafts do not claim approval or expose denied paths', async () => {
  const service = new ReviewService();
  const clean = await service.draft(repo, 208, roles.readonly);
  assert.equal(clean.review.comments.length, 0);
  assert.match(clean.review.body, /manual review/i);
  const hidden = await service.draft(repo, 209, roles.readonly);
  assert.equal(hidden.review.comments.length, 0);
  assert.doesNotMatch(JSON.stringify(hidden), /credentials\.md|FIXTURE_SECRET|\.env/);
});

test('draft rejects head changes during preparation and posting rejects a stale draft', async () => {
  const service = new ReviewService();
  const pull = service.github.pull.bind(service.github);
  let calls = 0;
  service.github.pull = async (...args) => {
    const value = structuredClone(await pull(...args));
    if (++calls > 1) value.head.sha = 'changed';
    return value;
  };
  await assert.rejects(service.draft(repo, 207, roles.readonly), /PR changed/);
  const other = new ReviewService();
  await assert.rejects(other.post(repo, 207, { body: 'Review', comments: [] }, roles.reviewer, 'old-head'), /PR changed/);
  assert.equal(other.github.posted.length, 0);
});

test('draft reports omitted suggestions rather than exceeding posting limits', async () => {
  const service = new ReviewService();
  const finding = { path: 'src/client.ts', line: 3, rule: 'Keep the timeout.', source: { quote: 'Original evidence', url: 'https://github.com/acme/launchpad/pull/42#discussion_r4201' } };
  service.check = async () => ({ findings: [...Array.from({ length: 51 }, () => finding), { ...finding, source: { ...finding.source, quote: 'x'.repeat(6000) } }], unchecked_paths: [], coverage: 'Test coverage.' });
  service.conflicts = async () => ({ conflicts: [], coverage: 'Test conflicts.' });
  const draft = await service.draft(repo, 207, roles.readonly);
  assert.equal(draft.review.comments.length, 50);
  assert.ok(draft.review.comments.every(c => c.body.length <= 5000));
  assert.equal(draft.omitted_comments, 2);
  assert.match(draft.review.body, /2.*omitted/);
  service.check = async () => ({ findings: [{ ...finding, source: { ...finding.source, quote: 'x'.repeat(6000) } }], unchecked_paths: [], coverage: 'Test coverage.' });
  const oversized = await service.draft(repo, 207, roles.readonly);
  assert.equal(oversized.review.comments.length, 0);
  assert.equal(oversized.omitted_comments, 1);
  assert.doesNotMatch(oversized.review.body, /No supported rule violations/);
});
