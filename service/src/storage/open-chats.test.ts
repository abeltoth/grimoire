import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { OpenChats } from './open-chats';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('OpenChats', () => {
  it('keeps open chats in order across restarts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'grimoire.db');

    const first = openDatabase(file);
    const chats = new OpenChats(first);
    chats.add({ chatId: 'a', agent: 'claude-code', settings: { cwd: '/one' } });
    chats.add({ chatId: 'b', agent: 'claude-code', settings: { cwd: '/two' } });
    chats.add({ chatId: 'c', agent: 'claude-code', settings: { cwd: '/three' } });
    chats.add({ chatId: 'a', agent: 'claude-code', settings: { cwd: '/one', model: 'opus' } });
    chats.remove('b');
    first.close();

    const again = openDatabase(file);
    expect(new OpenChats(again).list()).toEqual([
      { chatId: 'a', agent: 'claude-code', settings: { cwd: '/one', model: 'opus' } },
      { chatId: 'c', agent: 'claude-code', settings: { cwd: '/three' } },
    ]);
    again.close();
  });
});
