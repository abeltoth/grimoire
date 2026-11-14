import { TestBed } from '@angular/core/testing';
import type { AgentCommand } from '@grimoire/contract';
import { fakeBridge, render, write } from '../../testing/app-testing';
import { ChatList } from '../core/chat-list';

const COMMANDS: AgentCommand[] = [
  { name: 'compact', description: 'Free up context', group: 'chat', run: 'now' },
  { name: 'review', description: 'Review a pull request', group: 'chat', run: 'compose' },
  { name: 'usage', description: 'Show plan usage', group: 'reports', run: 'now' },
  { name: 'model', description: 'Set the model', group: 'settings', run: 'pick', owner: 'model' },
  { name: 'commit', description: 'Commit the changes', group: 'skills', run: 'compose' },
];

async function opened() {
  const { bridge, calls, answers } = fakeBridge();
  answers['agents.commands'] = () => COMMANDS;
  const rendered = await render(bridge);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
  await rendered.fixture.whenStable();
  const field = rendered.el.querySelector<HTMLInputElement>('#gr-command-palette-search')!;
  const type = async (text: string) => {
    field.value = text;
    field.dispatchEvent(new Event('input'));
    await rendered.fixture.whenStable();
  };
  const press = async (key: string) => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    await rendered.fixture.whenStable();
  };
  return { ...rendered, calls, answers, field, type, press };
}

describe('command-palette', () => {
  it('lists the chat’s commands by what they do, turned to with Ctrl+K, and runs one', async () => {
    const { fixture, el, texts, calls, field, type, press } = await opened();

    expect(texts('gr-command-palette h2')).toEqual(['Index']);
    expect(texts('gr-command-palette .runs-in')).toEqual(['Runs in a new chapter']);
    expect(texts('gr-command-palette h3')).toEqual([
      'Settings',
      'Reports',
      'This chapter',
      'Claude Code’s skills',
    ]);
    expect(texts('gr-command-palette .entry .label')).toEqual([
      '/model',
      '/usage',
      '/compact',
      '/review',
      'commit',
    ]);
    expect(texts('gr-command-palette .entry .where')).toEqual([
      'choose ›',
      'run',
      'run',
      'write in',
      'skill',
    ]);
    expect(document.activeElement).toBe(field);

    await type('us');
    expect(texts('gr-command-palette .entry .label')).toEqual(['/usage']);
    expect(texts('gr-command-palette .count')).toEqual(['1 entry']);
    await press('Enter');
    // A blank chat begins with it.
    expect(calls.filter((c) => c.command === 'agents.start').map((c) => c.request)).toMatchObject([
      { agent: 'claude-code', text: '/usage' },
    ]);
    expect(el.querySelector('gr-command-palette')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    expect(texts('gr-command-palette .runs-in')).toEqual(['Runs in Untitled chapter']);
  });

  it('opens from its tab, says when nothing matches, and turns back with Esc', async () => {
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
      'Nothing in Claude Code’s commands and skills matches “zzz”.',
    ]);
    expect(texts('gr-command-palette .count')).toEqual(['0 entries']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-command-palette')).toBeNull();
    expect(notch.getAttribute('aria-current')).toBeNull();
  });

  it('lists a command’s choices, the one set now marked, and picks one', async () => {
    const { fixture, texts, field, type, press } = await opened();
    await type('model');
    await press('Enter');
    expect(texts('gr-command-palette h3')).toEqual(['/model']);
    expect(texts('gr-command-palette .entry .label')).toEqual([
      'Opus 5.5',
      'Sonnet 5.5',
      'Haiku 5.5',
    ]);
    expect(texts('gr-command-palette .entry .where')).toEqual(['set now', '', '']);
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);

    // Esc goes back to the commands first.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(texts('gr-command-palette h3')).toContain('Settings');
    await type('model');
    await press('Enter');
    await type('son');
    await press('Enter');
    expect(TestBed.inject(ChatList).current()?.settings.model).toBe('sonnet');
    expect(fixture.nativeElement.querySelector('gr-command-palette')).toBeNull();
  });

  it('writes a command in the message field to finish', async () => {
    const { el, type, press } = await opened();
    await type('review');
    await press('Enter');
    const message = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
    expect(message.value).toBe('/review ');
    expect(document.activeElement).toBe(message);
    expect(el.querySelector('gr-command-palette')).toBeNull();
  });

  it('runs a command clicked while searching from the message, which keeps the keys', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.commands'] = () => COMMANDS;
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'First');
    const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
    field.focus();
    field.value = '/comp';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const entry = el.querySelector<HTMLButtonElement>('gr-command-palette .entry')!;
    const press = new MouseEvent('mousedown', { cancelable: true });
    entry.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    entry.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: '/compact' },
    ]);
    expect(document.activeElement).toBe(field);
  });

  it("says why the agent's commands could not be listed", async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.commands'] = () => {
      throw new Error('Claude Code is not installed');
    };
    const { fixture, el, texts } = await render(bridge);
    const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
    field.value = '/';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    // A blank chat's folder isn't chosen yet: the agent looks in your home folder.
    expect(calls.filter((c) => c.command === 'agents.commands').map((c) => c.request)).toEqual([
      { agent: 'claude-code' },
    ]);
    expect(texts('gr-command-palette .entries .note')).toEqual([
      'Claude Code’s commands and skills couldn’t be listed: Claude Code is not installed',
    ]);
  });
});
