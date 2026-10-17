import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
// NitroStack 1.1.2 bundles each page independently of the Next root layout.
// Keep exported MCP HTML self-contained, with the same CSS as the dev preview.
const css = readFileSync('src/widgets/app/globals.css', 'utf8');
for (const file of readdirSync('src/widgets/out').filter(f => f.endsWith('.html'))) {
  const path = `src/widgets/out/${file}`;
  const html = readFileSync(path, 'utf8');
  writeFileSync(path, html.replace('</head>', `<style>${css}</style></head>`));
}
