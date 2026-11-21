import { type BrowserWindow, Menu, WebContentsView, type WebContents, clipboard } from 'electron';
import type {
  BrowserMove,
  BrowserViewState,
  KeyPress,
  Platform,
  ViewRect,
} from '@grimoire/contract';
import { keyEffect } from './browser-keys';
import { menuItems } from './browser-menu';
import { browserSession } from './browser-session';

/** Only web addresses load: no files, no app pages, no scripts. */
const WEB = /^https?:\/\//i;
/** Chromium's code for a load that another one replaced, which isn't a failure. */
const CANCELLED = -3;

/** What the window hears of its web pages, on `grimoire:browserEvent`. */
export type BrowserEvent = 'change' | 'open' | 'key' | 'action';

/**
 * The web pages of one window, each by the id the window gave it, laid
 * over the part of the window the window says. One shows at a time. They
 * last as long as the window's page: a reload, such as after switching
 * profile, or closing the window ends them.
 */
export class Browsers {
  private readonly views = new Map<string, WebContentsView>();
  private readonly errors = new Map<string, string | null>();
  private shown: string | null = null;
  /** Where the shown page goes, kept to put it back after full screen. */
  private rect: ViewRect | null = null;
  private fullScreen: string | null = null;
  private shortcuts: readonly string[] = [];

  constructor(
    private readonly win: BrowserWindow,
    private readonly platform: Platform,
  ) {
    win.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.closeAll();
    });
    win.on('closed', () => this.closeAll());
    win.on('resize', () => this.fitFullScreen());
    // The mouse's back and forward buttons, on Windows and Linux.
    win.on('app-command', (_, command) => {
      const id = this.shown;
      if (!id || !this.views.get(id)?.webContents.isFocused()) return;
      if (command === 'browser-backward') this.go(id, 'back');
      else if (command === 'browser-forward') this.go(id, 'forward');
    });
  }

  open(id: string, url: string, profile: string): void {
    if (this.views.has(id)) return this.navigate(id, url);
    const view = new WebContentsView({
      webPreferences: {
        session: browserSession(profile),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    view.setVisible(false);
    this.win.contentView.addChildView(view);
    this.views.set(id, view);
    this.watch(id, view.webContents);
    this.navigate(id, url);
  }

  navigate(id: string, url: string): void {
    const contents = this.views.get(id)?.webContents;
    // A failed load is told through did-fail-load.
    if (contents && WEB.test(url)) contents.loadURL(url).catch(() => {});
  }

  go(id: string, move: BrowserMove): void {
    const contents = this.views.get(id)?.webContents;
    if (!contents) return;
    const history = contents.navigationHistory;
    if (move === 'back' && history.canGoBack()) history.goBack();
    else if (move === 'forward' && history.canGoForward()) history.goForward();
    else if (move === 'reload') contents.reload();
    else if (move === 'stop') contents.stop();
  }

  place(id: string, rect: ViewRect | null): void {
    const view = this.views.get(id);
    if (!view) return;
    if (!rect) {
      if (this.shown === id) this.hide(view);
      return;
    }
    for (const [other, shown] of this.views) if (other !== id) shown.setVisible(false);
    this.shown = id;
    this.rect = rect;
    if (this.fullScreen !== id) view.setBounds(rect);
    view.setVisible(true);
  }

  async snapshot(id: string): Promise<string> {
    const contents = this.views.get(id)?.webContents;
    return contents ? (await contents.capturePage()).toDataURL() : '';
  }

  close(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    if (this.shown === id) this.hide(view);
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view);
    view.webContents.close();
    this.views.delete(id);
    this.errors.delete(id);
  }

  setShortcuts(shortcuts: readonly string[]): void {
    this.shortcuts = shortcuts;
  }

  private closeAll(): void {
    for (const id of [...this.views.keys()]) this.close(id);
  }

  private hide(view: WebContentsView): void {
    // The keyboard goes back to the window, not to a page that can't be seen.
    if (view.webContents.isFocused() && !this.win.isDestroyed()) this.win.webContents.focus();
    view.setVisible(false);
    this.shown = null;
  }

  private fitFullScreen(): void {
    const view = this.fullScreen ? this.views.get(this.fullScreen) : undefined;
    if (!view) return;
    const [width = 0, height = 0] = this.win.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  }

  private watch(id: string, contents: WebContents): void {
    const tell = () => this.send('change', this.state(id, contents));
    contents.on('did-start-loading', () => {
      this.errors.set(id, null);
      tell();
    });
    contents.on('did-fail-load', (_, code, description, __, isMainFrame) => {
      if (!isMainFrame || code === CANCELLED) return;
      this.errors.set(id, description);
      tell();
    });
    for (const event of [
      'did-navigate',
      'did-navigate-in-page',
      'page-title-updated',
      'did-stop-loading',
    ] as const)
      contents.on(event as 'did-stop-loading', tell);

    contents.on('will-navigate', (details) => {
      if (!WEB.test(details.url)) details.preventDefault();
    });
    contents.setWindowOpenHandler(({ url, disposition }) => {
      // A sign-in popup, such as "Continue with Google", needs its opener, so it opens as a window.
      if (disposition === 'new-window')
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: { session: contents.session, sandbox: true, contextIsolation: true },
          },
        };
      if (WEB.test(url)) this.send('open', { id, url });
      return { action: 'deny' };
    });

    contents.on('enter-html-full-screen', () => {
      this.fullScreen = id;
      this.fitFullScreen();
    });
    contents.on('leave-html-full-screen', () => {
      this.fullScreen = null;
      if (this.shown === id && this.rect) this.views.get(id)?.setBounds(this.rect);
    });

    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Escape' && this.fullScreen === id) {
        void contents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()');
        return;
      }
      const press: KeyPress = {
        key: input.key,
        ctrl: input.control,
        meta: input.meta,
        shift: input.shift,
        alt: input.alt,
      };
      const effect = keyEffect(press, this.shortcuts, this.platform);
      if (!effect) return;
      event.preventDefault();
      if (effect.kind === 'move') this.go(id, effect.move);
      else if (effect.kind === 'zoom')
        contents.setZoomLevel(effect.by ? contents.getZoomLevel() + effect.by * 0.5 : 0);
      else {
        this.win.webContents.focus();
        if (effect.kind === 'action') this.send('action', { id, action: effect.action });
        else this.send('key', press);
      }
    });

    contents.on('context-menu', (_, params) => {
      const history = contents.navigationHistory;
      const items = menuItems(params, {
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
        back: () => this.go(id, 'back'),
        forward: () => this.go(id, 'forward'),
        reload: () => this.go(id, 'reload'),
        copy: () => contents.copy(),
        paste: () => contents.paste(),
        copyImage: (x, y) => contents.copyImageAt(x, y),
        saveImage: (url) => contents.downloadURL(url),
        copyText: (text) => clipboard.writeText(text),
        openInNewTab: (url) => this.send('open', { id, url }),
      });
      Menu.buildFromTemplate(items).popup({ window: this.win });
    });
  }

  private state(id: string, contents: WebContents): BrowserViewState {
    const history = contents.navigationHistory;
    return {
      id,
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      error: this.errors.get(id) ?? null,
    };
  }

  private send(event: BrowserEvent, payload: unknown): void {
    if (!this.win.isDestroyed()) this.win.webContents.send('grimoire:browserEvent', event, payload);
  }
}
