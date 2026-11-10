import type { AgentMemories, CommandRequest, Memory } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('memory-list', () => {
  it('draws the memories on the Memories page in columns by kind, with their links and errata', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const folder = 'C:/Users/me/.claude/projects/C--Users-me/memory';
    const memory = (name: string, type: string, links: string[], indexed = true): Memory => ({
      name,
      path: `${folder}/${name}.md`,
      description: `About ${name}`,
      type,
      changedAt: new Date(2026, 9, 31).getTime(),
      links,
      indexed,
    });
    answers['memories.list'] = (request: CommandRequest<'memories.list'>): AgentMemories => ({
      cwd: request.cwd ?? 'C:/Users/me',
      folder,
      index: { path: `${folder}/MEMORY.md`, exists: true },
      enabled: true,
      memories: [
        memory('scope-discipline', 'feedback', ['concise-answers']),
        memory('angular-conventions', 'project', []),
        memory('design-tokens', 'project', ['angular-conventions']),
        memory('commit-style', 'feedback', [], false),
        memory('testing-strategy', 'reference', ['commit-style']),
      ],
      problems: [
        'scope-discipline links to [[concise-answers]], which doesn’t exist.',
        'The index leaves out commit-style.',
      ],
      elsewhere: [
        { cwd: 'C:/Users/me/git/breeder', count: 3 },
        { cwd: null, count: 1 },
      ],
      at: new Date(2026, 10, 9, 15, 30).getTime(),
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-tab-page .title')).toEqual(['Memory map']);
    expect(texts('gr-memories-page .none')[0]).toBe(
      'Claude Code keeps them in ~/.claude/projects/C--Users-me/memory and reads its index in every chat.',
    );
    expect(texts('gr-memories-page h2')).toEqual(['Errata']);
    expect(texts('gr-memories-page .errata li')).toEqual([
      'scope-discipline links to [[concise-answers]], which doesn’t exist.',
      'The index leaves out commit-style.',
    ]);
    expect(texts('gr-memories-page .column h3')).toEqual(['Feedback', 'Projects', 'References']);
    const column = (title: string) =>
      [...el.querySelectorAll('gr-memories-page .column')].find(
        (c) => c.querySelector('h3')!.textContent!.trim() === title,
      )!;
    expect(
      [...column('Projects').querySelectorAll('.name')].map((n) => n.textContent!.trim()),
    ).toEqual(['angular-conventions', 'design-tokens']);
    const card = (name: string) =>
      el.querySelector<HTMLElement>(`gr-memories-page [data-memory="${name}"]`)!;
    expect(
      [...card('scope-discipline').querySelectorAll('.flag')].map((f) => f.textContent!.trim()),
    ).toEqual(['[[concise-answers]] missing']);
    expect(card('commit-style').querySelector('.flag')!.textContent!.trim()).toBe(
      'not in the index',
    );
    // A thread for each link that names a memory.
    expect(el.querySelectorAll('gr-memories-page path.thread')).toHaveLength(2);

    // Pointing at a memory brings its links forward, and sets the rest back.
    card('design-tokens').dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(card('angular-conventions').classList).not.toContain('faded');
    expect(card('commit-style').classList).toContain('faded');
    expect(el.querySelectorAll('gr-memories-page path.thread.lit')).toHaveLength(1);
    card('design-tokens').dispatchEvent(new MouseEvent('mouseleave'));
    await fixture.whenStable();
    expect(el.querySelectorAll('gr-memories-page .card.faded')).toHaveLength(0);

    // Another folder with memories is one click away.
    expect(texts('gr-memories-page .elsewhere .gr-link')).toEqual(['~/git/breeder 3']);
    el.querySelector<HTMLButtonElement>('gr-memories-page .elsewhere .gr-link')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'memories.list').map((c) => c.request)).toEqual([
      { agent: 'claude-code' },
      { agent: 'claude-code', cwd: 'C:/Users/me/git/breeder' },
    ]);
    expect(texts('gr-memories-page .sub')[0]).toMatch(/^In ~\/git\/breeder\s*·/);
  });

  it('says on the Memories page when there are no memories, or memory is off', async () => {
    const { bridge, answers } = fakeBridge();
    let enabled = true;
    answers['memories.list'] = (): AgentMemories => ({
      cwd: 'C:/Users/me',
      folder: 'C:/Users/me/.claude/projects/C--Users-me/memory',
      index: { path: 'C:/Users/me/.claude/projects/C--Users-me/memory/MEMORY.md', exists: false },
      enabled,
      memories: [],
      problems: [],
      elsewhere: [],
      at: new Date(2026, 10, 9, 15, 30).getTime(),
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-memories-page .none')).toEqual([
      'Claude Code keeps them in ~/.claude/projects/C--Users-me/memory with no index yet.',
      'No memories kept for this folder yet.',
    ]);

    enabled = false;
    [...el.querySelectorAll<HTMLButtonElement>('gr-memories-page .gr-link')]
      .find((b) => b.textContent!.includes('Read again'))!
      .click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(texts('gr-memories-page .none.alert')).toEqual([
      'Claude Code keeps no memories here: memory is turned off in its settings.',
    ]);
    expect(el.querySelector('gr-memories-page .map')).toBeNull();
  });
});
