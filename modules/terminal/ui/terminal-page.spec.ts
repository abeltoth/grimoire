import type { TerminalInfo } from '@grimoire/contract';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';
import { useTestScreen } from './xterm-testing';

const shell = (id: string, cwd: string): TerminalInfo => ({ id, cwd, shell: 'pwsh', openedAt: 0 });

describe('TerminalPage', () => {
  useTestScreen();

  async function withPage(running: TerminalInfo[]) {
    const fake = fakeBridge();
    fake.answers['terminal.list'] = () => running;
    fake.answers['terminal.open'] = () => shell('new', 'C:/Users/me');
    const rendered = await render(fake.bridge);
    await openPageTab(rendered.fixture, rendered.el, 'Scriptorium');
    await new Promise((resolve) => setTimeout(resolve));
    await rendered.fixture.whenStable();
    return { ...fake, ...rendered };
  }

  it('puts each shell on a tab named for its folder, with a sheet for each', async () => {
    const { el, texts } = await withPage([
      shell('a', 'C:/Users/me/git/grimoire'),
      shell('b', 'C:/Users/me/git/grimoire'),
    ]);
    expect(texts('gr-terminal-page [role="tab"]')).toEqual(['grimoire', 'grimoire ii']);
    expect(texts('gr-terminal-page [role="tab"][aria-selected="true"]')).toEqual(['grimoire ii']);
    expect(el.querySelectorAll('gr-terminal-sheet')).toHaveLength(2);
    expect(el.querySelectorAll('gr-terminal-sheet.shown')).toHaveLength(1);
  });

  it('closes a shell from its tab, and offers a new one when every shell is closed', async () => {
    const { fixture, el, texts, calls } = await withPage([shell('a', 'C:/Users/me/git/grimoire')]);
    el.querySelector<HTMLButtonElement>('gr-terminal-page .close')!.click();
    await fixture.whenStable();
    expect(calls.some((c) => c.command === 'terminal.close')).toBe(true);
    expect(texts('gr-terminal-page p.none')).toEqual(['Every shell is closed. New']);
  });

  it('says why when the shells can’t be reached', async () => {
    const fake = fakeBridge();
    fake.answers['terminal.list'] = () => Promise.reject(new Error('gone'));
    const { fixture, el, texts } = await render(fake.bridge);
    await openPageTab(fixture, el, 'Scriptorium');
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(texts('gr-terminal-page [role="alert"]')).toEqual([
      'The shells couldn’t be reached: gone',
    ]);
  });
});
