import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, type ExecutionContext, type Guard } from '@nitrostack/core';
import { roles, type Role } from '../review/policy.js';
import { requestAuthorization } from './http-auth.js';

export interface Principal { role: string; subject: string }
const verified = new WeakMap<ExecutionContext, Principal>();
export function principal(ctx: ExecutionContext) { return verified.get(ctx); }
function equals(a: string, b: string) {
  // Compare digests so a shorter credential cannot bail out before the secret is read.
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

@Injectable()
export class RoleGuard implements Guard {
  canActivate(ctx: ExecutionContext): boolean {
    verified.delete(ctx); // Never trust NitroStack's unverified bearer decode.
    const meta = ctx.metadata ?? {};
    const authorization = requestAuthorization.getStore() ?? meta.authorization ?? meta.Authorization;
    const supplied = meta.apiKey ?? meta['x-api-key'];
    const localKey = process.env.MCP_TRANSPORT_TYPE === 'stdio' ? process.env.MCP_API_KEY : undefined;
    const credential = typeof authorization === 'string' ? authorization.replace(/^Bearer\s+/i, '')
      : typeof supplied === 'string' ? supplied : localKey;
    if (!credential) throw new Error('not found');
    for (const [name, config] of Object.entries(roles)) {
      const key = process.env[config.apiKeyEnv];
      if ((key && equals(credential, key)) || (process.env.MOCK === '1' && equals(credential, `demo-${name}`))) {
        this.attach(ctx, { role: name, subject: `apikey:${name}` });
        return true;
      }
    }
    const secret = process.env.JWT_SECRET;
    if (secret && secret.length >= 32) {
      try {
        const parts = credential.split('.');
        if (parts.length !== 3) throw new Error('not found');
        const [header, payload, signature] = parts;
        const h = JSON.parse(Buffer.from(header, 'base64url').toString());
        const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
        const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
        const now = Date.now() / 1000;
        if (h.alg === 'HS256' && !h.crit && h.b64 !== false && signature && equals(signature, expected)
          && p.iss === 'pr-archaeologist' && p.aud === 'pr-archaeologist' && Number.isFinite(p.exp) && p.exp > now
          && (p.nbf === undefined || (Number.isFinite(p.nbf) && p.nbf <= now))
          && typeof p.sub === 'string' && p.sub.length > 0 && typeof p.role === 'string' && Object.hasOwn(roles, p.role)) {
          this.attach(ctx, { role: p.role, subject: p.sub });
          return true;
        }
      } catch { /* Invalid credentials deliberately have the same response as absent data. */ }
    }
    throw new Error('not found');
  }
  private attach(ctx: ExecutionContext, actor: Principal) {
    verified.set(ctx, actor);
    ctx.auth = { authenticated: true, subject: actor.subject, claims: { role: actor.role } };
  }
}

export function roleFor(ctx: ExecutionContext, repo?: string): Role {
  const actor = principal(ctx);
  const role = actor && roles[actor.role];
  if (!role || (repo !== undefined && !role.repos.includes(repo))) throw new Error('not found');
  return role;
}
