import { folderOf, nameOf, shownPath } from './paths';

describe('paths', () => {
  it('names a file from the folder, or in full from your home folder', () => {
    expect(shownPath('src/a.ts', 'C:\\Users\\me')).toBe('src/a.ts');
    expect(shownPath('C:/Users/me/.claude/CLAUDE.md', 'C:\\Users\\me')).toBe('~/.claude/CLAUDE.md');
    expect(shownPath('D:/work/a.ts', 'C:\\Users\\me')).toBe('D:/work/a.ts');
  });

  it('splits a path into its folder and its name', () => {
    expect(folderOf('ui/src/a.ts')).toBe('ui/src/');
    expect(folderOf('a.ts')).toBe('');
    expect(nameOf('ui/src/a.ts')).toBe('a.ts');
  });
});
