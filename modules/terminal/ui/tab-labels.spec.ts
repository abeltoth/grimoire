import type { TerminalInfo } from '@grimoire/contract';
import { folderOf, roman, tabLabels } from './tab-labels';

const at = (cwd: string): TerminalInfo => ({ id: cwd + Math.random(), cwd, shell: 'zsh', openedAt: 0 });

describe('folderOf', () => {
  it("names the folder by its path's last part, on any system", () => {
    expect(folderOf('/Users/abel/git/grimoire')).toBe('grimoire');
    expect(folderOf('C:\\Users\\Abel\\Git\\grimoire\\')).toBe('grimoire');
    expect(folderOf('/')).toBe('/');
  });

  it('calls your home folder ~', () => {
    expect(folderOf('C:\\Users\\Abel', 'c:\\users\\abel\\')).toBe('~');
    expect(folderOf('/Users/abel/git', '/Users/abel')).toBe('git');
  });
});

describe('roman', () => {
  it('numbers as volumes are numbered', () => {
    expect([1, 2, 3, 4, 9, 14, 40].map(roman)).toEqual(['i', 'ii', 'iii', 'iv', 'ix', 'xiv', 'xl']);
  });
});

describe('tabLabels', () => {
  it('numbers the tabs after the first in the same folder', () => {
    const terminals = [at('/git/grimoire'), at('/git/breeder'), at('/git/grimoire'), at('/git/grimoire')];
    expect(tabLabels(terminals)).toEqual(['grimoire', 'breeder', 'grimoire ii', 'grimoire iii']);
  });
});
