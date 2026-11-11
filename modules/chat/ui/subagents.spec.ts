import { TestBed } from '@angular/core/testing';
import type { Block, Entry, SubagentRun, ToolBlock } from '@grimoire/contract';
import { fakeBridge, render, write } from '@ui/testing/app-testing';
import { Subagents } from './subagents';

const call: ToolBlock = { kind: 'tool', id: 't1', tool: 'Agent', input: { description: 'Find' } };
const reply = (id: string, blocks: Block[]): Entry => ({ kind: 'agent', id, blocks });

/** The app with a chat whose tool call `call` started a subagent, whose run is read as `run` says. */
async function withSubagent(run: () => Promise<SubagentRun>) {
  const fake = fakeBridge();
  fake.answers['agents.subagent'] = run;
  const rendered = await render(fake.bridge);
  await write(rendered.fixture, rendered.el, 'Find the meter');
  fake.emit('agents.entry', { chatId: 'chat-1', entry: reply('a1', [call]) });
  await rendered.fixture.whenStable();
  return { ...fake, ...rendered, subagents: TestBed.inject(Subagents) };
}

describe('Subagents', () => {
  it('reads what a subagent did, adding what came while it was read, and what the agent said of it', async () => {
    let answer!: (run: SubagentRun) => void;
    const { fixture, emit, subagents } = await withSubagent(
      () => new Promise((resolve) => (answer = resolve)),
    );
    subagents.show('chat-1', call);
    expect(subagents.loading()).toBe(true);

    emit('agents.subagentEntry', { chatId: 'chat-1', toolId: 't1', entry: reply('h2', []) });
    emit('agents.subagentEntry', { chatId: 'chat-1', toolId: 'other', entry: reply('x', []) });
    emit('agents.subagentState', { chatId: 'chat-1', toolId: 't1', state: 'done' });
    answer({ entries: [reply('h1', [])], state: 'working' });
    await fixture.whenStable();

    expect(subagents.loading()).toBe(false);
    expect(subagents.entries().map((entry) => entry.id)).toEqual(['h1', 'h2']);
    // What the agent said as it was read is newer than what was read.
    expect(subagents.state()).toBe('done');
    expect(subagents.running()).toBe(false);
  });

  it('tells where it is from its tool call until the agent says', async () => {
    const { fixture, emit, subagents } = await withSubagent(async () => ({ entries: [] }));
    subagents.show('chat-1', call);
    await fixture.whenStable();
    expect(subagents.state()).toBe('working');

    const done = { ...call, result: { text: 'Found it.', isError: false } };
    emit('agents.entry', { chatId: 'chat-1', entry: reply('a1', [done]) });
    await fixture.whenStable();
    expect(subagents.block()).toEqual(done);
    expect(subagents.state()).toBe('done');
  });

  it('waits on your OK while one of its tool calls is up for approval in its chat', async () => {
    const { fixture, emit, subagents } = await withSubagent(async () => ({
      entries: [reply('h1', [{ kind: 'tool', id: 'ht1', tool: 'Bash', input: {} }])],
      state: 'working',
    }));
    subagents.show('chat-1', call);
    await fixture.whenStable();
    expect(subagents.waiting()).toBe(false);

    emit('agents.approval', {
      approval: { id: 'ht1', chatId: 'chat-1', tool: 'Bash', input: { command: 'ls' } },
    });
    await fixture.whenStable();
    expect(subagents.waiting()).toBe(true);
  });

  it('reads a run again when it ended with none of its work come as it went', async () => {
    let reads = 0;
    const { fixture, emit, subagents } = await withSubagent(async () => {
      reads++;
      return { entries: reads === 1 ? [] : [reply('h1', [])] };
    });
    subagents.show('chat-1', call);
    await fixture.whenStable();
    emit('agents.subagentState', { chatId: 'chat-1', toolId: 't1', state: 'done' });
    await fixture.whenStable();
    expect(reads).toBe(2);
    expect(subagents.entries().map((entry) => entry.id)).toEqual(['h1']);
    expect(subagents.state()).toBe('done');
  });
});
