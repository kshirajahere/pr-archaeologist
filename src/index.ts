import 'dotenv/config';
import { createServer } from './bootstrap.js';
import { bridgeHttpAuthorization } from './security/http-auth.js';

const server = await createServer();
await server.start();
bridgeHttpAuthorization(server.getHttpTransport()?.getApp?.());
server.enableShutdownHooks();
