import { fileURLToPath } from 'node:url';
// Desktop MCP clients can launch us from any working directory.
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
process.env.MCP_TRANSPORT_TYPE = 'stdio';
await import('../dist/index.js');
