import type { ListedChat } from './chat-groups';
import { byDate } from './date-groups';

const chat = (id: string, updatedAt: number, more: Partial<ListedChat> = {}): ListedChat => ({
  id,
  agent: 'claude-code',
  title: id,
  updatedAt,
  pins: [],
  tags: [],
  ...more,
});

const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).getTime();

describe('History by date', () => {
  it('groups chats by when they were last written in, pinned ones first, newest first', () => {
    const now = at(10, 13, 15);
    const groups = byDate(
      [
        chat('last year', new Date(2025, 11, 20).getTime()),
        chat('october', at(9, 2)),
        chat('two weeks', at(9, 30)),
        chat('this morning', at(10, 13, 8)),
        chat('yesterday late', at(10, 12, 23)),
        chat('five days', at(10, 8)),
        chat('pinned old', at(5, 1), { pins: ['pin'] }),
        chat('starred', at(10, 13, 9), { pins: ['star'] }),
        chat('just now', at(10, 13, 14)),
      ],
      now,
    );
    expect(groups.map((group) => [group.title, group.chats.map((c) => c.id)])).toEqual([
      ['Pinned', ['pinned old']],
      ['Today', ['just now', 'starred', 'this morning']],
      ['Yesterday', ['yesterday late']],
      ['Previous 7 days', ['five days']],
      ['Previous 30 days', ['two weeks']],
      [new Date(at(9, 2)).toLocaleDateString([], { month: 'long', year: 'numeric' }), ['october']],
      [
        new Date(2025, 11, 20).toLocaleDateString([], { month: 'long', year: 'numeric' }),
        ['last year'],
      ],
    ]);
  });

  it('counts days by the calendar, not by 24 hours', () => {
    const now = at(10, 13, 0);
    expect(byDate([chat('a', at(10, 12, 23))], now)[0]!.title).toBe('Yesterday');
  });

  it('leaves out the pinned group when nothing is pinned', () => {
    expect(byDate([], 0)).toEqual([]);
  });
});
