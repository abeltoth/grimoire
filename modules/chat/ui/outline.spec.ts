import { fakeBridge, render, write } from '@ui/testing/app-harness';

describe('outline', () => {
  it('keeps the chapter\'s plan in the Outline, and its tools out of the margin', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    expect(texts('gr-outline .none')).toEqual([
      'No plan yet. Claude Code writes one here when a task takes several steps.',
    ]);
    await write(fixture, el, 'Add a context meter');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          { kind: 'tool', id: 't1', tool: 'TaskCreate', input: { subject: 'Read the composer' } },
          { kind: 'tool', id: 't2', tool: 'Read', input: { file_path: 'C:/work/grimoire/a.ts' } },
        ],
      },
    });
    emit('agents.plan', {
      chatId: 'chat-1',
      plan: [
        { text: 'Read the composer', status: 'done' },
        { text: 'Fill in the meter', status: 'active', activeText: 'Filling in the meter' },
        { text: 'Run the tests', status: 'pending' },
      ],
    });
    emit('agents.status', { chatId: 'chat-1', status: 'writing' });
    await fixture.whenStable();

    expect(texts('gr-outline li > *')).toEqual([
      'i.', 'Read the composer', 'done',
      'ii.', 'Fill in the meter', 'writing',
      'iii.', 'Run the tests', 'to do',
    ]);
    expect(texts('gr-outline li.now .text')).toEqual(['Fill in the meter']);
    expect(texts('gr-facing-page gr-running-foot')).toEqual(['1 of 3 done']);
    expect(texts('.note .note-head')).toEqual(['Read']);
  });
});
