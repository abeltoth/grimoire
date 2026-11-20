import type { ChromeState } from '@grimoire/contract';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

const connected: ChromeState = {
  on: true,
  unusable: null,
  installed: true,
  connected: true,
  browser: 'Chrome on Desk',
  installUrl: 'https://clau.de/chrome',
  reconnectUrl: 'https://clau.de/chrome/reconnect',
};

async function withChrome(state: ChromeState | null, agent = 'claude-code') {
  const fake = fakeBridge();
  fake.answers['agents.list'] = () => [{ id: agent, name: 'Agent', capabilities: [] }];
  fake.answers['chrome.get'] = () => state;
  const rendered = await render(fake.bridge);
  await openPageTab(rendered.fixture, rendered.el, 'Colophon');
  const status = () => rendered.el.querySelector('gr-chrome-settings .status')?.textContent?.trim();
  const word = (text: string) =>
    [...rendered.el.querySelectorAll<HTMLButtonElement>('gr-chrome-settings .word')].find(
      (b) => b.textContent!.trim() === text,
    )!;
  const sent = (command: string) =>
    fake.calls.filter((c) => c.command === command).map((c) => c.request);
  return { ...fake, ...rendered, status, word, sent };
}

describe('ChromeSettings', () => {
  it('shows the switch, and the browser it’s connected to', async () => {
    const { status, word } = await withChrome(connected);
    expect(word('On').getAttribute('aria-checked')).toBe('true');
    expect(status()).toBe('Connected to Chrome on Desk.');
  });

  it('turns it off, and shows its state then', async () => {
    const { word, sent, status, fixture, answers } = await withChrome(connected);
    answers['chrome.set'] = () => ({ ...connected, on: false, connected: false });
    word('Off').click();
    await fixture.whenStable();
    expect(sent('chrome.set')).toEqual([{ on: false }]);
    expect(word('Off').getAttribute('aria-checked')).toBe('true');
    expect(status()).toBe('Installed.');
  });

  it('offers to install the extension when it isn’t', async () => {
    const { el, bridge, fixture } = await withChrome({
      ...connected,
      installed: false,
      connected: false,
    });
    const install = el.querySelector<HTMLButtonElement>('gr-chrome-settings .status .gr-link')!;
    expect(install.textContent!.trim()).toBe('Install it');
    install.click();
    await fixture.whenStable();
    expect(bridge.openExternal).toHaveBeenCalledWith('https://clau.de/chrome');
  });

  it('offers to reconnect when no browser is connected', async () => {
    const { el, bridge, fixture } = await withChrome({ ...connected, connected: false });
    const reconnect = el.querySelector<HTMLButtonElement>('gr-chrome-settings .status .gr-link')!;
    expect(reconnect.textContent!.trim()).toBe('Reconnect');
    reconnect.click();
    await fixture.whenStable();
    expect(bridge.openExternal).toHaveBeenCalledWith('https://clau.de/chrome/reconnect');
  });

  it('says why it can’t be used', async () => {
    const plan = 'It needs a claude.ai plan, and this account signs in another way.';
    expect((await withChrome({ ...connected, unusable: plan })).status()).toBe(plan);
  });

  it('says when Claude Code couldn’t say', async () => {
    expect((await withChrome(null)).status()).toBe(
      'Claude Code couldn’t say whether the extension is there.',
    );
  });

  it('isn’t shown without Claude Code', async () => {
    const { el } = await withChrome(connected, 'other');
    expect(el.querySelector('gr-chrome-settings section')).toBeNull();
  });
});
