import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const requestAuthorization = new AsyncLocalStorage<string | undefined>();

// NitroStack 1.1.2 drops raw auth headers when constructing resource contexts.
// Carry the header through Express's request dispatch, without caching identity
// on a session or accepting a process-wide HTTP credential.
function authorizationHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function bridgeHttpAuthorization(app: unknown) {
  if (!app) return; // stdio has no HTTP app
  const dispatcher = app as { handle?: (req: IncomingMessage, res: ServerResponse, next?: unknown) => void };
  if (typeof dispatcher.handle !== 'function') return;
  const handle = dispatcher.handle.bind(app);
  dispatcher.handle = (req, res, next) => requestAuthorization.run(authorizationHeader(req.headers.authorization), () => handle(req, res, next));
}
