import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Git } from './git';
import { History, parseLog, parseNameStatus, parseNumstat } from './history';

let repo: string;
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
const write = (file: string, text: string) => writeFileSync(path.join(repo, file), text);
const commit = (message: string) => {
  git('add', '-A');
  git('commit', '--quiet', '-m', message);
  return git('rev-parse', 'HEAD').trim();
};

beforeEach(() => {
  repo = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'grimoire-history-')));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'core.autocrlf', 'false');
  write('a.txt', 'one\ntwo\nthree\n');
  commit('First');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('History', () => {
  it("gives a branch's history a page at a time, its own commits marked", async () => {
    git('switch', '--quiet', '-c', 'feature');
    write('b.txt', 'bee\n');
    const second = commit('Second');
    write('b.txt', 'bee\nbuzz\n');
    const third = commit('Third');
    const history = new History(new Git());

    const first = await history.log(repo, 'feature', 0, 2);
    expect(first?.more).toBe(true);
    expect(first?.commits.map((c) => [c.subject, c.own, c.author])).toEqual([
      ['Third', true, 'Test'],
      ['Second', true, 'Test'],
    ]);
    expect(first?.commits[0]).toMatchObject({ sha: third, parents: [second] });
    expect(first?.commits[0]?.short).toMatch(/^[0-9a-f]{7,}$/);

    const older = await history.log(repo, 'feature', 2, 2);
    expect(older).toMatchObject({ more: false, commits: [{ subject: 'First', parents: [] }] });
    expect(older?.commits[0]?.own).toBeUndefined();
    expect((await history.log(repo, 'main', 0, 50))?.commits.map((c) => c.own)).toEqual([
      undefined,
    ]);
  });

  it("refuses a ref it hasn't got, or one that reads as an option", async () => {
    const history = new History(new Git());
    expect(await history.log(repo, 'nowhere', 0, 10)).toBeNull();
    expect(await history.log(repo, '--all', 0, 10)).toBeNull();
    expect(await history.commit(repo, '-p')).toBeNull();
    expect(await history.commitDiff(repo, '--root', 'a.txt')).toEqual([]);
  });

  it('gives a commit with its message, files and line counts, the first against nothing', async () => {
    const root = await new History(new Git()).commit(repo, 'HEAD');
    expect(root).toMatchObject({
      subject: 'First',
      body: '',
      files: [{ path: 'a.txt', kind: 'new', added: 3, removed: 0 }],
    });

    git('mv', 'a.txt', 'moved.txt');
    write('moved.txt', 'one\n2\nthree\n');
    write('c.bin', 'a\0b');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'Move it', '-m', 'Because.\n\nReally.');
    const detail = await new History(new Git()).commit(repo, 'HEAD');
    expect(detail?.subject).toBe('Move it');
    expect(detail?.body).toBe('Because.\n\nReally.');
    expect(detail?.files).toEqual(
      expect.arrayContaining([
        { path: 'moved.txt', kind: 'renamed', from: 'a.txt', added: 1, removed: 1 },
        { path: 'c.bin', kind: 'new', added: null, removed: null },
      ]),
    );
  });

  it("gives a file's change in a commit, a renamed one against where it was", async () => {
    git('mv', 'a.txt', 'moved.txt');
    write('moved.txt', 'one\n2\nthree\n');
    const sha = commit('Move it');
    const history = new History(new Git());
    expect(await history.commitDiff(repo, sha, 'moved.txt', 'a.txt')).toEqual([
      { kind: 'same', text: 'one' },
      { kind: 'removed', text: 'two' },
      { kind: 'inserted', text: '2' },
      { kind: 'same', text: 'three' },
    ]);
    expect(await history.commitDiff(repo, sha, '../outside.txt')).toEqual([]);
  });

  it('names the chat that made a commit', async () => {
    const sha = git('rev-parse', 'HEAD').trim();
    const chat = { id: 'c1', agent: 'claude-code', title: 'Start', cwd: repo };
    const history = new History(new Git(), (shas) => new Map(shas.map((s) => [s, chat])));
    expect((await history.log(repo, 'HEAD', 0, 10))?.commits[0]?.chat).toEqual(chat);
    expect((await history.commit(repo, sha))?.chat).toEqual(chat);
  });
});

describe('parsers', () => {
  it('reads a log, a subject keeping its spaces', () => {
    const out =
      'abc\x1fab\x1fp1 p2\x1fMe\x1f1700000000\x1fA  subject\0\nxyz\x1fxy\x1f\x1fYou\x1f1\x1fRoot\0';
    expect(parseLog(out)).toEqual([
      {
        sha: 'abc',
        short: 'ab',
        parents: ['p1', 'p2'],
        author: 'Me',
        at: 1_700_000_000_000,
        subject: 'A  subject',
      },
      { sha: 'xyz', short: 'xy', parents: [], author: 'You', at: 1000, subject: 'Root' },
    ]);
  });

  it('reads names and counts, renames and files that are not text', () => {
    expect(parseNameStatus('M\0a.txt\0R087\0old.txt\0new.txt\0D\0gone.txt\0T\0link\0')).toEqual([
      { path: 'a.txt', kind: 'modified' },
      { path: 'new.txt', kind: 'renamed', from: 'old.txt' },
      { path: 'gone.txt', kind: 'deleted' },
      { path: 'link', kind: 'modified' },
    ]);
    expect([...parseNumstat('1\t2\ta.txt\x001\t1\t\0old.txt\0new.txt\0-\t-\tpic.png\0')]).toEqual([
      ['a.txt', { added: 1, removed: 2 }],
      ['new.txt', { added: 1, removed: 1 }],
      ['pic.png', { added: null, removed: null }],
    ]);
  });
});
