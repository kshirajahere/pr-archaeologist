import { readFileSync } from 'node:fs';
import type { FileChange } from './types.js';

export interface Role { apiKeyEnv: string; repos: string[]; allow: string[]; post: 'dry-run' | 'review' | 'docs-only' }
export const roles: Record<string, Role> = JSON.parse(readFileSync(process.env.ROLES_FILE ?? new URL('../../config/roles.json', import.meta.url), 'utf8'));

export function canRead(role: Role, path: string): boolean {
  if (!path || /[\\%\x00-\x1f:]/.test(path) || path.startsWith('/')) return false;
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /^\.env/i.test(p) || /\.pem$/i.test(p) || p.toLowerCase() === 'secrets')) return false;
  return role.allow.some(prefix => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix);
}
export function visibleFile(role: Role, file: FileChange): boolean {
  return canRead(role, file.filename) && (!file.previous_filename || canRead(role, file.previous_filename));
}
const REDACTED = '[content outside role scope]';

function decodeRepeated(value: string): string {
  let current = value;
  for (let i = 0; i < 2; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(current)) break;
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch { break; }
  }
  return current.replace(/\\/g, '/');
}

function isSecretPath(path: string): boolean {
  return decodeRepeated(path).split('/').some(part =>
    /^\.env(?:\.[\w.-]*)?$/i.test(part) || part.toLowerCase() === 'secrets' || /\.pem$/i.test(part));
}

function normalizeRepoPath(token: string): string | null {
  const parts: string[] = [];
  for (const part of decodeRepeated(token).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

// Relative imports are not repository paths. Secret names and root escapes still count.
function mentionsUnavailable(role: Role, token: string): boolean {
  const trimmed = token.replace(/^[^A-Za-z0-9.]+/, '').replace(/[),.;:]+$/g, '');
  if (!trimmed) return false;
  const decoded = decodeRepeated(trimmed);
  if (isSecretPath(decoded)) return true;
  if (/^(?:\.\/|\.\.\/)/.test(decoded)) return false;
  const normalized = normalizeRepoPath(decoded);
  if (normalized == null) return true;
  if (isSecretPath(normalized)) return true;
  if (!normalized.includes('/') || !/\.[A-Za-z0-9]+$/.test(normalized)) return false;
  return !canRead(role, normalized);
}

// Suppress a whole untrusted field when it names a path this role cannot read.
// URLs, MIME types, owner/repo names, and relative imports are not file paths.
export function safeText(role: Role, value: string): string {
  if (typeof value !== 'string') return '';
  if (!value) return value;
  const urls = value.match(/https?:\/\/[^\s)\]>'"]+/g) ?? [];
  for (const raw of urls) {
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    const parts = url.pathname.split('/').filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return part; } });
    if (isSecretPath(parts.join('/'))) return REDACTED;
    if (url.hostname.toLowerCase() === 'github.com' && parts.length >= 5 && ['blob', 'raw', 'tree'].includes(parts[2])
      && mentionsUnavailable(role, parts.slice(4).join('/'))) return REDACTED;
  }
  const withoutUrls = value.replace(/https?:\/\/[^\s)\]>'"]+/g, ' ');
  const tokenRe = /(?:\.{1,2}[/\\]|(?:[\w.-]+[/\\])+)[\w.@%-]+|(?:^|[^A-Za-z0-9_.])\.env(?:\.[\w.-]+)?|[\w.-]+\.pem/gi;
  for (const match of withoutUrls.matchAll(tokenRe)) {
    if (mentionsUnavailable(role, match[0])) return REDACTED;
  }
  return value;
}
