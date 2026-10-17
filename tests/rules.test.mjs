import test from 'node:test';
import assert from 'node:assert/strict';
process.env.MOCK = '1';
const { ReviewService } = await import('../dist/review/review.service.js');
const { violates } = await import('../dist/review/rules.js');
const { roles } = await import('../dist/review/policy.js');

test('learn four recurring rules with independent PR support and comment citations', async () => {
  const result = await new ReviewService().rules({ repo: 'acme/launchpad', n: 300, role: roles.readonly });
  assert.equal(result.rules.length, 4);
  for (const rule of result.rules) {
    assert.ok(rule.confidence > 0.5 && rule.confidence < 1);
    assert.ok(rule.sources.length >= 2);
    assert.match(rule.sources[0].url, /#discussion_r/);
    assert.ok(rule.sources[0].quote.length > 10);
  }
  assert.doesNotMatch(JSON.stringify(result), /SECRET_RULE|FIXTURE_SECRET|\.env/);
});
test('violations point at changed right-side lines and quote the originating rule', async () => {
  const result = await new ReviewService().check('acme/launchpad', 207, roles.readonly);
  assert.deepEqual(result.findings.map(f => [f.path, f.line]), [['src/client.ts', 3], ['src/client.ts', 4], ['src/client.ts', 5], ['docs/setup.md', 2]]);
  assert.match(result.findings[0].source.url, /4201/);
  assert.match(result.findings[0].source.quote, /timeout/);
});
test('an unrelated clean PR has no findings or decision conflicts', async () => {
  const service = new ReviewService();
  assert.equal((await service.check('acme/launchpad', 208, roles.readonly)).findings.length, 0);
  assert.equal((await service.conflicts('acme/launchpad', 208, roles.readonly)).conflicts.length, 0);
});
test('decision conflicts cite the precise old fix and both reversed lines', async () => {
  const result = await new ReviewService().conflicts('acme/launchpad', 207, roles.readonly);
  const conflict = result.conflicts.find(c => c.past_pr === 42);
  assert.equal(conflict.line, 3);
  assert.match(conflict.warning, /reverts the fix from #42/);
  assert.match(conflict.removed, /AbortSignal.timeout/);
  assert.match(conflict.restored, /fetch\(url\)/);
  assert.match(conflict.source.url, /4201/);
});
test('cache keys separate roles and scan sizes; docs-bot cannot learn source rules', async () => {
  const service = new ReviewService();
  const first = await service.rules({ repo: 'acme/launchpad', n: 300, role: roles.readonly });
  const again = await service.rules({ repo: 'acme/launchpad', n: 300, role: roles.readonly });
  assert.deepEqual(again, first);
  const docs = await service.rules({ repo: 'acme/launchpad', n: 300, role: roles['docs-bot'] });
  assert.deepEqual(docs.rules.map(r => r.id), ['fence-language']);
  assert.equal((await service.rules({ repo: 'acme/launchpad', n: 1, role: roles.readonly })).rules.length, 0);
  assert.equal((await service.conflicts('acme/launchpad', 207, roles['docs-bot'])).conflicts.length, 0);
});
test('commented-out calls are not violations and a trailing comment does not excuse a call', () => {
  const line = text => ({ kind: 'add', text, old: 1, line: 1 });
  const commented = line('// fetch(url);');
  const excused = line('await fetch(url); // timeout later');
  const block = line('/* console.log(status); */');
  const logged = line('console.log(status); // structured');
  const leading = line('/* note */ await fetch(url);');
  const excusedAfter = line('/* note */ await fetch(url); // timeout later');
  const unclosed = line('/* await fetch(url);');
  const afterClose = line('*/ console.log(status);');
  assert.equal(violates('fetch-timeout', commented, [commented]), false);
  assert.equal(violates('fetch-timeout', excused, [excused]), true);
  assert.equal(violates('structured-logging', block, [block]), false);
  assert.equal(violates('structured-logging', logged, [logged]), true);
  assert.equal(violates('fetch-timeout', leading, [leading]), true);
  assert.equal(violates('fetch-timeout', excusedAfter, [excusedAfter]), true);
  assert.equal(violates('fetch-timeout', unclosed, [unclosed]), false);
  assert.equal(violates('structured-logging', afterClose, [afterClose]), true);
});
test('reviewers count one review per person and skip bots, missing users, and the author', async () => {
  const result = await new ReviewService().reviewers('acme/launchpad', 207, roles.readonly);
  const ava = result.reviewers.find(p => p.login === 'ava');
  assert.equal(ava.reviews, 1);
  assert.equal(result.reviewers.some(p => p.login.includes('[bot]') || p.login === 'leo'), false);
});
test('binary patches are unchecked and do not become findings', async () => {
  const result = await new ReviewService().check('acme/launchpad', 208, roles.readonly);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.unchecked_paths, ['docs/diagram.bin']);
});
