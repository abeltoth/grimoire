import { TestBed } from '@angular/core/testing';
import type { BrowserTabs, BrowserViewState } from '@grimoire/contract';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { fakeBrowserViews, useFakeBridge } from '@ui/testing/app-testing';
import { HOME, WebTabs } from './web-tabs';

const gemini = { url: 'https://gemini.google.com/app', title: 'Gemini' };
const pinterest = { url: 'https://www.pinterest.com/', title: 'Pinterest' };

describe('WebTabs', () => {
  afterEach(() => vi.useRealTimers());

  async function withTabs(kept: BrowserTabs = { tabs: [], shown: 0 }) {
    const browser = fakeBrowserViews();
    const fake = useFakeBridge({ browser: browser.views });
    fake.answers['browser.tabs'] = () => kept;
    const tabs = TestBed.inject(WebTabs);
    await tabs.load();
    // The profile in use is read.
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
    return { ...fake, ...browser, tabs };
  }
  const state = (change: Partial<BrowserViewState> & { id: string }): BrowserViewState => ({
    url: '',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    ...change,
  });

  it('opens on Gemini the first time, starting its page in the profile in use', async () => {
    const { tabs, views } = await withTabs();
    expect(tabs.tabs().map(({ url }) => url)).toEqual([HOME]);
    expect(views.open).toHaveBeenCalledWith(tabs.shown()!.id, HOME, 'personal');
  });

  it('opens the kept tabs on the one that showed, starting only its page', async () => {
    const { tabs, views } = await withTabs({ tabs: [gemini, pinterest], shown: 1 });
    expect(tabs.tabs().map(({ title }) => title)).toEqual(['Gemini', 'Pinterest']);
    expect(tabs.shown()!.url).toBe(pinterest.url);
    expect(views.open).toHaveBeenCalledTimes(1);
    expect(views.open).toHaveBeenCalledWith(tabs.shown()!.id, pinterest.url, 'personal');
  });

  it('follows what each page tells, keeping the address asked for until it has its own', async () => {
    const { tabs, tell } = await withTabs({ tabs: [gemini], shown: 0 });
    const id = tabs.shown()!.id;
    tell('change', state({ id, title: 'Gemini', loading: true }));
    expect(tabs.shown()).toMatchObject({ url: gemini.url, loading: true });
    tell(
      'change',
      state({ id, url: 'https://gemini.google.com/app/1', title: 'Ink', canGoBack: true }),
    );
    expect(tabs.shown()).toMatchObject({
      url: 'https://gemini.google.com/app/1',
      title: 'Ink',
      canGoBack: true,
    });
  });

  it('opens a page’s new-tab link after it, and shows it', async () => {
    const { tabs, tell } = await withTabs({ tabs: [gemini, pinterest], shown: 0 });
    tell('open', { id: tabs.tabs()[0]!.id, url: 'https://www.pinterest.com/pin/1' });
    expect(tabs.tabs().map(({ url }) => url)).toEqual([
      gemini.url,
      'https://www.pinterest.com/pin/1',
      pinterest.url,
    ]);
    expect(tabs.shown()!.url).toBe('https://www.pinterest.com/pin/1');
  });

  it('closes a tab and its page, and leaves an empty one asking for an address when it was the last', async () => {
    const { tabs, views } = await withTabs({ tabs: [gemini], shown: 0 });
    const id = tabs.shown()!.id;
    tabs.close(id);
    expect(views.close).toHaveBeenCalledWith(id);
    expect(tabs.tabs()).toHaveLength(1);
    expect(tabs.shown()!.url).toBe('');
    expect(tabs.addressWanted()).toBe(1);
  });

  it('does what the browser’s keys pressed inside a page ask', async () => {
    const { tabs, tell } = await withTabs({ tabs: [gemini], shown: 0 });
    const id = tabs.shown()!.id;
    tell('action', { id, action: 'new-tab' });
    expect(tabs.tabs()).toHaveLength(2);
    tell('action', { id: tabs.shown()!.id, action: 'close-tab' });
    expect(tabs.tabs()).toHaveLength(1);
    tell('action', { id, action: 'focus-address' });
    expect(tabs.addressWanted()).toBe(2);
  });

  it('gives the app Grimoire’s shortcuts, and runs one pressed inside a page', async () => {
    const { views, tell } = await withTabs();
    const run = vi.fn();
    TestBed.inject(ShellRegistry).commands.add({
      id: 'test.run',
      label: 'Run',
      shortcut: 'Mod+Shift+Y',
      run,
    });
    TestBed.tick();
    expect(vi.mocked(views.shortcuts).mock.calls.at(-1)![0]).toContain('Mod+Shift+Y');
    const pressed: KeyboardEvent[] = [];
    document.addEventListener('keydown', (event) => pressed.push(event), { once: true });
    tell('key', { key: 'Y', ctrl: true, meta: false, shift: true, alt: false });
    expect(pressed[0]).toMatchObject({ key: 'Y', ctrlKey: true, shiftKey: true });
  });

  it('keeps the tabs a moment after they change', async () => {
    const { tabs, calls } = await withTabs({ tabs: [gemini], shown: 0 });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    tabs.navigate('https://www.pinterest.com/');
    tabs.add('');
    expect(calls.some((c) => c.command === 'browser.save')).toBe(false);
    vi.advanceTimersByTime(500);
    expect(calls.filter((c) => c.command === 'browser.save').map((c) => c.request)).toEqual([
      {
        tabs: [
          { url: 'https://www.pinterest.com/', title: 'Gemini' },
          { url: '', title: '' },
        ],
        shown: 1,
      },
    ]);
  });
});
