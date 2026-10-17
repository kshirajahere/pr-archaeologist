import { readFileSync } from 'node:fs';
import type { Commit, CommitComparison, DiscussionComment, FileChange, Issue, PullRequest, Review, ReviewComment, ReviewInput } from './types.js';

function clone<T>(value: T): T { return structuredClone(value); }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function assertPath(path: string): void {
  if (typeof path !== 'string' || !path || /[\\%\x00-\x1f:]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('not found');
}
function normalizePull(pull: PullRequest): PullRequest {
  const copy = clone(pull);
  copy.title = text(copy.title);
  copy.body = text(copy.body);
  copy.user = { login: text(copy.user?.login) };
  if (!copy.head?.sha) copy.head = { sha: '' };
  if (!copy.base) copy.base = { sha: '', ref: '' };
  return copy;
}
function normalizeIssue(issue: Issue): Issue {
  const copy = clone(issue);
  copy.title = text(copy.title);
  copy.body = text(copy.body);
  return copy;
}
function normalizeComment(comment: ReviewComment): ReviewComment {
  const copy = clone(comment);
  copy.body = text(copy.body);
  copy.user = { login: text(copy.user?.login) };
  return copy;
}
function normalizeReview(review: Review): Review {
  const copy = clone(review);
  copy.user = { login: text(copy.user?.login) };
  copy.body = text(copy.body);
  return copy;
}
function normalizeCommit(commit: Commit): Commit {
  const copy = clone(commit);
  copy.parents = Array.isArray(copy.parents) ? copy.parents : [];
  copy.files = Array.isArray(copy.files) ? copy.files : [];
  const author = copy.commit?.author;
  copy.commit = { message: text(copy.commit?.message), author: { name: text(author?.name), date: text(author?.date) } };
  return copy;
}

interface Snapshot {
  repo: string;
  pulls: PullRequest[];
  files: Record<string, FileChange[]>;
  comments: Record<string, ReviewComment[]>;
  reviews: Record<string, Review[]>;
  commits: Commit[];
  commitPulls: Record<string, number[]>;
  issues: Issue[];
  contents: Record<string, string>;
  contentsByRef?: Record<string, Record<string, string | null>>;
  issueComments?: Record<string, DiscussionComment[]>;
  comparisons?: Record<string, CommitComparison>;
}

export class GitHub {
  readonly mock: boolean;
  private snapshot?: Snapshot;
  readonly posted: ReviewInput[] = [];
  constructor(mock = process.env.MOCK === '1', private request: typeof fetch = fetch) {
    this.mock = mock;
    if (mock) this.snapshot = JSON.parse(readFileSync(new URL('../../fixtures/github.json', import.meta.url), 'utf8'));
  }
  private fixture(repo: string): Snapshot {
    if (this.snapshot?.repo !== repo) throw new Error('not found');
    return this.snapshot;
  }
  private async api<T>(route: string, body?: unknown): Promise<T> {
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required for live mode');
    const response = await this.request(`https://api.github.com/repos/${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000)
    });
    if (response.status === 404) throw new Error('not found');
    if (!response.ok) throw new Error(`GitHub request failed (${response.status}); check token permissions or rate limits`);
    return response.json() as Promise<T>;
  }
  private async pages<T>(route: string, limit = 300): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; result.length < limit; page++) {
      const rows = await this.api<unknown>(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(rows)) throw new Error('GitHub request failed (invalid response)');
      result.push(...rows as T[]);
      if (rows.length < 100) break;
    }
    return result.slice(0, limit);
  }
  async pull(repo: string, pr: number): Promise<PullRequest> {
    if (!this.mock) return normalizePull(await this.api(`${repo}/pulls/${pr}`));
    const pull = this.fixture(repo).pulls.find(p => p.number === pr);
    if (!pull) throw new Error('not found');
    return normalizePull(pull);
  }
  async defaultHead(repo: string): Promise<string> {
    if (this.mock) { this.fixture(repo); return 'base206'; }
    const commits = await this.api<{ sha: string }[]>(`${repo}/commits?per_page=1`);
    if (!Array.isArray(commits) || !commits[0]?.sha) throw new Error('not found');
    return commits[0].sha;
  }
  async files(repo: string, pr: number): Promise<FileChange[]> {
    if (this.mock) {
      await this.pull(repo, pr);
      const rows = this.fixture(repo).files[pr];
      return Array.isArray(rows) ? clone(rows) : [];
    }
    return this.pages(`${repo}/pulls/${pr}/files`, 3000);
  }
  async entry(repo: string, ref: string, path: string): Promise<{ mode: string; type: string; sha: string } | null> {
    assertPath(path);
    if (this.mock) {
      const snap = this.fixture(repo);
      const version = snap.contentsByRef?.[ref];
      const present = version && Object.hasOwn(version, path) ? typeof version[path] === 'string' : typeof snap.contents[path] === 'string';
      return present ? { mode: '100644', type: 'blob', sha: 'mock' } : null;
    }
    if (!/^[a-f0-9]{40}$/i.test(ref)) throw new Error('not found');
    const commit = await this.api<{ tree?: { sha?: string } }>(`${repo}/git/commits/${ref}`);
    let treeSha = commit.tree?.sha;
    if (typeof treeSha !== 'string' || !treeSha) throw new Error('GitHub request failed (invalid response)');
    const parts = path.split('/');
    for (let index = 0; index < parts.length; index++) {
      const tree = await this.api<{ truncated?: boolean; tree?: { path?: unknown; mode?: unknown; type?: unknown; sha?: unknown }[] }>(`${repo}/git/trees/${treeSha}`);
      if (!Array.isArray(tree.tree)) throw new Error('GitHub request failed (invalid response)');
      const item = tree.tree.find(row => row.path === parts[index] && typeof row.mode === 'string' && typeof row.type === 'string' && typeof row.sha === 'string');
      if (!item) {
        if (tree.truncated) throw new Error('not found');
        return null;
      }
      if (index === parts.length - 1) return { mode: item.mode as string, type: item.type as string, sha: item.sha as string };
      if (item.type !== 'tree') return null;
      treeSha = item.sha as string;
    }
    return null;
  }
  async blob(repo: string, sha: string): Promise<string> {
    if (this.mock || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error('not found');
    const result = await this.api<{ content?: unknown; encoding?: string }>(`${repo}/git/blobs/${sha}`);
    if (result.encoding !== 'base64' || typeof result.content !== 'string') throw new Error('Content unavailable');
    return Buffer.from(result.content, 'base64').toString('utf8');
  }
  async merged(repo: string, n = 300): Promise<PullRequest[]> {
    if (this.mock) return this.fixture(repo).pulls.filter(p => p.merged_at).sort((a, b) => text(b.merged_at).localeCompare(text(a.merged_at))).slice(0, n).map(normalizePull);
    const merged: PullRequest[] = [];
    for (let page = 1; page <= 30 && merged.length < n; page++) {
      const rows = await this.api<PullRequest[]>(`${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
      if (!Array.isArray(rows)) throw new Error('GitHub request failed (invalid response)');
      merged.push(...rows.filter(p => p.merged_at));
      if (rows.length < 100) break;
    }
    return merged.slice(0, n).map(normalizePull);
  }
  async comments(repo: string, pr: number): Promise<ReviewComment[]> {
    if (this.mock) {
      await this.pull(repo, pr);
      const rows = this.fixture(repo).comments[pr];
      return Array.isArray(rows) ? rows.map(normalizeComment) : [];
    }
    return (await this.pages<ReviewComment>(`${repo}/pulls/${pr}/comments`)).map(normalizeComment);
  }
  async reviews(repo: string, pr: number): Promise<Review[]> {
    if (this.mock) {
      await this.pull(repo, pr);
      const rows = this.fixture(repo).reviews[pr];
      return Array.isArray(rows) ? rows.map(normalizeReview) : [];
    }
    return (await this.pages<Review>(`${repo}/pulls/${pr}/reviews`)).map(normalizeReview);
  }
  async issueComments(repo: string, pr: number): Promise<DiscussionComment[]> {
    if (this.mock) await this.pull(repo, pr);
    const rows = this.mock ? this.fixture(repo).issueComments?.[pr] ?? [] : await this.pages<DiscussionComment>(`${repo}/issues/${pr}/comments`);
    return rows.map(row => ({ ...clone(row), body: text(row.body), user: { login: text(row.user?.login) } }));
  }
  async compare(repo: string, base: string, head: string): Promise<CommitComparison> {
    if (this.mock) {
      const fixture = this.fixture(repo);
      if (base === head) return { status: 'identical', base_commit: { sha: base }, merge_base_commit: { sha: base }, files: [] };
      const result = fixture.comparisons?.[`${base}...${head}`];
      if (!result) throw new Error('not found');
      return clone(result);
    }
    if (!/^[a-f0-9]{40}$/i.test(base) || !/^[a-f0-9]{40}$/i.test(head)) throw new Error('not found');
    const result = await this.api<CommitComparison>(`${repo}/compare/${base}...${head}?per_page=1&page=1`);
    if (!Array.isArray(result.files) || !result.base_commit?.sha || !result.merge_base_commit?.sha) throw new Error('GitHub request failed (invalid response)');
    return { status: result.status, base_commit: { sha: result.base_commit.sha }, merge_base_commit: { sha: result.merge_base_commit.sha }, files: result.files };
  }
  async history(repo: string, path: string, ref?: string): Promise<{ sha: string }[]> {
    assertPath(path);
    if (!this.mock) return this.pages(`${repo}/commits?path=${encodeURIComponent(path)}${ref ? `&sha=${encodeURIComponent(ref)}` : ''}`, 100);
    return this.fixture(repo).commits.filter(c => Array.isArray(c.files) && c.files.some(f => f.filename === path))
      .sort((a, b) => text(b.commit?.author?.date).localeCompare(text(a.commit?.author?.date)))
      .map(c => ({ sha: c.sha }));
  }
  async commit(repo: string, sha: string): Promise<Commit> {
    if (!this.mock) return normalizeCommit(await this.api(`${repo}/commits/${sha}`));
    const commit = this.fixture(repo).commits.find(c => c.sha === sha);
    if (!commit) throw new Error('not found');
    return normalizeCommit(commit);
  }
  async commitPulls(repo: string, sha: string): Promise<PullRequest[]> {
    if (!this.mock) return (await this.pages<PullRequest>(`${repo}/commits/${sha}/pulls`)).map(normalizePull);
    return this.fixture(repo).pulls.filter(p => this.fixture(repo).commitPulls[sha]?.includes(p.number)).map(normalizePull);
  }
  async issue(repo: string, number: number): Promise<Issue> {
    if (!this.mock) return normalizeIssue(await this.api(`${repo}/issues/${number}`));
    const issue = this.fixture(repo).issues.find(i => i.number === number);
    if (!issue) throw new Error('not found');
    return normalizeIssue(issue);
  }
  async content(repo: string, path: string, ref?: string): Promise<string> {
    assertPath(path);
    if (this.mock) {
      const version = ref && this.fixture(repo).contentsByRef?.[ref];
      if (version && Object.hasOwn(version, path)) {
        if (typeof version[path] !== 'string') throw new Error('not found');
        return version[path];
      }
      const content = this.fixture(repo).contents[path];
      if (typeof content !== 'string') throw new Error('not found');
      return content;
    }
    const result = await this.api<{ content?: unknown; encoding?: string }>(`${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
    if (result.encoding !== 'base64' || typeof result.content !== 'string') throw new Error('Content unavailable');
    return Buffer.from(result.content, 'base64').toString('utf8');
  }
  async post(repo: string, pr: number, input: ReviewInput, commit_id: string): Promise<unknown> {
    if (this.mock) { this.fixture(repo); this.posted.push(clone(input)); return { id: 9001, html_url: `https://github.com/${repo}/pull/${pr}#pullrequestreview-9001`, mock: true }; }
    return this.api(`${repo}/pulls/${pr}/reviews`, { ...input, commit_id, event: 'COMMENT', comments: input.comments.map(c => ({ ...c, side: 'RIGHT' })) });
  }
}
