// A PreToolUse hook on Bash: runs `npm run check` before Claude commits, and exits 2 to refuse the
// commit when it fails, so a broken check never reaches the history.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Whether a shell command runs `git commit`, with or without git's own options before it. */
export function isCommit(command) {
  return /(^|[\s;&|(])git(\s+-[Cc]\s+\S+|\s+--?[\w-]+(=\S+)?)*\s+commit\b/.test(command);
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { tool_input: tool = {}, cwd } = JSON.parse(input);
  if (!isCommit(tool.command ?? '')) return 0;
  const check = spawnSync('npm run check', {
    cwd: process.env.CLAUDE_PROJECT_DIR ?? cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (check.status === 0) return 0;
  const output = `${check.stdout ?? ''}${check.stderr ?? ''}${check.error?.message ?? ''}`;
  const tail = output.trim().split(/\r?\n/).slice(-80).join('\n');
  process.stderr.write(
    `npm run check failed, so the commit was refused. Fix it, then commit.\n\n${tail}\n`,
  );
  return 2;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main().catch((error) => {
    process.stderr.write(`The commit check couldn't run: ${error}\n`);
    return 2;
  });
}
