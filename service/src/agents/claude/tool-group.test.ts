import { describe, expect, it } from 'vitest';
import { commandGroup, folderOf, groupOf, siteOf } from './tool-group';

describe('groupOf', () => {
  it('counts a command by its program, a file by its folder and an address by its site', () => {
    expect(groupOf('Bash', { command: 'git diff src/a.ts' })).toBe('git diff');
    expect(groupOf('PowerShell', { command: 'Get-ChildItem -Recurse' })).toBe('Get-ChildItem');
    expect(groupOf('Read', { file_path: 'C:\\repo\\src\\a.ts' })).toBe('C:/repo/src');
    expect(groupOf('WebFetch', { url: 'https://www.example.com/a?b=1' })).toBe('example.com');
  });

  it('has none for the other tools, or with nothing to tell', () => {
    expect(groupOf('Grep', { pattern: 'TODO' })).toBeUndefined();
    expect(groupOf('Read', {})).toBeUndefined();
    expect(groupOf('Read', null)).toBeUndefined();
    expect(groupOf('Read', { file_path: 'a.ts' })).toBeUndefined();
    expect(groupOf('WebFetch', { url: 'not an address' })).toBeUndefined();
    expect(groupOf('Bash', { command: '   ' })).toBeUndefined();
  });
});

describe('commandGroup', () => {
  it('adds the subcommand only for a program that has them, and the script to a run', () => {
    expect(commandGroup('sed -n 1,20p a.ts')).toBe('sed');
    expect(commandGroup('grep -rn "x" src | head')).toBe('grep');
    expect(commandGroup('npm test -- --run')).toBe('npm test');
    expect(commandGroup('npm run check')).toBe('npm run check');
    expect(commandGroup('npm --prefix ui run build')).toBe('npm run build');
    expect(commandGroup('git -C ../core log --oneline')).toBe('git log');
    expect(commandGroup('npx vitest run')).toBe('npx vitest');
    expect(commandGroup('git --version')).toBe('git');
    expect(commandGroup('git "$x"')).toBe('git');
  });

  it('skips moving folders, setting variables and defining functions', () => {
    expect(commandGroup('cd /repo && git status')).toBe('git status');
    expect(commandGroup('S="C:/tmp/scratch pad"; cd "$S" && python -I x.py')).toBe('python');
    expect(commandGroup('T=$(mktemp -d) && node a.mjs')).toBe('node');
    expect(commandGroup('PYTHONUTF8=1 python x.py')).toBe('python');
    expect(commandGroup('Set-Location "C:\\repo"; npm run typecheck')).toBe('npm run typecheck');
    expect(commandGroup('$f = "a.txt"\nGet-Content $f')).toBe('Get-Content');
    expect(commandGroup('show() { grep -n "$1" a; }; show x')).toBe('grep');
    expect(commandGroup('(cd app && npm test)')).toBe('npm test');
    expect(commandGroup('timeout 60 npm test')).toBe('npm test');
  });

  it("names a program run by its path without its folders or extension, and nothing that isn't one", () => {
    expect(commandGroup('& "C:\\Program Files\\nodejs\\npm.cmd" test')).toBe('npm test');
    expect(commandGroup('/usr/bin/git status')).toBe('git status');
    expect(commandGroup('"unique commits: $(git log)"')).toBeUndefined();
    expect(commandGroup(42)).toBeUndefined();
  });
});

describe('folderOf and siteOf', () => {
  it("writes one folder one way, whatever the slashes or the drive letter's case", () => {
    expect(folderOf('c:\\repo\\a.ts')).toBe('C:/repo');
    expect(folderOf('C:/repo/a.ts')).toBe('C:/repo');
    expect(folderOf('C:\\a.ts')).toBe('C:/');
    expect(folderOf('/a.ts')).toBe('/');
    expect(siteOf('http://localhost:4200/x')).toBe('localhost');
  });
});
