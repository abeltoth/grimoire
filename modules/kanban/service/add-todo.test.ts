import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADD_TODO_PROMPT, type AddTodo, addTodoTool } from './add-todo';

const cwd = path.resolve('/git/grimoire');
const chat = { chatId: 'chat-1', agent: 'claude-code', cwd };

/** The cards the tool added, each with the chat it was added in; like a board, `add` turns away one without a title. */
let added: Parameters<AddTodo>[];
let add: AddTodo;
beforeEach(() => {
  added = [];
  add = (draft, madeIn) => {
    if (!draft.title) throw new Error('A card needs a title');
    added.push([draft, madeIn]);
  };
});

const run = (args: { title: string; notes?: string; folder?: string }, madeIn = chat) =>
  addTodoTool(add).run(args, madeIn);

describe('the add_todo tool', () => {
  it('is named add_todo', () => {
    expect(addTodoTool(add).name).toBe('add_todo');
  });

  it('tells the agent to add a card only when asked, or for a separate task to track', () => {
    expect(ADD_TODO_PROMPT).toContain('only when the user asks for a to-do');
    expect(ADD_TODO_PROMPT).toContain('clearly separate task comes up that should be tracked');
    expect(addTodoTool(add).prompt).toBe(ADD_TODO_PROMPT);
    expect(addTodoTool(add).description).toContain('Use it only when the user asks for a to-do');
  });

  it('adds a card in the chat’s folder, tidied, made in the chat, and says so', () => {
    expect(run({ title: ' Context meter ', notes: ' From the usage events.\n' })).toBe(
      'Added "Context meter" to To do on the user\'s Kanban board.',
    );
    expect(added).toEqual([
      [{ title: 'Context meter', notes: 'From the usage events.', cwd }, chat],
    ]);
  });

  it('puts the card in the folder named, one not absolute taken from the chat’s', async () => {
    const elsewhere = path.resolve('/git/breeder');
    await run({ title: 'A', folder: elsewhere });
    await run({ title: 'B', folder: '../breeder' });
    await run({ title: 'C', folder: '  ' });
    expect(added.map(([draft]) => draft.cwd)).toEqual([elsewhere, elsewhere, cwd]);
  });

  it('throws when the card was turned away, or its chat isn’t known yet', () => {
    expect(() => run({ title: '  ' })).toThrow('A card needs a title');
    expect(() => addTodoTool(add).run({ title: 'Context meter' }, undefined)).toThrow(
      'There is no chat to add the task in yet.',
    );
    expect(added).toEqual([]);
  });
});
