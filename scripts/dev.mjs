// Development: Vite dev server for the UI + Electron (uses the separate "-dev" data folder).
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

await import('./build-main.mjs');

const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls.local[0];

const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
