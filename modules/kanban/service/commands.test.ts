import type { Card } from '@grimoire/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '@grimoire/service/core/registry';
import { registerJira, registerKanban } from './commands';
import { fakeConnectors, openBoard } from './jira-testing';
import { JiraMoves } from './jira-moves';
import { JiraSyncer } from './jira-sync';
import { CardStore } from './store';

let cards: CardStore;

beforeEach(() => {
  cards = new CardStore(openBoard(':memory:'), undefined, () => 1_000);
});

describe('the board commands', () => {
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

describe('the Jira commands', () => {
  it('say where the sync stands, sync now, and ask Jira for a card’s transitions', async () => {
    const pages: unknown[] = [];
    const emit = vi.fn();
    const syncer = new JiraSyncer(
      cards,
      () => 'assignee = currentUser()',
      (allowed) => fakeConnectors({}, pages).open(allowed),
      emit,
      undefined,
      () => 1_000,
    );
    const registry = new CommandRegistry();
    registerJira(registry, syncer, new JiraMoves(cards, fakeConnectors({}).open, emit));
    expect(await registry.dispatch('kanban.jira', {})).toEqual({ status: 'none', syncing: false });
    pages.push({ issues: [] });
    expect(await registry.dispatch('kanban.syncJira', {})).toEqual({
      status: 'synced',
      syncedAt: 1_000,
      syncing: false,
    });
    await expect(registry.dispatch('kanban.transitions', { id: 'nope' })).rejects.toThrow();
  });
});
