import type { ChatSummary } from '@grimoire/contract';
import {
  dated,
  keptTags,
  numeral,
  partTitle,
  partsOf,
  projectOf,
  tagsOf,
  withTags,
} from './chat-groups';

const chat = (
  id: string,
  cwd: string | undefined,
  updatedAt: number,
  more: Partial<ChatSummary> = {},
): ChatSummary => ({
  id,
  agent: 'claude-code',
  title: id,
  ...(cwd ? { cwd } : {}),
  updatedAt,
  pins: [],
  tags: [],
  ...more,
});

describe('History', () => {
  it('puts a worktree chat in its repository’s part', () => {
    expect(projectOf('C:\\Users\\me\\git\\grimoire\\.claude\\worktrees\\context-meter')).toBe(
      'C:\\Users\\me\\git\\grimoire',
    );
    expect(projectOf('/home/me/git/grimoire/.claude/worktrees/fix-login/ui')).toBe(
      '/home/me/git/grimoire',
    );
    expect(projectOf('/home/me/git/grimoire')).toBe('/home/me/git/grimoire');
  });

  it('groups chats into parts by project, newest part first, pinned chats first', () => {
    const parts = partsOf(
      [
        chat('old pinned', '/me/git/grimoire', 1, { pins: ['pin'] }),
        chat('breeder', '/me/git/breeder', 5),
        chat('worktree', '/me/git/grimoire/.claude/worktrees/x', 4),
        chat('newest', '/me/git/grimoire/', 9),
        chat('no folder', undefined, 3),
        chat('home', '/me', 2),
      ],
      '/me',
    );
    expect(parts.map((part) => [part.folder, part.chats.map((c) => c.id)])).toEqual([
      ['/me/git/grimoire/', ['old pinned', 'newest', 'worktree']],
      ['/me/git/breeder', ['breeder']],
      ['/me', ['no folder', 'home']],
    ]);
  });

  it('treats a Windows folder written either way as one', () => {
    const parts = partsOf(
      [chat('a', 'C:\\Me\\git\\grimoire', 2), chat('b', 'c:/Me/git/grimoire', 1)],
      'C:\\Me',
    );
    expect(parts).toHaveLength(1);
  });

  it('titles a part with its folder’s name', () => {
    expect(partTitle('C:\\Users\\me\\git\\Grimoire', 'C:\\Users\\me')).toBe('Grimoire');
    expect(partTitle('/home/me/git/breeder/', '/home/me')).toBe('breeder');
    expect(partTitle('/home/me', '/home/me/')).toBe('Home folder');
  });

  it('numbers the parts in Roman numerals', () => {
    expect([1, 2, 4, 9, 14, 40, 1999].map(numeral)).toEqual([
      'I',
      'II',
      'IV',
      'IX',
      'XIV',
      'XL',
      'MCMXCIX',
    ]);
  });

  it('lists every tag once, alphabetically, and narrows to chats with every picked one', () => {
    const chats = [
      chat('a', '/x', 1, { tags: ['ui', 'Bug'] }),
      chat('b', '/x', 2, { tags: ['bug'] }),
      chat('c', '/x', 3, { tags: ['UI', 'api'] }),
    ];
    expect(tagsOf(chats)).toEqual(['api', 'Bug', 'ui']);
    expect(withTags(chats, ['BUG']).map((c) => c.id)).toEqual(['a', 'b']);
    expect(withTags(chats, ['bug', 'ui']).map((c) => c.id)).toEqual(['a']);
    expect(withTags(chats, []).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps tags trimmed, without blanks, each once', () => {
    expect(keptTags([' ui ', 'bug', '', 'UI'])).toEqual(['ui', 'bug']);
  });

  it('dates a chat by the time today, the day this year, else the year too', () => {
    const now = new Date(2026, 10, 5, 18, 0).getTime();
    const today = new Date(2026, 10, 5, 9, 38).getTime();
    const thisYear = new Date(2026, 1, 3, 12, 0).getTime();
    const lastYear = new Date(2025, 11, 31, 12, 0).getTime();
    expect(dated(today, now)).toBe(
      new Date(today).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    );
    expect(dated(thisYear, now)).toBe(
      new Date(thisYear).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    );
    expect(dated(lastYear, now)).toBe(
      new Date(lastYear).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    );
  });
});
