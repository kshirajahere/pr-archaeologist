import { diffLines, type DiffLine } from './diff.js';
import { canRead, safeText, visibleFile, type Role } from './policy.js';
import type { GitHub } from './github.js';

export interface Source { pr: number; path: string; quote: string; url: string; author: string; date: string }
export interface TeamRule { id: string; rule: string; scope: 'src/' | 'docs/'; confidence: number; support: number; sources: Source[] }
const patterns = [
  { id: 'fetch-timeout', rule: 'Set an explicit timeout on fetch calls.', scope: 'src/' as const, match: (s: string) => /timeout/i.test(s) && /fetch/i.test(s) },
  { id: 'structured-logging', rule: 'Use the structured logger instead of console.log.', scope: 'src/' as const, match: (s: string) => /structured log/i.test(s) && /console\.log/i.test(s) },
  { id: 'stable-retry-key', rule: 'Reuse the same idempotency key across retries.', scope: 'src/' as const, match: (s: string) => /idempotency key/i.test(s) && /retr(?:y|ies)/i.test(s) },
  { id: 'fence-language', rule: 'Give opening fenced code blocks a language tag.', scope: 'docs/' as const, match: (s: string) => /fenced code blocks/i.test(s) && /language tag/i.test(s) }
];

export async function learn(github: GitHub, repo: string, n: number, role: Role) {
  const sources = new Map<string, Source[]>();
  const pulls = await github.merged(repo, n);
  for (const pull of pulls) {
    for (const comment of await github.comments(repo, pull.number)) {
      if (!canRead(role, comment.path) || comment.in_reply_to_id) continue;
      const quote = safeText(role, comment.body);
      if (quote !== comment.body) continue;
      for (const pattern of patterns) {
        if (!pattern.match(quote)) continue;
        const entries = sources.get(pattern.id) ?? [];
        if (!entries.some(s => s.pr === pull.number)) entries.push({ pr: pull.number, path: comment.path, quote, url: comment.html_url, author: comment.user.login, date: comment.created_at });
        sources.set(pattern.id, entries);
      }
    }
  }
  const rules: TeamRule[] = [];
  for (const pattern of patterns) {
    const entries = sources.get(pattern.id) ?? [];
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.pr - b.pr);
    rules.push({ id: pattern.id, rule: pattern.rule, scope: pattern.scope, confidence: Math.min(0.95, 0.55 + entries.length * 0.1), support: entries.length, sources: entries });
  }
  return { repo, rules, scanned_prs: pulls.length, requested: n,
    method: 'Conservative recurring comment patterns across at least two merged PRs; confidence is a support heuristic, not a probability. No semantic LLM classification.',
    coverage: 'Up to n merged PRs from the latest 3000 closed PRs ordered by update, up to 300 review comments per PR. Only four supported rule families are mined.' };
}

export function violates(rule: string, row: DiffLine, rows: DiffLine[]): boolean {
  if (row.kind !== 'add') return false;
  switch (rule) {
    case 'fetch-timeout': return /\bfetch\s*\(/.test(row.text) && /\);?\s*$/.test(row.text) && !/timeout|signal\s*:/.test(row.text);
    case 'structured-logging': return /\bconsole\.log\s*\(/.test(row.text);
    case 'stable-retry-key': return /\bretry\s*\(/.test(row.text) && /randomUUID\s*\(/.test(row.text);
    case 'fence-language': {
      let inFence = false;
      for (const candidate of rows.filter(r => r.kind !== 'remove')) {
        if (candidate === row) return /^\s*```\s*$/.test(row.text) && !inFence;
        if (/^\s*```/.test(candidate.text)) inFence = !inFence;
      }
      return false;
    }
    default: return false;
  }
}

export async function decisionTimeline(github: GitHub, repo: string, role: Role) {
  const decisions = [];
  for (const past of await github.merged(repo, 100)) {
    if (!/\b(fix(?:e[sd])?|revert(?:e[sd])?|rollback)\b/i.test(`${past.title} ${past.body}`)) continue;
    const files = (await github.files(repo, past.number)).filter(f => visibleFile(role, f) && f.patch);
    if (!files.length) continue;
    const comments = (await github.comments(repo, past.number)).filter(c => canRead(role, c.path));
    decisions.push({ pr: past.number, title: safeText(role, past.title), url: past.html_url, date: past.merged_at,
      files: files.map(f => ({ path: f.filename, patch: safeText(role, f.patch!) })),
      sources: comments.map(c => ({ path: c.path, quote: safeText(role, c.body), url: c.html_url })) });
  }
  return decisions.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}
