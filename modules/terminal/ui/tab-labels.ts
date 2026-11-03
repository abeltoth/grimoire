import type { TerminalInfo } from '@grimoire/contract';

/** The folder's own name: the last part of its path; ~ for your home folder. */
export function folderOf(cwd: string, home = ''): string {
  const trim = (path: string) => path.replace(/[\\/]+$/, '');
  if (home && trim(cwd).toLowerCase() === trim(home).toLowerCase()) return '~';
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? cwd;
}

/** Lower-case roman numerals, as volumes are numbered: ii, iii, iv… */
export function roman(n: number): string {
  const numerals: Array<[number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let rest = Math.floor(n);
  let out = '';
  for (const [value, numeral] of numerals) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}

/** Each terminal's tab: its folder's name, numbered ii, iii… after the first in the same folder. */
export function tabLabels(terminals: readonly TerminalInfo[], home = ''): string[] {
  const seen = new Map<string, number>();
  return terminals.map(({ cwd }) => {
    const name = folderOf(cwd, home);
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} ${roman(count)}`;
  });
}
