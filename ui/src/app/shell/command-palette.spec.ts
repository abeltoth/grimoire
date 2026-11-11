import type { CommandRequest, OpenChat, Preset } from '@grimoire/contract';
import { fakeBridge, render } from '../../testing/app-testing';

describe('command-palette', () => {
  it('searches actions and chats in the command palette, turned to with Ctrl+K', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.chats'] = () => [
      { id: 'c7', agent: 'claude-code', title: 'Old notes', cwd: 'C:/Users/me', updatedAt: 0 },
      {
        id: 'c8',
        agent: 'claude-code',
        title: 'Fix flaky login test',
        cwd: 'C:/Users/me/git/grimoire',
        updatedAt: 1,
      },
      {
        id: 'c9',
        agent: 'claude-code',
        title: 'New onboarding flow',
        cwd: 'C:/Users/me/git/breeder',
        updatedAt: 2,
      },
    ];
    answers['history.pinsAndTags'] = () => ({
      pins: { c7: ['pin', 'star'], c8: ['star'] },
      tags: {},
    });
    answers['agents.open'] = (request: CommandRequest<'agents.open'>): OpenChat => ({
      id: request.chatId,
      agent: request.agent,
      title: 'New onboarding flow',
      settings: request.settings,
      status: 'idle',
      entries: [{ kind: 'user', id: 'u1', text: 'Plan the onboarding' }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      copied: [],
    });
    const { fixture, el, texts } = await render(bridge);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    // The chats arrive from the service a moment later.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(texts('gr-command-palette h2')).toEqual(['Index']);
    expect(texts('gr-command-palette h3')).toEqual(['Actions', 'Chapters']);
    // A pinned chat stays at the top, however old.
    expect(texts('gr-command-palette .entry .label')).toEqual([
      'New chapter',
      'New chapter from preset',
      'Close chapter',
      'Single page',
      'Old notes',
      'New onboarding flow',
      'Fix flaky login test',
    ]);
    const field = el.querySelector<HTMLInputElement>('#gr-command-palette-search')!;
    expect(document.activeElement).toBe(field);

    field.value = 'new';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-command-palette .entry .label')).toEqual([
      'New chapter',
      'New chapter from preset',
      'New onboarding flow',
    ]);
    expect(texts('gr-command-palette .entry b')).toEqual(['New', 'New', 'New']);
    expect(texts('gr-command-palette .count')).toEqual(['3 entries']);
    expect(texts('gr-command-palette .entry .gloss')).toEqual([
      'with your last settings',
      'pick a preset first',
      'Claude Code · ~/git/breeder',
    ]);
    expect(texts('gr-command-palette .entry .where .gr-kbd')).toEqual(['Ctrl', 'N']);
    expect(texts('gr-command-palette .entry[aria-selected="true"] .label')).toEqual([
      'New chapter',
    ]);

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.open').map((c) => c.request)).toEqual([
      { agent: 'claude-code', chatId: 'c9', settings: { cwd: 'C:/Users/me/git/breeder' } },
    ]);
    expect(el.querySelector('gr-command-palette')).toBeNull();
    expect(texts('gr-page-header h1')).toEqual(['New onboarding flow']);
  });

  it('opens the command palette from its tab, and turns back with Esc', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    const notch = el.querySelector<HTMLButtonElement>('gr-page-tabs .command-palette')!;
    notch.click();
    await fixture.whenStable();
    expect(notch.getAttribute('aria-current')).toBe('page');
    expect(texts('gr-command-palette .row .gr-link')).toEqual(['Back to the Outline Esc']);

    const field = el.querySelector<HTMLInputElement>('#gr-command-palette-search')!;
    field.value = 'zzz';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-command-palette .entries .note')).toEqual([
      'Nothing in the index matches “zzz”.',
    ]);
    expect(texts('gr-command-palette .count')).toEqual(['0 entries']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-command-palette')).toBeNull();
    expect(notch.getAttribute('aria-current')).toBeNull();
  });

  it('begins a chat from a preset listed in the command palette', async () => {
    const { bridge, answers } = fakeBridge();
    answers['presets.list'] = (): Preset[] => [
      {
        name: 'Bug fix',
        agent: 'claude-code',
        settings: { cwd: 'C:/Users/me/git/breeder', model: 'sonnet', mode: 'accept-edits' },
      },
    ];
    const { fixture, el, texts } = await render(bridge);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('#gr-command-palette-search')!;
    field.value = 'preset';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-command-palette .entry .where')).toEqual(['opens a list ›']);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();

    expect(texts('gr-command-palette h3')).toEqual(['Presets']);
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    expect(texts('gr-command-palette .entry .gloss')).toEqual([
      'Claude Code · Accept edits · ~/git/breeder',
    ]);
    // Esc goes back to the whole command palette first.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(texts('gr-command-palette h3')).toEqual(['Actions']);
    el.querySelector<HTMLButtonElement>('#gr-command-palette-action-from-preset')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-command-palette .entry')!.click();
    await fixture.whenStable();

    expect(el.querySelector('gr-command-palette')).toBeNull();
    expect(texts('.meta button')).toEqual([
      'Claude Code',
      'Sonnet 5.5',
      'Default effort',
      'Accept edits',
      '~/git/breeder',
      'Bug fix',
    ]);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
  });
});
