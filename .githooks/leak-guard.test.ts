import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashOf, leaksIn, parseDiff, proMarks } from './leak-guard.mjs';

// The fake secrets are built in pieces, so this file carries none.
const ANTHROPIC = 'sk-ant-' + 'api03-' + 'x'.repeat(40);
const GITHUB = 'ghp' + '_' + 'A'.repeat(36);
const AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const PRIVATE_KEY = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----';

const noText = () => '';
const change = (file: string, ...added: string[]) => ({ file, added });
const noMarks = { modules: [], folders: [], hashes: new Set<string>() };

describe('parseDiff', () => {
  it('lists each added or changed file with its added lines, and skips deleted ones', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1,2 @@',
      '-old',
      '+new',
      '+more',
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '-all',
      'diff --git a/cert.p12 b/cert.p12',
      'Binary files /dev/null and b/cert.p12 differ',
    ].join('\n');
    expect(parseDiff(diff)).toEqual([change('a.ts', 'new', 'more'), change('cert.p12')]);
  });
});

describe('leaksIn', () => {
  it('finds secrets in added lines', () => {
    const found = leaksIn(
      [change('a.ts', `const key = '${ANTHROPIC}';`), change('b.md', GITHUB, AWS, PRIVATE_KEY)],
      null,
      noText,
    );
    expect(found).toEqual([
      'a.ts: an Anthropic key',
      'b.md: a private key',
      'b.md: a GitHub token',
      'b.md: an AWS key',
    ]);
  });

  it('finds files that hold secrets by their names', () => {
    const files = ['.env', 'service/.env.local', 'keys/id_rsa', 'cert.pem', 'signing.p12'];
    expect(
      leaksIn(
        files.map((file) => change(file)),
        null,
        noText,
      ),
    ).toHaveLength(files.length);
  });

  it('lets ordinary code through, its secret-shaped words too', () => {
    const lines = ['const env = process.env;', "const prefix = 'sk-';", 'mask(key) // AKIA...'];
    expect(leaksIn([change('a.ts', ...lines), change('env.ts')], noMarks, noText)).toEqual([]);
  });

  it('finds the private repo’s folders, tokens and file copies, only when marks are given', () => {
    const copy = 'a design note '.repeat(20);
    const marks = {
      modules: ['secretive'],
      folders: ['modules/secretive', 'design/notes'],
      hashes: new Set([hashOf(copy)]),
    };
    const changes = [
      change('modules/secretive/ui/x.ts'),
      change('design/notes/a.md'),
      change('ui/src/theme.css', '  --gr-secretive-gap: 4px;'),
      change('docs/copied.md'),
      change('design/prompts.md'),
      change('modules/settings/ui/x.ts'),
    ];
    const textOf = (file: string) =>
      file === 'docs/copied.md' ? copy.replaceAll('\n', '\r\n') : '';
    expect(leaksIn(changes, marks, textOf)).toEqual([
      'modules/secretive/ui/x.ts: modules/secretive belongs to the private repo',
      'design/notes/a.md: design/notes belongs to the private repo',
      "ui/src/theme.css: the pro module secretive's tokens",
      'docs/copied.md: a copy of a file in the private repo',
    ]);
    expect(leaksIn(changes, null, textOf)).toEqual([]);
  });
});

describe('proMarks', () => {
  let root = '';
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads the private repo’s modules, design folders and files', () => {
    root = mkdtempSync(path.join(tmpdir(), 'leak-guard-'));
    const long = 'x'.repeat(300);
    const write = (file: string, text: string) => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    };
    write('modules/secretive/ui/a.ts', long);
    write('modules/secretive/contract.ts', 'short');
    write('design/notes/b.md', long + 'y');
    write('design/c.md', long + 'z');
    write('extra-modules/ui.ts', long + 'w');
    const marks = proMarks(root);
    expect(marks.modules).toEqual(['secretive']);
    expect([...marks.folders].sort()).toEqual(['design/c.md', 'design/notes', 'modules/secretive']);
    expect(marks.hashes).toEqual(new Set([long, long + 'y', long + 'z'].map(hashOf)));
  });
});
