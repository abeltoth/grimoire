// Bundles the background service and the Electron main and preload scripts.
// The UI is built separately by the Angular CLI.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (file) => path.join(root, file);

// Electron 45 runs Node 24.
const common = { bundle: true, platform: 'node', target: 'node24', sourcemap: 'linked', logLevel: 'info' };

export const builds = [
  // The Agent SDK stays in node_modules: it finds Claude Code's binary in its platform package there.
  {
    ...common,
    entryPoints: [at('service/src/main.ts')],
    outfile: at('service/dist/service.mjs'),
    format: 'esm',
    external: ['@anthropic-ai/claude-agent-sdk'],
  },
  // The search worker (ADR-010), a process of its own that the service starts beside it.
  {
    ...common,
    entryPoints: [at('modules/search/service/worker-main.ts')],
    outfile: at('service/dist/search-worker.mjs'),
    format: 'esm',
    external: ['@anthropic-ai/claude-agent-sdk'],
  },
  { ...common, entryPoints: [at('app/src/main.ts')], outfile: at('app/dist/main.cjs'), format: 'cjs', external: ['electron'] },
  // Sandboxed preloads must be a single CommonJS file that only requires electron.
  { ...common, entryPoints: [at('app/src/preload.ts')], outfile: at('app/dist/preload.cjs'), format: 'cjs', external: ['electron'] },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
