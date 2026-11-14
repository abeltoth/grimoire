import type { GrimoireSettings } from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { DENSITIES, TEXT_FONTS } from './theme';
import { THEME_SHEETS } from '@ui/design-system/theme-sheets';
import { fakeBridge, render } from '@ui/testing/app-testing';

describe('theme-editor', () => {
  it('changes the theme’s tokens in Settings, the book showing each change at once', async () => {
    const { bridge, answers, calls } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) =>
      (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const root = document.documentElement.style;
    const sets = () => calls.filter((c) => c.command === 'settings.set').map((c) => c.request);
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await fixture.whenStable();
    };
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    for (let i = 0; i < 50 && !el.querySelector('gr-theme-editor details'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fixture.whenStable();
    }

    expect(texts('gr-theme-editor .form .label')).toEqual([
      'Desk',
      'Cover',
      'Paper',
      'Ink',
      'Soft ink',
      'Rubric',
      'Pen',
      'Lapis',
      'Gilt',
      'Size of the text',
      'Face of the text',
      'Room on the page',
    ]);
    expect(texts('gr-theme-editor summary')[0]).toMatch(/^Desk, binding and thumb index\s*\d+$/);
    // Collapsed until opened.
    expect(el.querySelector('gr-theme-editor li')).toBeNull();

    const paper = el.querySelector<HTMLInputElement>('#gr-theme---gr-page')!;
    expect(paper.value).toBe('#f3ebd9');
    paper.value = '#fffaf0';
    paper.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(root.getPropertyValue('--gr-page')).toBe('#fffaf0');
    // Kept once you stop, not at every step.
    paper.value = '#ffffff';
    paper.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(sets()).toEqual([]);
    await settle();
    expect(sets()).toEqual([{ theme: { '--gr-page': '#ffffff' } }]);
    expect(texts('gr-theme-editor .count')).toEqual([
      expect.stringMatching(/ tokens · 1 changed$/),
    ]);

    const field = el.querySelector<HTMLInputElement>('#gr-theme-search')!;
    field.value = 'composer';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-theme-editor summary')).toEqual([
      expect.stringMatching(/^Chat: composer\s*\d+$/),
    ]);
    const gap = el.querySelector<HTMLInputElement>(
      'gr-theme-editor input[aria-label="--gr-composer-gap"]',
    )!;
    expect(gap.value).toBe('5px');
    gap.value = '8px';
    gap.dispatchEvent(new Event('change'));
    await settle();
    expect(root.getPropertyValue('--gr-composer-gap')).toBe('8px');
    expect(kept.theme).toEqual({ '--gr-page': '#ffffff', '--gr-composer-gap': '8px' });

    // Written back as drawn, it's no longer changed.
    gap.value = '5px';
    gap.dispatchEvent(new Event('change'));
    await settle();
    expect(kept.theme).toEqual({ '--gr-page': '#ffffff' });
    expect(root.getPropertyValue('--gr-composer-gap')).toBe('');

    [...el.querySelectorAll<HTMLButtonElement>('gr-theme-editor .gr-link')]
      .find((button) => button.textContent!.trim() === 'Reset all')!
      .click();
    await fixture.whenStable();
    expect(kept.theme).toEqual({});
    expect(root.getPropertyValue('--gr-page')).toBe('');
  });

  it('sets the text’s face and the room on the page in Settings, as changes to the theme', async () => {
    const { bridge, answers } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) =>
      (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const root = document.documentElement.style;
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await fixture.whenStable();
    };
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    for (let i = 0; i < 50 && !el.querySelector('gr-theme-editor details'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fixture.whenStable();
    }
    const group = (name: string) =>
      el.querySelector(`gr-theme-editor [aria-labelledby="gr-theme-${name}"]`)!;
    const words = (name: string) => [...group(name).querySelectorAll<HTMLButtonElement>('.word')];
    const named = (name: string) => words(name).map((button) => button.textContent!.trim());
    const word = (name: string, label: string) => words(name)[named(name).indexOf(label)]!;
    const picked = (name: string) =>
      words(name)
        .filter((button) => button.getAttribute('aria-checked') === 'true')
        .map((button) => button.textContent!.trim());
    const reset = (name: string) =>
      group(name).parentElement!.querySelector<HTMLButtonElement>('.gr-link');
    const [, sans, , mono] = TEXT_FONTS;
    const [compact, , roomy] = DENSITIES;

    expect(named('font')).toEqual(['The book’s', 'Sans-serif', 'Serif', 'Monospace']);
    expect(picked('font')).toEqual(['The book’s']);
    expect(named('density')).toEqual(['Compact', 'Normal', 'Roomy']);
    // Normal is the book as drawn: nothing changed, nothing to reset.
    expect(picked('density')).toEqual(['Normal']);
    expect(reset('font')).toBeNull();
    expect(reset('density')).toBeNull();

    word('font', 'Sans-serif').click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value });
    expect(root.getPropertyValue('--gr-font-text')).toBe(sans!.value);
    expect(picked('font')).toEqual(['Sans-serif']);

    word('density', 'Compact').click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value, ...compact!.tokens });
    expect(root.getPropertyValue('--gr-space-3')).toBe('9px');
    expect(picked('density')).toEqual(['Compact']);
    const changed = Object.keys(compact!.tokens).length + 1;
    expect(texts('gr-theme-editor .count')).toEqual([
      expect.stringMatching(new RegExp(` · ${changed} changed$`)),
    ]);

    // Roomy takes Compact's place; the face stays.
    word('density', 'Roomy').click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value, ...roomy!.tokens });

    // One of its tokens changed by hand is none of the densities.
    const field = el.querySelector<HTMLInputElement>('#gr-theme-search')!;
    field.value = '--gr-space-3';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const space = el.querySelector<HTMLInputElement>(
      'gr-theme-editor input[aria-label="--gr-space-3"]',
    )!;
    expect(space.value).toBe('15px');
    space.value = '14px';
    space.dispatchEvent(new Event('change'));
    await settle();
    expect(picked('density')).toEqual([]);

    reset('density')!.click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value });
    expect(root.getPropertyValue('--gr-space-3')).toBe('');
    expect(picked('density')).toEqual(['Normal']);

    word('font', 'The book’s').click();
    await settle();
    expect(kept.theme).toEqual({});
    expect(root.getPropertyValue('--gr-font-text')).toBe('');
    expect(reset('font')).toBeNull();

    // Another theme starts afresh, the face and the density with it, even before they were kept.
    word('font', 'Monospace').click();
    word('density', 'Compact').click();
    await fixture.whenStable();
    expect(root.getPropertyValue('--gr-font-text')).toBe(mono!.value);
    [...el.querySelectorAll<HTMLButtonElement>('gr-theme-editor .theme')]
      .find((button) => button.querySelector('.theme-name')!.textContent!.trim() === 'Sepia')!
      .click();
    await settle();
    expect(kept.themeName).toBe('sepia');
    expect(kept.theme).toEqual({});
    expect(picked('font')).toEqual(['The book’s']);
    expect(picked('density')).toEqual(['Normal']);
  });

  it('chooses a ready-made theme in Settings, which starts afresh from it', async () => {
    const { bridge, answers } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS, theme: { '--gr-page': '#fffaf0' } };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) =>
      (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const theme = () => document.documentElement.dataset['theme'];
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-theme-editor .theme-name')).toEqual([
      'Grimoire',
      'Night',
      'Sepia',
      'High contrast',
      'Automatic',
    ]);
    const card = (name: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-theme-editor .theme')].find(
        (button) => button.querySelector('.theme-name')!.textContent!.trim() === name,
      )!;
    expect(card('Grimoire').getAttribute('aria-checked')).toBe('true');
    expect(theme()).toBe('grimoire');

    card('Night').click();
    await fixture.whenStable();
    expect(kept.themeName).toBe('night');
    // The colour changed over Grimoire isn't carried over to Night.
    expect(kept.theme).toEqual({});
    expect(theme()).toBe('night');
    expect(card('Night').getAttribute('aria-checked')).toBe('true');
    expect(card('Grimoire').getAttribute('aria-checked')).toBe('false');

    // Automatic follows the system, which a test's window calls light.
    card('Automatic').click();
    await fixture.whenStable();
    expect(kept.themeName).toBe('auto');
    expect(theme()).toBe('grimoire');
  });

  it('lists the tokens of the sheets modules add, after the theme’s own, to change as any other', async () => {
    const { bridge } = fakeBridge();
    const sheet = `:root {
  /* Extra: a module from outside */
  --gr-extra-gap: 4px;
}
`;
    const { fixture, el, texts } = await render(bridge, [
      { provide: THEME_SHEETS, multi: true, useValue: () => Promise.resolve(sheet) },
    ]);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    for (let i = 0; i < 50 && !el.querySelector('gr-theme-editor details'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fixture.whenStable();
    }

    expect(texts('gr-theme-editor summary').at(-1)).toMatch(/^Extra: a module from outside\s*1$/);
    expect(texts('gr-theme-editor summary')[0]).toMatch(/^Desk, binding and thumb index/);
  });
});
