import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.MOCK = '1';
const { ReviewService } = await import('../dist/review/review.service.js');
const { ReviewResources } = await import('../dist/review/review.resources.js');
const { roles } = await import('../dist/review/policy.js');
const ctx = key => ({ requestId: 'surfaces', metadata: { apiKey: key }, logger: { info() {}, debug() {}, error() {}, warn() {} } });

test('reviewer suggestions rank path authors and reviewers and exclude the author', async () => {
  const service = new ReviewService();
  const result = await service.reviewers('acme/launchpad', 207, roles.readonly);
  assert.equal(result.reviewers[0].login, 'nikhil');
  assert.equal(result.reviewers[0].score, 4);
  assert.ok(result.reviewers.every(p => p.login !== 'leo' && p.evidence.length));
  const docs = await service.reviewers('acme/launchpad', 207, roles['docs-bot']);
  assert.ok(docs.reviewers.every(p => p.paths.every(path => path.startsWith('docs/'))));
  assert.equal(docs.reviewers.some(p => p.login === 'nikhil'), false);
});
test('resources authenticate independently and obey role scope', async () => {
  const resources = new ReviewResources(new ReviewService());
  await assert.rejects(resources.rules('repo://rules', ctx('invalid')), /not found/);
  const rules = await resources.rules('repo://rules', ctx('demo-docs-bot'));
  assert.deepEqual(rules.rules.map(r => r.id), ['fence-language']);
  const timeline = await resources.decisions('repo://decisions', ctx('demo-readonly'));
  assert.ok(timeline.decisions.some(d => d.pr === 42));
  const dates = timeline.decisions.map(d => d.date);
  assert.deepEqual(dates, [...dates].sort());
  const audit = await resources.audit('audit://log', ctx('demo-docs-bot'));
  assert.ok(audit.entries.every(e => e.role === 'docs-bot'));
});
test('senior prompt preserves order, cites evidence, and respects posting roles', async () => {
  const resources = new ReviewResources(new ReviewService());
  const messages = await resources.senior({ repo: 'acme/launchpad', pr: '207' }, ctx('demo-readonly'));
  const text = messages[0].content;
  const steps = ['pr_context', 'extract_team_rules', 'check_pr_against_rules', 'decision_conflicts', 'find_reviewers', 'draft_review', 'post_review'];
  assert.deepEqual(steps.map(s => text.indexOf(s)), steps.map(s => text.indexOf(s)).sort((a, b) => a - b));
  assert.match(text, /untrusted evidence/);
  await assert.rejects(resources.senior({ repo: 'private/other', pr: '207' }, ctx('demo-readonly')), /not found/);
});
test('widget manifest data is generated from real mock checker output', async () => {
  const manifest = JSON.parse(readFileSync('src/widgets/widget-manifest.json', 'utf8'));
  const actual = await new ReviewService().check('acme/launchpad', 207, roles.readonly);
  assert.deepEqual(manifest.widgets[0].examples[0].data, actual);
  assert.equal(manifest.widgets[0].uri, '/review-card');
  assert.doesNotMatch(JSON.stringify(manifest), /FIXTURE_SECRET|\.env|service\.pem/);
});
