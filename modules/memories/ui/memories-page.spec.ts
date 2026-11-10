import type { AgentMemories, CommandRequest, Memory, SetupFile } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('memories-page', () => {
  it('reads the Memories page again when the memories of its folder change, and the open one unless changed', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    const folder = 'C:/Users/me/.claude/projects/C--Users-me/memory';
    const memory = (name: string): Memory => ({
      name,
      path: `${folder}/${name}.md`,
      type: 'feedback',
      changedAt: 100,
      links: [],
      indexed: true,
    });
    let memories = [memory('tone')];
    let text = 'Short answers.';
    answers['memories.list'] = (): AgentMemories => ({
      cwd: 'C:/Users/me',
      folder,
      index: { path: `${folder}/MEMORY.md`, exists: true },
      enabled: true,
      memories,
      problems: [],
      elsewhere: [],
      at: Date.now(),
    });
    answers['memories.open'] = (request: CommandRequest<'memories.open'>): SetupFile => ({
      path: request.path,
      text,
      exists: true,
      changedAt: 100,
      editable: true,
    });
    const { fixture, el } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    const names = () =>
      [...el.querySelectorAll('gr-memories-page .card .name')].map((n) => n.textContent!.trim());
    const reads = () => calls.filter((c) => c.command === 'memories.list').length;
    expect(names()).toEqual(['tone']);

    // Another folder's memories changing reads nothing.
    emit('memories.changed', { agent: 'claude-code', cwd: 'D:/elsewhere' });
    await settle();
    expect(reads()).toBe(1);

    memories = [memory('tone'), memory('commits')];
    emit('memories.changed', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(names()).toEqual(['tone', 'commits']);

    // The open memory is opened again as it is on disk, while you haven't changed it.
    el.querySelector<HTMLButtonElement>(
      'gr-memories-page [data-memory="tone"] .name button',
    )!.click();
    await settle();
    const editor = () => el.querySelector<HTMLTextAreaElement>('gr-memories-page textarea')!;
    text = 'Shorter answers.';
    emit('memories.changed', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(editor().value).toBe('Shorter answers.');

    // Not once you have.
    editor().value = 'Mine.';
    editor().dispatchEvent(new Event('input'));
    await fixture.whenStable();
    text = 'Theirs.';
    emit('memories.changed', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(editor().value).toBe('Mine.');
  });
});
