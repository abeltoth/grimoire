import { TestBed } from '@angular/core/testing';
import type { Card } from '@grimoire/contract';
import { render, write } from '@ui/testing/app-testing';
import { Board, promptOf } from './board';
import { TRANSITIONS, card, issue, withBoard } from './kanban-testing';

/** The board on the app, its cards kept by the fake service. */
async function onBoard(...cards: Card[]) {
  const fake = withBoard(cards);
  const rendered = await render(fake.bridge);
  const board = TestBed.inject(Board);
  await board.load();
  return { ...fake, ...rendered, board };
}

const titles = (board: Board) => board.open().map((c) => `${c.column} ${c.title}`);

describe('promptOf', () => {
  it('begins a card’s chat with its title, after its issue’s key, and its notes under it', () => {
    expect(promptOf({ title: 'Meter', notes: '' })).toBe('Meter');
    expect(promptOf({ title: 'Meter', notes: 'From usage.' })).toBe('Meter\n\nFrom usage.');
    const jira = issue('j', 'GRIM-1', 'Meter', 'todo');
    expect(promptOf({ ...jira, notes: 'Notes' })).toBe('GRIM-1: Meter\n\nNotes');
  });
});

describe('Board', () => {
  it('mirrors the service’s cards, the closed ones off the board', async () => {
    const { board, emit } = await onBoard(card('a', 'A', 'todo'), card('b', 'B', 'done'));
    expect(titles(board)).toEqual(['todo A', 'done B']);
    emit('kanban.changed', { cards: [card('b', 'B', 'done', { closedAt: 1 })] });
    expect(board.all()).toHaveLength(1);
    expect(board.open()).toEqual([]);
  });

  it('shows a Jira card being moved where it’s going, at its column’s foot, until Jira answers', async () => {
    const { board, jira } = await onBoard(
      issue('j', 'GRIM-1', 'Meter', 'todo'),
      card('a', 'A', 'doing'),
    );
    let answer!: () => void;
    jira.wait = new Promise((resolve) => (answer = resolve));
    const moved = board.transition('j', TRANSITIONS[1]!);
    expect(titles(board)).toEqual(['doing A', 'doing Meter']);
    expect(board.open()[1]!.jira!.status).toBe('In Review');
    expect(board.moving('j')).toBe(true);
    answer();
    expect(await moved).toBe(true);
    expect(board.moving('j')).toBe(false);
  });

  it('puts a Jira card back when Jira refuses, saying why on it', async () => {
    const { board, jira } = await onBoard(issue('j', 'GRIM-1', 'Meter', 'todo'));
    jira.refuse = 'Jira says no';
    expect(await board.transition('j', TRANSITIONS[2]!)).toBe(false);
    expect(titles(board)).toEqual(['todo Meter']);
    expect(board.jiraNote()).toEqual({ card: 'j', text: 'Jira says no', openInJira: true });
  });

  it('says why a change failed, until the next', async () => {
    const { board, answers } = await onBoard(card('a', 'A', 'todo'));
    answers['kanban.close'] = () => {
      throw new Error('The service is gone');
    };
    expect(await board.close('a', true)).toBe(false);
    expect(board.failed()).toBe('The service is gone');
    expect(await board.move('a', 'done')).toBe(true);
    expect(board.failed()).toBeNull();
  });

  it('knows the card the chat you’re on began from', async () => {
    const chat = { chatId: 'chat-1', agent: 'claude-code', cwd: 'C:/w', at: 0 };
    const { board, fixture, el } = await onBoard(card('a', 'A', 'doing', { chats: [chat] }));
    expect(board.current()).toBeUndefined();
    await write(fixture, el, 'Go');
    expect(board.current()?.id).toBe('a');
  });
});
