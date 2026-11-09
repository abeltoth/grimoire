import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CARD_COLUMNS, type Card, type CardColumn } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '@grimoire/service/registry';
import { setActiveProfile } from '@grimoire/service/storage/app-state';
import { migrate, openDatabase } from '@grimoire/service/storage/database';
import { MIGRATIONS } from './migrations';
import { registerKanban } from './commands';
import { CardStore } from './store';

/** Grimoire's database with the board's tables. */
function openBoard(file: string) {
  const db = openDatabase(file);
  migrate(db, 'kanban', MIGRATIONS);
  return db;
}

let now: number;
let db: ReturnType<typeof openBoard>;
let cards: CardStore;

beforeEach(() => {
  now = 1_000;
  db = openBoard(':memory:');
  cards = new CardStore(db, undefined, () => now);
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const add = (title: string, cwd = '/git/grimoire') => cards.save({ title, notes: '', cwd }).at(-1)!;
/** Each column's titles, in order, on the board. */
const board = (all: Card[] = cards.list()) =>
  Object.fromEntries(
    CARD_COLUMNS.map((column) => [
      column,
      all.filter((card) => card.column === column && !card.closedAt).map((card) => card.title),
    ]),
  ) as Record<CardColumn, string[]>;

describe('Kanban cards', () => {
  it('adds a card at the foot of To do, tidied, and changes it in its place', () => {
    const first = cards.save({
      title: ' Add dark theme tokens ',
      notes: ' The night theme first. \n',
      cwd: '/git/grimoire',
    })[0]!;
    expect(first).toEqual({
      id: first.id,
      kind: 'task',
      title: 'Add dark theme tokens',
      notes: 'The night theme first.',
      cwd: '/git/grimoire',
      column: 'todo',
      createdAt: 1_000,
      chats: [],
    });
    add('Write ribbon tests');
    cards.save({ id: first.id, title: 'Add night theme tokens', notes: '', cwd: '/git/breeder' });
    expect(board().todo).toEqual(['Add night theme tokens', 'Write ribbon tests']);
    expect(cards.list()[0]).toMatchObject({ notes: '', cwd: '/git/breeder' });
  });

  it('turns away a card without a title or a folder, or one that isn’t there', () => {
    expect(() => cards.save({ title: ' ', notes: '', cwd: '/git' })).toThrow(
      'A card needs a title',
    );
    expect(() => cards.save({ title: 'Tests', notes: '', cwd: '' })).toThrow(
      'A card needs a folder',
    );
    expect(() => cards.save({ id: 'gone', title: 'Tests', notes: '', cwd: '/git' })).toThrow(
      'There is no such card',
    );
    expect(() => cards.move('gone', 'done')).toThrow('There is no such card');
  });

  it('moves a card into a column, before another or to its foot, keeping the order', () => {
    const a = add('A');
    const b = add('B');
    const c = add('C');
    cards.move(c.id, 'todo', a.id);
    expect(board().todo).toEqual(['C', 'A', 'B']);
    cards.move(a.id, 'doing');
    cards.move(b.id, 'doing', a.id);
    cards.move(c.id, 'doing', 'gone');
    expect(board()).toEqual({ todo: [], doing: ['B', 'A', 'C'], done: [] });
    cards.move(a.id, 'done');
    expect(board()).toEqual({ todo: [], doing: ['B', 'C'], done: ['A'] });
    expect(() => cards.move(a.id, 'later' as 'done')).toThrow('There\'s no column "later"');
  });

  it('closes a card, keeping it, and puts it back at the foot of its column', () => {
    const a = add('A');
    add('B');
    now = 2_000;
    cards.close(a.id, true);
    expect(board().todo).toEqual(['B']);
    expect(cards.list().find((card) => card.id === a.id)).toMatchObject({
      closedAt: 2_000,
      column: 'todo',
    });
    now = 3_000;
    cards.close(a.id, true);
    expect(cards.list().find((card) => card.id === a.id)!.closedAt).toBe(2_000);
    cards.close(a.id, false);
    expect(board().todo).toEqual(['B', 'A']);
    expect(cards.list().find((card) => card.id === a.id)).not.toHaveProperty('closedAt');
  });

  it('notes the chats a card began, and puts a card still to do in progress', () => {
    const a = add('A');
    const b = add('B');
    cards.move(b.id, 'done');
    cards.link(a.id, { chatId: 'chat-1', agent: 'claude-code', cwd: '/git/grimoire' });
    now = 2_000;
    cards.link(a.id, {
      chatId: 'chat-2',
      agent: 'claude-code',
      cwd: '/git/grimoire/.claude/worktrees/a',
    });
    cards.link(a.id, { chatId: 'chat-1', agent: 'claude-code', cwd: '/git/grimoire' });
    // Only you put a card in Done; one there stays.
    cards.link(b.id, { chatId: 'chat-3', agent: 'claude-code', cwd: '/git/grimoire' });
    expect(board()).toEqual({ todo: [], doing: ['A'], done: ['B'] });
    expect(cards.list()[0]!.chats).toEqual([
      { chatId: 'chat-1', agent: 'claude-code', cwd: '/git/grimoire', at: 1_000 },
      {
        chatId: 'chat-2',
        agent: 'claude-code',
        cwd: '/git/grimoire/.claude/worktrees/a',
        at: 2_000,
      },
    ]);
  });

  it('notes the chat a card an agent added was made in, apart from the chats it began, and keeps it', () => {
    const madeIn = { chatId: 'chat-1', agent: 'claude-code', cwd: '/git/grimoire' };
    const a = cards
      .save({ title: 'Context meter', notes: '', cwd: '/git/breeder' }, madeIn)
      .at(-1)!;
    expect(a).toMatchObject({ column: 'todo', cwd: '/git/breeder', chats: [], madeIn });
    cards.save({
      id: a.id,
      title: 'Context meter',
      notes: 'From the usage events.',
      cwd: '/git/breeder',
    });
    cards.link(a.id, { chatId: 'chat-2', agent: 'claude-code', cwd: '/git/breeder' });
    const card = cards.list()[0]!;
    expect(card.madeIn).toEqual(madeIn);
    expect(card.chats.map((chat) => chat.chatId)).toEqual(['chat-2']);
    add('Mine');
    expect(cards.list().find((c) => c.title === 'Mine')).not.toHaveProperty('madeIn');
  });

  it('keeps each profile’s board apart', () => {
    const a = add('Personal');
    setActiveProfile(db, 'work');
    expect(cards.list()).toEqual([]);
    add('Work');
    expect(() => cards.move(a.id, 'done')).toThrow('There is no such card');
    expect(board().todo).toEqual(['Work']);
    setActiveProfile(db, 'personal');
    expect(board().todo).toEqual(['Personal']);
  });

  it("deletes a profile's cards and the chats they began, and no other's", () => {
    const a = add('Personal');
    cards.link(a.id, { chatId: 'chat-1', agent: 'codex', cwd: '/git/grimoire' });
    setActiveProfile(db, 'work');
    add('Work');
    cards.removeProfile('personal');
    expect(board().todo).toEqual(['Work']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM card_chats').get()).toEqual({ n: 0 });
  });

  it('keeps the cards, their order and chats across restarts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'grimoire.db');
    const firstDb = openBoard(file);
    const first = new CardStore(firstDb);
    first.save({ title: 'A', notes: '', cwd: '/git' });
    const b = first.save({ title: 'B', notes: 'Why', cwd: '/git' }).at(-1)!;
    first.move(b.id, 'todo', first.list()[0]!.id);
    first.link(b.id, { chatId: 'chat-1', agent: 'claude-code', cwd: '/git' });
    const before = first.list();
    firstDb.close();

    const againDb = openBoard(file);
    const again = new CardStore(againDb);
    expect(again.list()).toEqual(before);
    expect(board(again.list())).toEqual({ todo: ['A'], doing: ['B'], done: [] });
    againDb.close();
  });

  it('tells every window of each change, but not of a listing', async () => {
    const registry = new CommandRegistry();
    const emit = vi.fn();
    registerKanban(registry, cards, emit);
    const [card] = (await registry.dispatch('kanban.save', {
      title: 'A',
      notes: '',
      cwd: '/git',
    })) as Card[];
    await registry.dispatch('kanban.move', { id: card!.id, column: 'done' });
    await registry.dispatch('kanban.close', { id: card!.id, closed: true });
    const linked = (await registry.dispatch('kanban.link', {
      id: card!.id,
      chatId: 'chat-1',
      agent: 'claude-code',
      cwd: '/git',
    })) as Card[];
    await registry.dispatch('kanban.list', {});
    expect(emit.mock.calls.map(([event]) => event)).toEqual(Array(4).fill('kanban.changed'));
    expect(emit.mock.calls.at(-1)![1]).toEqual({ cards: linked });
    expect(linked[0]!.chats.map((chat) => chat.chatId)).toEqual(['chat-1']);
  });
});
