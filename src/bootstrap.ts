import { McpApplicationFactory, createResource } from '@nitrostack/core';
import { readFileSync } from 'node:fs';
import { AppModule } from './app.module.js';
import { audited, installAudit } from './security/audit.js';
import { RoleGuard, roleFor } from './security/access.js';
import { canRead } from './review/policy.js';

export async function createServer() {
  const server = await McpApplicationFactory.create(AppModule);
  installAudit(server);
  // NitroStack's built-in examples resource is public by default. Scope ours.
  server.resource(createResource({ uri: 'widget://examples', name: 'Review card examples', description: 'Public fixture examples filtered to the authenticated role.', mimeType: 'application/json',
    handler: async (_uri, ctx) => audited('widget://examples', {}, ctx, async () => {
      new RoleGuard().canActivate(ctx);
      const role = roleFor(ctx, 'acme/launchpad');
      const manifest = JSON.parse(readFileSync(new URL('../src/widgets/widget-manifest.json', import.meta.url), 'utf8'));
      const widgets = Array.isArray(manifest.widgets) ? manifest.widgets : [];
      for (const widget of widgets) for (const example of widget.examples ?? []) {
        const findings = example?.data?.findings;
        if (!Array.isArray(findings)) continue;
        example.data.findings = findings.filter((f: { path?: string; source?: { path?: string } }) => typeof f?.path === 'string' && typeof f.source?.path === 'string' && canRead(role, f.path) && canRead(role, f.source.path));
      }
      return { type: 'json', data: { ...manifest, widgets, count: widgets.length, loaded: true } };
    }) }));
  return server;
}
