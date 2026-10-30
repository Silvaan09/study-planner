// Bundles the Electron main process and preload script into dist/main.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: true,
  external: ['electron'],
  // CHANGELOG.md is bundled as text for the "What's new" fallback (src/main/whatsNew.ts).
  loader: { '.md': 'text' },
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs' });
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/main/preload.cjs' });
