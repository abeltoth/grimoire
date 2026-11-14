import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitFolder, isCommit } from './check-before-commit.mjs';
import { isFormatted } from './format-file.mjs';

describe('isCommit', () => {
  it('sees git commit, alone, after other commands, or after git options', () => {
    expect(isCommit('git commit -m "Hub: split"')).toBe(true);
    expect(isCommit('git add a.ts && git commit -q -m x && git push')).toBe(true);
    expect(isCommit('cd repo; git -C service commit --amend')).toBe(true);
    expect(isCommit('git --no-pager -c user.name=x commit')).toBe(true);
  });

  it('lets other git commands through', () => {
    expect(isCommit('git status --short')).toBe(false);
    expect(isCommit('git log --oneline -5')).toBe(false);
    expect(isCommit('git show HEAD:commit.txt')).toBe(false);
    expect(isCommit('npm run commitlint')).toBe(false);
  });
});

describe('commitFolder', () => {
  const cwd = path.resolve('/repo');
  it('follows the cd before the commit and the commit’s git -C', () => {
    expect(commitFolder('git commit -m x', cwd)).toBe(cwd);
    expect(commitFolder('cd ../other && git add a && git commit -m x', cwd)).toBe(
      path.resolve('/other'),
    );
    expect(commitFolder('git -C service commit', cwd)).toBe(path.join(cwd, 'service'));
    expect(commitFolder('cd a; git -c user.name=x -C b commit', cwd)).toBe(path.join(cwd, 'a/b'));
    expect(commitFolder('cd "my dir" && git commit', cwd)).toBe(path.join(cwd, 'my dir'));
  });

  it('is null without a commit', () => {
    expect(commitFolder('cd ../other && git status', cwd)).toBeNull();
  });

  it.runIf(process.platform === 'win32')('reads a Git Bash drive as Windows does', () => {
    expect(commitFolder('cd /c/work/repo && git commit', path.resolve('D:/x'))).toBe(
      path.resolve('C:/work/repo'),
    );
  });
});

describe('isFormatted', () => {
  const root = path.resolve('/repo');
  it('formats only what npm run format covers', () => {
    expect(isFormatted(root, path.join(root, 'modules/chat/ui/rows.ts'))).toBe(true);
    expect(isFormatted(root, path.join(root, 'ui/src/main.ts'))).toBe(true);
    expect(isFormatted(root, path.join(root, 'ui/tools/style-guard.ts'))).toBe(false);
    expect(isFormatted(root, path.join(root, 'ADR.md'))).toBe(false);
    expect(isFormatted(root, path.join(root, 'servicex/a.ts'))).toBe(false);
    expect(isFormatted(path.resolve('/other'), path.join(root, 'service/src/main.ts'))).toBe(false);
  });
});
