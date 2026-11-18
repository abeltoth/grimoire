import { describe, expect, it, vi } from 'vitest';
import { IssueProposals } from './proposals';

const draft = { summary: 'Context meter', description: '', project: 'GRIM', issueType: 'Task' };

describe('IssueProposals', () => {
  it('keeps one proposal per chat until it is put away, telling every window', () => {
    const emit = vi.fn();
    const proposals = new IssueProposals(emit);
    proposals.propose('chat-1', draft);
    proposals.propose('chat-1', { ...draft, summary: 'Usage page' });
    expect(proposals.all()).toEqual({ 'chat-1': { ...draft, summary: 'Usage page' } });

    proposals.dismiss('chat-1');
    proposals.dismiss('chat-1');
    expect(proposals.all()).toEqual({});
    expect(emit.mock.calls).toEqual([
      ['kanban.proposed', { chatId: 'chat-1', draft }],
      ['kanban.proposed', { chatId: 'chat-1', draft: { ...draft, summary: 'Usage page' } }],
      ['kanban.proposed', { chatId: 'chat-1', draft: null }],
    ]);
  });
});
