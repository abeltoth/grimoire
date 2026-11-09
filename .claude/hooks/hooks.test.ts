import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCommit } from './check-before-commit.mjs';
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
