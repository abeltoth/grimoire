// npm run jira:check [-- --claude-folder <dir>] [--jql <query>]
// Checks the claude.ai Atlassian connector as the Kanban board's Jira sync
// reaches it (service/src/kanban/jira-check.ts), bundled first like the service.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'service', 'dist', 'jira-check.mjs');

await esbuild.build({
  entryPoints: [path.join(root, 'service', 'src', 'kanban', 'jira-check.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  // The Agent SDK stays in node_modules: it finds Claude Code's binary in its platform package there.
  external: ['@anthropic-ai/claude-agent-sdk'],
  logLevel: 'warning',
});
await import(pathToFileURL(outfile).href);
