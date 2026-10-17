import { Injectable, Cache } from '@nitrostack/core';
import { createHash } from 'node:crypto';
import { GitHub } from './github.js';
import { diffLines, previousLine } from './diff.js';
import { learn, violates, decisionTimeline } from './rules.js';
import type { ReviewInput } from './types.js';
import { canRead, safeText, visibleFile, type Role } from './policy.js';

@Injectable()
export class ReviewService {
  readonly github = new GitHub();

  async reviewers(repo: string, pr: number, role: Role) {
    const pull = await this.github.pull(repo, pr);
    const paths = new Set((await this.github.files(repo, pr)).filter(f => visibleFile(role, f)).map(f => f.filename));
    const people = new Map<string, { login: string; changes: number; reviews: number; paths: Set<string>; evidence: Set<string> }>();
    const add = (login: string, kind: 'changes' | 'reviews', shared: string[], url: string) => {
      if (login === pull.user.login || login.endsWith('[bot]')) return;
      const person = people.get(login) ?? { login, changes: 0, reviews: 0, paths: new Set<string>(), evidence: new Set<string>() };
      person[kind]++;
      shared.forEach(p => person.paths.add(p)); person.evidence.add(url); people.set(login, person);
    };
    for (const past of await this.github.merged(repo, 100)) {
      if (past.number === pr) continue;
      const shared = (await this.github.files(repo, past.number)).filter(f => visibleFile(role, f) && paths.has(f.filename)).map(f => f.filename);
      if (!shared.length) continue;
      add(past.user.login, 'changes', shared, past.html_url);
      const seen = new Set<string>();
      for (const review of await this.github.reviews(repo, past.number)) {
        if (review.state === 'PENDING') continue;
        if (seen.has(review.user.login)) continue;
        seen.add(review.user.login);
        add(review.user.login, 'reviews', shared, review.html_url);
      }
    }
    return { repo, pr, reviewers: [...people.values()].map(p => ({ ...p, paths: [...p.paths].sort(), evidence: [...p.evidence], score: p.changes * 2 + p.reviews }))
      .sort((a, b) => b.score - a.score || a.login.localeCompare(b.login)),
      method: 'Same-path merged PR authors (2 points) and reviewers (1 point); up to 100 merged PRs by update. Excludes current author and bot accounts. PR review participation is a path-expertise proxy.' };
  }

  async draft(repo: string, pr: number, role: Role) {
    const pull = await this.github.pull(repo, pr);
    const check = await this.check(repo, pr, role);
    const conflicts = await this.conflicts(repo, pr, role);
    if ((await this.github.pull(repo, pr)).head.sha !== pull.head.sha) throw new Error('PR changed; refresh context and review the new head');
    const suggestions = [
      ...check.findings.map(f => ({ path: f.path, line: f.line,
        body: `${f.rule}\n\n> ${f.source.quote.replace(/\n/g, '\n> ')}\n\nSource: ${f.source.url}` })),
      ...conflicts.conflicts.map(c => ({ path: c.path, line: c.line,
        body: `${c.warning}\n\n> ${c.source.quote.replace(/\n/g, '\n> ')}\n\nSource: ${c.source.url}\nHistorical fix: ${c.url}` }))
    ];
    const comments = suggestions.filter(c => c.body.length <= 5000).slice(0, 50);
    const omitted = suggestions.length - comments.length;
    const body = role.post === 'docs-only' ? '' : [
      suggestions.length ? `${suggestions.length} evidence-backed review suggestions; ${comments.length} inline comments prepared. Original sources accompany included comments.` : 'No supported rule violations or decision conflicts found.',
      'Continue manual review: these checks do not establish correctness.',
      ...(omitted ? [`${omitted} ${omitted === 1 ? 'suggestion' : 'suggestions'} omitted due to posting limits.`] : [])
    ].join('\n\n');
    return { repo, pr, posted: false, review: { repo, pr, body, comments, expected_head: pull.head.sha }, omitted_comments: omitted,
      unchecked_paths: check.unchecked_paths, coverage: `${check.coverage}\n${conflicts.coverage}` };
  }

  async post(repo: string, pr: number, input: ReviewInput, role: Role, expectedHead?: string) {
    const pull = await this.github.pull(repo, pr);
    if (expectedHead && pull.head.sha !== expectedHead) throw new Error('PR changed; refresh context and review the new head');
    const files = (await this.github.files(repo, pr)).filter(f => visibleFile(role, f));
    if (safeText(role, input.body) !== input.body) throw new Error('not found');
    if (role.post === 'docs-only' && (input.body.trim() || !input.comments.length)) throw new Error('not found');
    for (const comment of input.comments) {
      const file = files.find(f => f.filename === comment.path);
      if (!file || !canRead(role, comment.path) || safeText(role, comment.body) !== comment.body ||
        (role.post === 'docs-only' && !comment.path.startsWith('docs/')) ||
        !diffLines(file.patch).some(r => r.kind === 'add' && r.line === comment.line)) throw new Error('not found');
    }
    if ((await this.github.pull(repo, pr)).head.sha !== pull.head.sha) throw new Error('PR changed; refresh context and review the new head');
    if (role.post === 'dry-run') return { dry_run: true, posted: false, review: input, head: pull.head.sha };
    return { dry_run: false, posted: true, mock: this.github.mock, result: await this.github.post(repo, pr, input, pull.head.sha) };
  }

  @Cache({ ttl: 300, key: (input) => createHash('sha256').update(JSON.stringify({ ...input as object, mock: process.env.MOCK === '1' })).digest('hex') })
  async rules(input: { repo: string; n: number; role: Role }) {
    return learn(this.github, input.repo, input.n, input.role);
  }

  async check(repo: string, pr: number, role: Role) {
    const rulebook = await this.rules({ repo, n: 300, role });
    const findings = [];
    const files = (await this.github.files(repo, pr)).filter(f => visibleFile(role, f));
    for (const file of files) {
      const rows = diffLines(file.patch);
      for (const row of rows) {
        for (const rule of rulebook.rules) {
          if (!file.filename.startsWith(rule.scope) || !violates(rule.id, row, rows)) continue;
          findings.push({ path: file.filename, line: row.line, side: 'RIGHT', code: safeText(role, row.text),
            rule_id: rule.id, rule: rule.rule, confidence: rule.confidence, source: rule.sources[0] });
        }
      }
    }
    return { repo, pr, findings, unchecked_paths: files.filter(f => !f.patch).map(f => f.filename),
      coverage: 'Added lines only. Single-line fetch/retry calls and diff-visible Markdown fence state. Findings are review suggestions; complex or multiline constructs need human review.' };
  }

  async decisions(repo: string, role: Role) { return decisionTimeline(this.github, repo, role); }

  async conflicts(repo: string, pr: number, role: Role) {
    const current = (await this.github.files(repo, pr)).filter(f => visibleFile(role, f));
    const conflicts = [];
    for (const decision of await this.decisions(repo, role)) {
      if (decision.pr === pr) continue;
      for (const file of current) {
        const before = decision.files.find(f => f.path === file.filename);
        if (!before) continue;
        const oldRows = diffLines(before.patch), newRows = diffLines(file.patch);
        const removed = newRows.find(r => r.kind === 'remove' && r.text.trim().length > 10 && oldRows.some(o => o.kind === 'add' && o.text.trim() === r.text.trim()));
        const restored = newRows.find(r => r.kind === 'add' && r.text.trim().length > 10 && oldRows.some(o => o.kind === 'remove' && o.text.trim() === r.text.trim()));
        if (!removed || !restored) continue;
        conflicts.push({ path: file.filename, line: restored.line, past_pr: decision.pr, warning: `This reverts the fix from #${decision.pr}; confirm the original incident cannot recur.`,
          removed: safeText(role, removed.text), restored: safeText(role, restored.text), url: decision.url,
          source: decision.sources.find(s => s.path === file.filename) ?? { quote: decision.title, url: decision.url, path: file.filename },
          confidence: 0.9, evidence: 'Exact reverse of a removed and an added line in a past fix/revert PR; semantic equivalence is not inferred.' });
      }
    }
    return { repo, pr, conflicts, coverage: 'Up to 100 merged PRs ordered by update. Exact reverse-line evidence is a warning, not proof of a regression.' };
  }

  async context(repo: string, pr: number, role: Role) {
    const pull = await this.github.pull(repo, pr);
    const files = (await this.github.files(repo, pr)).filter(f => visibleFile(role, f));
    const paths = new Set(files.map(f => f.filename));
    const related = [];
    for (const past of await this.github.merged(repo, 100)) {
      if (past.number === pr) continue;
      const shared = (await this.github.files(repo, past.number)).filter(f => visibleFile(role, f) && paths.has(f.filename));
      if (shared.length) related.push({ pr: past.number, title: safeText(role, past.title), url: past.html_url, paths: shared.map(f => f.filename) });
    }
    const issues = await this.linkedIssues(repo, pull.body, role);
    const docs = [];
    for (const path of ['README.md', 'docs/review-guide.md']) {
      if (!canRead(role, path)) continue;
      try { docs.push({ path, text: safeText(role, await this.github.content(repo, path, pull.base.sha)) }); }
      catch (error) { if ((error as Error).message !== 'not found') throw error; }
    }
    return { repo, pr, title: safeText(role, pull.title), author: pull.user.login, url: pull.html_url,
      head: pull.head.sha, files: files.map(f => ({ ...f, patch: safeText(role, f.patch ?? '') })), issues, related, docs,
      coverage: 'Related history: up to 100 merged PRs ordered by update; docs: README.md and docs/review-guide.md. Missing patches are not reconstructed.' };
  }

  async linkedIssues(repo: string, body: string, role: Role) {
    const numbers = [...body.matchAll(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)].map(m => Number(m[1]));
    const issues = [];
    for (const number of new Set(numbers)) {
      try { const issue = await this.github.issue(repo, number); issues.push({ number, title: safeText(role, issue.title), body: safeText(role, issue.body), url: issue.html_url }); }
      catch (error) { if ((error as Error).message !== 'not found') throw error; }
    }
    return issues;
  }

  async why(repo: string, path: string, line: number, role: Role) {
    if (!canRead(role, path)) throw new Error('not found');
    const head = await this.github.defaultHead(repo);
    const content = await this.github.content(repo, path, head);
    if (line > content.split('\n').length) throw new Error('not found');
    let target = line;
    for (const entry of await this.github.history(repo, path, head)) {
      const commit = await this.github.commit(repo, entry.sha);
      if (commit.parents.length > 1) break; // A merge patch is not line blame evidence.
      const file = commit.files.find(f => f.filename === path);
      if (!file?.patch || file.previous_filename) break;
      const previous = previousLine(file.patch, target);
      if (previous !== 'introduced') { target = previous; continue; }
      const pulls = (await this.github.commitPulls(repo, commit.sha)).filter(p => p.merged_at);
      const pull = pulls[0];
      const comments = pull ? await this.github.comments(repo, pull.number) : [];
      const thread = comments.filter(c => canRead(role, c.path) && c.path === path &&
        (c.line === target || c.original_line === target)).map(c => ({ quote: safeText(role, c.body), url: c.html_url, author: c.user.login }));
      return { repo, path, line, explanation: safeText(role, thread[0]?.quote ?? commit.commit.message.split('\n')[0]),
        blame: { sha: commit.sha, line: target, author: commit.author?.login ?? commit.commit.author.name, url: commit.html_url },
        commit: { message: safeText(role, commit.commit.message), url: commit.html_url },
        pr: pull ? { number: pull.number, title: safeText(role, pull.title), url: pull.html_url } : null,
        thread, issues: pull ? await this.linkedIssues(repo, pull.body, role) : [], evidence: 'Line introduction traced through REST commit patches' };
    }
    return { repo, path, line, explanation: 'History incomplete; no supported explanation found.', evidence: 'At most 100 path commits; stops at merges, renames or missing patches' };
  }
}
