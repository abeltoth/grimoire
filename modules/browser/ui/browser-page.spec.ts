import type { BrowserTabs } from '@grimoire/contract';
import { fakeBrowserViews, fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

const gemini = { url: 'https://gemini.google.com/app', title: 'Gemini' };
const pinterest = { url: 'https://www.pinterest.com/', title: '' };

describe('BrowserPage', () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => vi.unstubAllGlobals());
  /** Runs the next animation frame, where the page follows its spot. */
  const nextFrame = () => frames.splice(0).forEach((callback) => callback(0));

  async function withPage(kept: BrowserTabs = { tabs: [gemini, pinterest], shown: 0 }) {
    const browser = fakeBrowserViews();
    const fake = fakeBridge({ browser: browser.views });
    fake.answers['browser.tabs'] = () => kept;
    const rendered = await render(fake.bridge);
    await openPageTab(rendered.fixture, rendered.el, 'Atlas');
    await new Promise((resolve) => setTimeout(resolve));
    await rendered.fixture.whenStable();
    const address = rendered.el.querySelector<HTMLInputElement>('gr-browser-page input')!;
    const shownId = () => vi.mocked(browser.views.open).mock.calls.at(-1)![0];
    return { ...fake, ...browser, ...rendered, address, shownId };
  }

  it('names each tab for its page, or its host until it has a title, with the shown one’s address', async () => {
    const { texts, address } = await withPage();
    expect(texts('gr-browser-page [role="tab"]')).toEqual(['Gemini', 'pinterest.com']);
    expect(texts('gr-browser-page [role="tab"][aria-selected="true"]')).toEqual(['Gemini']);
    expect(address.value).toBe(gemini.url);
  });

  it('lays the shown tab’s page over its spot, telling the app only when that changes', async () => {
    const { views, shownId } = await withPage();
    nextFrame();
    nextFrame();
    expect(views.place).toHaveBeenCalledTimes(1);
    expect(views.place).toHaveBeenCalledWith(shownId(), { x: 0, y: 0, width: 0, height: 0 });
  });

  it('loads what’s typed in the address field, a bare host on https', async () => {
    const { fixture, views, address, shownId } = await withPage();
    address.value = 'pinterest.com';
    address.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(views.navigate).toHaveBeenCalledWith(shownId(), 'https://pinterest.com');
  });

  it('puts the address back on Esc, without turning the page back', async () => {
    const { fixture, el, address } = await withPage();
    address.value = 'half typed';
    address.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(address.value).toBe(gemini.url);
    expect(el.querySelector('gr-browser-page')).not.toBeNull();
  });

  it('says why a page couldn’t load, in place of the page', async () => {
    const { fixture, el, views, tell, shownId } = await withPage();
    nextFrame();
    const id = shownId();
    tell('change', {
      id,
      url: gemini.url,
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: 'ERR_INTERNET_DISCONNECTED',
    });
    await fixture.whenStable();
    nextFrame();
    expect(el.querySelector('gr-browser-page .note')!.textContent).toContain(
      'ERR_INTERNET_DISCONNECTED',
    );
    expect(views.place).toHaveBeenLastCalledWith(id, null);
  });

  it('puts a picture of the page in its place while a dialog floats over it', async () => {
    const { fixture, el, views, shownId } = await withPage();
    nextFrame();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(views.snapshot).toHaveBeenCalledWith(shownId());
    expect(views.place).toHaveBeenLastCalledWith(shownId(), null);
    expect(el.querySelector<HTMLElement>('gr-browser-page .spot')!.style.backgroundImage).toContain(
      'data:image/png',
    );

    dialog.remove();
    await new Promise((resolve) => setTimeout(resolve));
    nextFrame();
    expect(views.place).toHaveBeenLastCalledWith(shownId(), expect.objectContaining({ x: 0 }));
  });

  it('hides the page when the right page turns back, keeping it for next time', async () => {
    const { fixture, el, views, shownId } = await withPage();
    nextFrame();
    el.querySelector<HTMLButtonElement>('gr-tab-page .gr-link')!.click();
    await fixture.whenStable();
    expect(views.place).toHaveBeenLastCalledWith(shownId(), null);
    expect(views.close).not.toHaveBeenCalled();
  });
});
