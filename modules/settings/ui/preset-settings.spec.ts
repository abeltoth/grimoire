import type { Preset } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('preset-settings', () => {
  it('keeps presets in Settings, to rename, remove, and give a first message new chats begin with', async () => {
    const { bridge, answers, calls } = fakeBridge();
    let saved: Preset[] = [
      {
        name: 'Bug fix',
        agent: 'claude-code',
        settings: { mode: 'accept-edits', cwd: 'C:/Users/me/git/breeder' },
      },
      { name: 'Plan a feature', agent: 'claude-code', settings: { mode: 'plan' } },
    ];
    answers['presets.list'] = () => saved;
    answers['presets.save'] = (preset: Preset) =>
      (saved = saved.map((p) => (p.name === preset.name ? preset : p)));
    answers['presets.rename'] = ({ from, to }: { from: string; to: string }) =>
      (saved = saved.map((p) => (p.name === from ? { ...p, name: to } : p)));
    answers['presets.remove'] = ({ name }: { name: string }) =>
      (saved = saved.filter((p) => p.name !== name));
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    const preset = (name: string) =>
      [...el.querySelectorAll<HTMLElement>('gr-settings-page .preset')].find(
        (article) => article.querySelector('h3')?.textContent!.trim() === name,
      )!;
    const link = (within: HTMLElement, text: string) =>
      [...within.querySelectorAll<HTMLButtonElement>('.gr-link')].find(
        (button) => button.textContent!.trim() === text,
      )!;

    expect(texts('gr-settings-page .preset h3')).toEqual(['Bug fix', 'Plan a feature']);
    expect(texts('gr-settings-page .preset .sub')[0]).toBe(
      'Claude Code · Accept edits · ~/git/breeder',
    );

    const prompt = preset('Bug fix').querySelector<HTMLTextAreaElement>('textarea')!;
    prompt.value = 'Find the failing test and fix it';
    prompt.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'presets.save')!.request).toMatchObject({
      name: 'Bug fix',
      prompt: 'Find the failing test and fix it',
    });

    link(preset('Plan a feature'), 'Rename').click();
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('gr-settings-page .name-field')!;
    expect(document.activeElement).toBe(field);
    field.value = 'Plan it';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'presets.rename').map((c) => c.request)).toEqual([
      { from: 'Plan a feature', to: 'Plan it' },
    ]);
    expect(texts('gr-settings-page .preset h3')).toEqual(['Bug fix', 'Plan it']);

    link(preset('Plan it'), 'Remove').click();
    await fixture.whenStable();
    expect(texts('gr-settings-page .ask')).toEqual([
      'Remove “Plan it”? Chapters begun with it keep their settings.',
    ]);
    preset('Plan it').querySelector<HTMLButtonElement>('.danger')!.click();
    await fixture.whenStable();
    expect(texts('gr-settings-page .preset h3')).toEqual(['Bug fix']);

    // New chats begin with the preset, its first message written in.
    [...el.querySelectorAll<HTMLButtonElement>('#gr-settings-general ~ .form .word')]
      .find((word) => word.textContent!.trim() === 'Bug fix')!
      .click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-chat-tab.new button')!.click();
    await fixture.whenStable();
    const messageField = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
    expect(messageField.value).toBe('Find the failing test and fix it');
    expect(texts('.meta button').at(-1)).toBe('Bug fix');
  });
});
