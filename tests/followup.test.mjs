import test from 'node:test';
import assert from 'node:assert/strict';
process.env.MOCK = '1';
const { FollowupService } = await import('../dist/review/followup.service.js');
const { ReviewService } = await import('../dist/review/review.service.js');
const { GitHub } = await import('../dist/review/github.js');
const { FollowupTools } = await import('../dist/review/followup.tools.js');
const { roles } = await import('../dist/review/policy.js');
const repo = 'acme/launchpad', since = 'a'.repeat(40);
const make = () => new FollowupService(new ReviewService());

test('update prompt authenticates, validates the commit and refuses unconfigured repositories', async () => {
  const tools = new FollowupTools(make());
  const ctx = key => ({ requestId: 'update-prompt', metadata: { apiKey: key }, logger: { info() {}, warn() {}, error() {}, debug() {} } });
  const args = { repo, pr: '207', since };
  await assert.rejects(tools.update(args, ctx('invalid')), /not found/);
  await assert.rejects(tools.update({ ...args, repo: 'private/other' }, ctx('demo-readonly')), /not found/);
  await assert.rejects(tools.update({ ...args, since: 'main' }, ctx('demo-readonly')));
  const result = await tools.update(args, ctx('demo-readonly'));
  assert.match(result[0].content, /history_changed/);
  assert.match(result[0].content, /expected_head/);
});

test('file reader uses the PR head, returns bounded lines, and denies hidden renames', async () => {
  const service = make();
  const file = await service.file(repo, 207, 'src/client.ts', 3, 4, roles.readonly);
  assert.equal(file.head, 'head207');
  assert.equal(file.start_line, 3);
  assert.equal(file.end_line, 4);
  assert.match(file.content, /fetch\(url\)/);
  assert.doesNotMatch(file.content, /AbortSignal/);
  assert.equal(file.has_more, true);
  for (const [pr, path, start, end, role] of [[207, '.env', 1, 2, roles.readonly], [207, 'src/client.ts', 1, 2, roles['docs-bot']],
    [209, 'docs/credentials.md', 1, 2, roles.readonly], [207, 'src/client.ts', 8, 9, roles.readonly], [207, 'src/client.ts', 1, 201, roles.readonly], [207, 'src/client.ts', 4, 2, roles.readonly]]) {
    await assert.rejects(service.file(repo, pr, path, start, end, role), /not found/);
  }
});

test('discussion includes submitted reviews, replies and general comments within role scope', async () => {
  const service = make();
  const all = await service.discussion(repo, 207, roles.readonly);
  assert.ok(all.inline_comments.some(c => c.reply_to === 20701));
  assert.ok(all.reviews.some(r => r.state === 'CHANGES_REQUESTED'));
  assert.ok(all.comments.some(c => /incident/.test(c.body)));
  assert.ok(all.inline_comments.some(c => c.line === null && c.original_line === 3));
  assert.doesNotMatch(JSON.stringify(all), /FIXTURE_SECRET|unsubmitted draft/);
  const docs = await service.discussion(repo, 207, roles['docs-bot']);
  assert.ok(docs.inline_comments.every(c => c.path.startsWith('docs/')));
  assert.doesNotMatch(JSON.stringify(docs), /src\/client|FIXTURE_SECRET|\.env/);
  assert.match(docs.coverage, /resolved/i);
});

test('changes since an ancestor are scoped and include the exact compared head', async () => {
  const result = await make().changes(repo, 207, since, roles.readonly);
  assert.equal(result.status, 'ahead');
  assert.equal(result.head, 'head207');
  assert.deepEqual(result.files.map(f => f.filename), ['src/client.ts', 'docs/setup.md']);
  assert.doesNotMatch(JSON.stringify(result), /FIXTURE_SECRET|credentials\.md|\.env/);
  const docs = await make().changes(repo, 207, since, roles['docs-bot']);
  assert.deepEqual(docs.files.map(f => f.filename), ['docs/setup.md']);
});

test('rewritten history and capped comparisons never appear to be a complete incremental review', async () => {
  const review = new ReviewService(), service = new FollowupService(review);
  const comparison = await review.github.compare(repo, since, 'head207');
  review.github.compare = async () => ({ ...comparison, status: 'diverged' });
  const rewritten = await service.changes(repo, 207, since, roles.readonly);
  assert.equal(rewritten.status, 'history_changed');
  assert.deepEqual(rewritten.files, []);
  review.github.compare = async () => ({ ...comparison, files: Array.from({ length: 300 }, (_, i) => ({ filename: `docs/${i}.md`, status: 'modified' })) });
  const capped = await service.changes(repo, 207, since, roles.readonly);
  assert.equal(capped.possibly_truncated, true);
  assert.equal(capped.unchecked_paths.length, 300);
});

test('saved findings are matched across line shifts without claiming that absent findings are fixed', async () => {
  const review = new ReviewService(), service = new FollowupService(review);
  const old = await review.check(repo, 207, roles.readonly);
  const shifted = old.findings.map(f => ({ ...f, line: f.line + 2 }));
  review.check = async () => ({ ...old, findings: shifted });
  const result = await service.recheck(repo, 207, old.findings, roles.readonly);
  assert.ok(result.findings.every(f => f.status === 'still_detected'));
  assert.deepEqual(result.findings[0].current_lines, [5]);
  review.check = async () => ({ ...old, findings: [], unchecked_paths: ['src/client.ts'] });
  const missing = await service.recheck(repo, 207, old.findings, roles.readonly);
  assert.equal(missing.findings[0].status, 'unverified');
  assert.equal(missing.findings.at(-1).status, 'not_detected');
  await assert.rejects(service.recheck(repo, 207, old.findings, roles['docs-bot']), /not found/);
});

test('symlinks and a capped file list cannot reveal a protected path', async () => {
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';
  const head = 'a'.repeat(40), root = 'b'.repeat(40), docs = 'c'.repeat(40), link = 'd'.repeat(40);
  let target = '../.env';
  let body = 'TOKEN=FIXTURE_SECRET_NEVER_RETURN';
  const urls = [];
  const many = Array.from({ length: 3001 }, (_, i) => ({ filename: i === 3000 ? 'docs/link.md' : `docs/n${i}.md`, status: 'renamed', previous_filename: i === 3000 ? '.env' : `docs/old${i}.md` }));
  const github = new GitHub(false, async url => {
    urls.push(String(url));
    const page = new URL(url).searchParams.get('page');
    if (String(url).includes('/pulls/207/files')) {
      const start = (Number(page) - 1) * 100;
      return new Response(JSON.stringify(many.slice(start, start + 100)));
    }
    if (String(url).includes('/pulls/9/files')) return new Response(JSON.stringify([]));
    if (String(url).includes('/pulls/207') || String(url).includes('/pulls/9')) return new Response(JSON.stringify({ number: 9, title: 't', body: '', html_url: 'https://example.test/9', user: { login: 'ava' }, merged_at: null, head: { sha: head }, base: { sha: 'b'.repeat(40), ref: 'main' } }));
    if (String(url).includes(`/git/commits/${head}`)) return new Response(JSON.stringify({ tree: { sha: root } }));
    if (String(url).includes(`/git/trees/${root}`)) return new Response(JSON.stringify({ truncated: false, tree: [{ path: 'docs', mode: '040000', type: 'tree', sha: docs }, { path: 'README.md', mode: '100644', type: 'blob', sha: 'e'.repeat(40) }] }));
    if (String(url).includes(`/git/trees/${docs}`)) return new Response(JSON.stringify({ truncated: false, tree: [{ path: 'link.md', mode: '120000', type: 'blob', sha: link }] }));
    if (String(url).includes(`/git/blobs/${link}`)) return new Response(JSON.stringify({ encoding: 'base64', content: Buffer.from(target).toString('base64') }));
    if (String(url).includes('/contents/')) return new Response(JSON.stringify({ encoding: 'base64', content: Buffer.from(body).toString('base64') }));
    return new Response('missing', { status: 404 });
  });
  const review = new ReviewService();
  review.github = github;
  const service = new FollowupService(review);
  try {
    await assert.rejects(service.file(repo, 207, 'docs/link.md', 1, 1, roles.readonly), /not found/);
    assert.equal(urls.some(url => url.includes('/contents/')), false);
    urls.length = 0;
    github.files = async () => [];
    await assert.rejects(service.file(repo, 9, 'docs/link.md', 1, 1, roles.readonly), /not found/);
    assert.ok(urls.some(url => url.includes('/git/blobs/')));
    assert.equal(urls.some(url => url.includes('/contents/')), false);
    target = '../README.md';
    body = '# Launchpad\n';
    const allowed = await service.file(repo, 9, 'docs/link.md', 1, 1, roles.readonly);
    assert.equal(allowed.content, '# Launchpad');
    target = '../src/client.ts';
    await assert.rejects(service.file(repo, 9, 'docs/link.md', 1, 1, roles['docs-bot']), /not found/);
  } finally { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; }

  const local = new ReviewService(), reader = new FollowupService(local);
  const realFiles = local.github.files.bind(local.github);
  local.github.files = async () => Array.from({ length: 2999 }, (_, i) => ({ filename: `docs/extra-${i}.md`, status: 'added' }));
  assert.match((await reader.file(repo, 207, 'src/client.ts', 3, 3, roles.readonly)).content, /fetch\(url\)/);
  local.github.files = async () => Array.from({ length: 3000 }, (_, i) => ({ filename: `docs/extra-${i}.md`, status: 'added' }));
  await assert.rejects(reader.file(repo, 207, 'src/client.ts', 3, 3, roles.readonly), /not found/);
  local.github.files = async () => [{ filename: 'src/client.ts', status: 'modified' }, ...Array.from({ length: 2999 }, (_, i) => ({ filename: `docs/extra-${i}.md`, status: 'added' }))];
  assert.match((await reader.file(repo, 207, 'src/client.ts', 3, 3, roles.readonly)).content, /fetch\(url\)/);
  local.github.files = realFiles;
});

test('new reads reject a PR head change while assembling results', async () => {
  for (const work of [s => s.file(repo, 207, 'src/client.ts', 1, 2, roles.readonly), s => s.discussion(repo, 207, roles.readonly),
    s => s.changes(repo, 207, since, roles.readonly), s => s.recheck(repo, 207, [], roles.readonly)]) {
    const review = new ReviewService(), pull = review.github.pull.bind(review.github);
    let calls = 0;
    review.github.pull = async (...args) => ({ ...await pull(...args), head: { sha: ++calls > 1 ? 'changed' : 'head207' } });
    await assert.rejects(work(new FollowupService(review)), /PR changed/);
  }
});

test('new REST reads paginate discussion and pin comparisons without returning extra response fields', async () => {
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';
  const urls = [];
  const github = new GitHub(false, async url => {
    urls.push(url);
    if (url.includes('/compare/')) return new Response(JSON.stringify({ status: 'ahead', base_commit: { sha: since }, merge_base_commit: { sha: since }, files: [] }));
    return new Response(JSON.stringify(new URL(url).searchParams.get('page') === '1'
      ? Array.from({ length: 100 }, (_, id) => ({ id, body: null, user: null })) : [{ id: 101, body: 'Follow up', user: { login: 'ava' } }]));
  });
  try {
    const comments = await github.issueComments(repo, 207);
    assert.equal(comments.length, 101);
    assert.equal(comments[0].body, '');
    assert.match(urls[1], /page=2/);
    await github.compare(repo, since, 'b'.repeat(40));
    assert.match(urls[2], /compare\/a{40}\.\.\.b{40}\?per_page=1&page=1$/);
  } finally { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; }
});
