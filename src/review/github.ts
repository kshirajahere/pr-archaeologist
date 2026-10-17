import { readFileSync } from 'node:fs';
import type { Commit, FileChange, Issue, PullRequest, Review, ReviewComment, ReviewInput } from './types.js';

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
      const rows = await this.api<T[]>(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      result.push(...rows);
      if (rows.length < 100) break;
    }
    return result.slice(0, limit);
  }
  async pull(repo: string, pr: number): Promise<PullRequest> {
    if (!this.mock) return this.api(`${repo}/pulls/${pr}`);
    const pull = this.fixture(repo).pulls.find(p => p.number === pr);
    if (!pull) throw new Error('not found');
    return pull;
  }
  async defaultHead(repo: string): Promise<string> {
    if (this.mock) { this.fixture(repo); return 'base206'; }
    const commits = await this.api<{ sha: string }[]>(`${repo}/commits?per_page=1`);
    if (!commits[0]) throw new Error('not found');
    return commits[0].sha;
  }
  async files(repo: string, pr: number): Promise<FileChange[]> {
    if (this.mock) await this.pull(repo, pr);
    return this.mock ? this.fixture(repo).files[pr] ?? [] : this.pages(`${repo}/pulls/${pr}/files`, 3000);
  }
  async merged(repo: string, n = 300): Promise<PullRequest[]> {
    if (this.mock) return this.fixture(repo).pulls.filter(p => p.merged_at).slice(0, n);
    const merged: PullRequest[] = [];
    for (let page = 1; page <= 30 && merged.length < n; page++) {
      const rows = await this.api<PullRequest[]>(`${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
      merged.push(...rows.filter(p => p.merged_at));
      if (rows.length < 100) break;
    }
    return merged.slice(0, n);
  }
  async comments(repo: string, pr: number): Promise<ReviewComment[]> {
    if (this.mock) await this.pull(repo, pr);
    return this.mock ? this.fixture(repo).comments[pr] ?? [] : this.pages(`${repo}/pulls/${pr}/comments`);
  }
  async reviews(repo: string, pr: number): Promise<Review[]> {
    if (this.mock) await this.pull(repo, pr);
    return this.mock ? this.fixture(repo).reviews[pr] ?? [] : this.pages(`${repo}/pulls/${pr}/reviews`);
  }
  async history(repo: string, path: string, ref?: string): Promise<{ sha: string }[]> {
    return this.mock ? this.fixture(repo).commits.filter(c => c.files.some(f => f.filename === path))
      : this.pages(`${repo}/commits?path=${encodeURIComponent(path)}${ref ? `&sha=${encodeURIComponent(ref)}` : ''}`, 100);
  }
  async commit(repo: string, sha: string): Promise<Commit> {
    if (!this.mock) return this.api(`${repo}/commits/${sha}`);
    const commit = this.fixture(repo).commits.find(c => c.sha === sha);
    if (!commit) throw new Error('not found');
    return commit;
  }
  async commitPulls(repo: string, sha: string): Promise<PullRequest[]> {
    return this.mock ? this.fixture(repo).pulls.filter(p => this.fixture(repo).commitPulls[sha]?.includes(p.number))
      : this.pages(`${repo}/commits/${sha}/pulls`);
  }
  async issue(repo: string, number: number): Promise<Issue> {
    if (!this.mock) return this.api(`${repo}/issues/${number}`);
    const issue = this.fixture(repo).issues.find(i => i.number === number);
    if (!issue) throw new Error('not found');
    return issue;
  }
  async content(repo: string, path: string, ref?: string): Promise<string> {
    if (this.mock) {
      const content = this.fixture(repo).contents[path];
      if (content === undefined) throw new Error('not found');
      return content;
    }
    const result = await this.api<{ content: string; encoding: string }>(`${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
    if (result.encoding !== 'base64') throw new Error('Content unavailable');
    return Buffer.from(result.content, 'base64').toString('utf8');
  }
  async post(repo: string, pr: number, input: ReviewInput, commit_id: string): Promise<unknown> {
    if (this.mock) { this.fixture(repo); this.posted.push(input); return { id: 9001, html_url: `https://github.com/${repo}/pull/${pr}#pullrequestreview-9001`, mock: true }; }
    return this.api(`${repo}/pulls/${pr}/reviews`, { ...input, commit_id, event: 'COMMENT', comments: input.comments.map(c => ({ ...c, side: 'RIGHT' })) });
  }
}
