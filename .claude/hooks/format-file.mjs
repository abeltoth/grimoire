// A PostToolUse hook on Edit and Write: formats the file Claude just changed with Prettier, when
// `npm run format` covers it, so nobody keeps the formatting by hand.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folders `npm run format` covers, relative to the repository. */
export const FORMATTED = ['contract', 'service', 'app', 'ui/src', 'modules', 'scripts'];

/** Whether a file lies in a folder `npm run format` covers. */
export function isFormatted(root, file) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  return FORMATTED.some((folder) => relative.startsWith(`${folder}/`));
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { tool_input: tool = {}, cwd } = JSON.parse(input);
  const root = process.env.CLAUDE_PROJECT_DIR ?? cwd;
  const file = tool.file_path;
  if (!file || !isFormatted(root, file)) return 0;
  const prettier = await import('prettier');
  const ignorePath = ['.gitignore', '.prettierignore'].map((name) => path.join(root, name));
  const info = await prettier.getFileInfo(file, { ignorePath });
  if (info.ignored || !info.inferredParser) return 0;
  const text = await readFile(file, 'utf8');
  const options = await prettier.resolveConfig(file);
  const formatted = await prettier.format(text, { ...options, filepath: file });
  if (formatted !== text) await writeFile(file, formatted);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main().catch((error) => {
    process.stderr.write(`Prettier couldn't format the file: ${error}\n`);
    return 1;
  });
}
