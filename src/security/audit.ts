import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { ExecutionContext, NitroStackServer, z } from '@nitrostack/core';
import { principal, RoleGuard } from './access.js';
import { canRead, roles, type Role } from '../review/policy.js';

export interface AuditEntry { time: string; request: string; role: string; subject: string; tool: string; args: Record<string, unknown>; access: 'allowed' | 'denied'; status: 'ok' | 'error' }
function textDigest(value: unknown) {
  if (value && typeof value === 'object' && 'sha256' in value && 'length' in value &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) && typeof value.length === 'number') {
    return { length: value.length, sha256: value.sha256 };
  }
  const text = typeof value === 'string' ? value : '';
  return { length: text.length, sha256: createHash('sha256').update(text).digest('hex') };
}
function argsFor(input: unknown, role?: Role): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const args = input as Record<string, unknown>, result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === 'repo') result.repo = role?.repos.includes(String(value)) ? value : '[redacted]';
    else if (['pr', 'n', 'line'].includes(key) && (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))) result[key] = Number(value);
    else if (key === 'path') result.path = role && typeof value === 'string' && canRead(role, value) ? value : '[redacted]';
    else if (key === 'body') result.body = textDigest(value);
    else if (key === 'comments' && Array.isArray(value)) result.comments = value.slice(0, 50).map(c => argsFor(c, role));
    else result.omitted_args = Number(result.omitted_args ?? 0) + 1;
  }
  return result;
}
function logPath() { return process.env.AUDIT_FILE ?? 'logs/audit.jsonl'; }
export async function audited<T>(tool: string, input: unknown, ctx: ExecutionContext, work: () => Promise<T>): Promise<T> {
  let status: 'ok' | 'error' = 'ok';
  let denied = false;
  try { return await work(); }
  catch (error) { status = 'error'; denied = (error as Error).name === 'ZodError' || /not found|limit|validation|invalid/i.test((error as Error).message); throw error; }
  finally {
    const actor = principal(ctx), role = actor && roles[actor.role];
    const row: AuditEntry = { time: new Date().toISOString(), request: ctx.requestId, role: actor?.role ?? 'anonymous', subject: actor?.subject ?? 'anonymous',
      tool, args: argsFor(input, role), access: actor && !denied ? 'allowed' : 'denied', status };
    mkdirSync(dirname(logPath()), { recursive: true });
    appendFileSync(logPath(), JSON.stringify(row) + '\n', { mode: 0o600 });
  }
}

// Wrap the public tool execution boundary so even guards, validation failures,
// rate limits and cache hits are audited with sanitized arguments.
export function installAudit(server: NitroStackServer) {
  for (const [name, tool] of server.getTools()) {
    const execute = tool.execute.bind(tool);
    tool.execute = (input, ctx) => audited(name, input, ctx, async () => {
      new RoleGuard().canActivate(ctx);
      const parsed = (tool.inputSchema as z.ZodType).parse(input);
      return execute(parsed, ctx);
    });
  }
}

export function readAudit(ctx: ExecutionContext): AuditEntry[] {
  const actor = principal(ctx);
  if (!actor) throw new Error('not found');
  let lines: string;
  try { lines = readFileSync(logPath(), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return lines.split('\n').filter(Boolean).map(line => JSON.parse(line) as AuditEntry)
    .filter(row => row.role === actor.role && row.subject === actor.subject)
    .slice(-200).map(row => ({ ...row, args: argsFor(row.args, roles[actor.role]) }));
}
