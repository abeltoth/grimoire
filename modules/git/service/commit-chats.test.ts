import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { CommitChats } from './commit-chats';
import { Git } from './git';
import { MIGRATIONS } from './migrations';

let repo: string;
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
const commit = (message: string) => {
  writeFileSync(path.join(repo, `${message}.txt`), message);
  git('add', '-A');
  git('commit', '--quiet', '-m', message);
  return git('rev-parse', 'HEAD').trim();
};

beforeEach(() => {
  repo = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'grimoire-commit-chats-')));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

function chats(): CommitChats {
  const db = openDatabase(':memory:');
  migrate(db, 'git', MIGRATIONS);
  // Before any commit, so the turn's commits all count as made after it began.
  return new CommitChats(db, new Git(), () => 0);
}

const chat = (title: string) => ({ agent: 'claude-code', title, cwd: repo });

describe('CommitChats', () => {
  it("credits a turn's new commits to its chat, and shows its new title", async () => {
    const before = commit('before');
    const links = chats();
    await links.turnStarted('c1', repo);
    await links.turnStarted('c1', repo);
    const first = commit('first');
    const second = commit('second');
    expect(await links.turnEnded('c1', chat('Fix it'))).toBe(2);

    const found = links.chatsOf([before, first, second]);
    expect([...found.keys()].sort()).toEqual([first, second].sort());
    expect(found.get(first)).toEqual({ id: 'c1', ...chat('Fix it') });

    links.renamed('c1', 'Fixed');
    expect(links.chatsOf([first]).get(first)?.title).toBe('Fixed');
  });

  it('credits every commit of a turn that began before the first, and nothing to a turn not begun', async () => {
    const links = chats();
    await links.turnStarted('c1', repo);
    const first = commit('first');
    expect(await links.turnEnded('c1', chat('New'))).toBe(1);
    expect(links.chatsOf([first]).get(first)?.id).toBe('c1');
    commit('later');
    expect(await links.turnEnded('c2', chat('Other'))).toBe(0);
  });

  it('keeps the first chat credited with a commit', async () => {
    const links = chats();
    commit('before');
    await links.turnStarted('c1', repo);
    await links.turnStarted('c2', repo);
    const made = commit('made');
    await links.turnEnded('c1', chat('One'));
    await links.turnEnded('c2', chat('Two'));
    expect(links.chatsOf([made]).get(made)?.id).toBe('c1');
  });

  it('credits nothing outside a repository', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'grimoire-nogit-'));
    try {
      const links = chats();
      await links.turnStarted('c1', outside);
      expect(await links.turnEnded('c1', chat('None'))).toBe(0);
      expect(links.chatsOf([])).toEqual(new Map());
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
