import { type BrowserWindow, screen } from 'electron';
import type { Layout, Popout } from '@grimoire/contract';
import type { ServiceClient } from './service-client';
import type { WindowSetup, WindowSize, createWindow } from './windows';

/**
 * The chats popped out into windows of their own, one window per chat,
 * kept in the layout so they open again with the main window.
 */
export class Popouts {
  /** The popouts' windows, by the chat each holds. */
  private readonly windows = new Map<string, BrowserWindow>();
  /** The chats popped out, as the layout keeps them. */
  private popouts: Popout[] = [];
  /** While the main window closes or the app quits: the popouts close with it, and open again next time. */
  private keep = false;

  constructor(
    private readonly setup: WindowSetup,
    private readonly service: () => Promise<ServiceClient>,
    private readonly create: typeof createWindow,
    /** The main window, when it's open. */
    private readonly main: () => BrowserWindow | undefined,
  ) {}

  /** The app quits: its popouts close with it, to open again next time. */
  appQuits(): void {
    this.keep = true;
  }

  /** The main window opens: a popout closed from now on puts its chat back in it. */
  mainOpens(): void {
    this.keep = false;
  }

  /** The main window closes: its popouts close with it, to open again with it. */
  closeWithMain(): void {
    this.keep = true;
    for (const popout of this.windows.values()) popout.close();
  }

  /** A popped-out chat's window: brought to the front when it's open already. */
  open(popout: Popout): void {
    const open = this.windows.get(popout.chatId);
    if (open) {
      if (open.isMinimized()) open.restore();
      open.focus();
      return;
    }
    const win = this.create(this.setup, popout.bounds ?? this.place(), popout);
    this.windows.set(popout.chatId, win);
    if (!this.popouts.some((kept) => kept.chatId === popout.chatId)) {
      this.popouts = [...this.popouts, { chatId: popout.chatId }];
      this.save();
    }
    win.on('close', () => {
      this.windows.delete(popout.chatId);
      if (this.keep) {
        // Closing with the main window: it opens again where it is.
        const bounds = win.getNormalBounds();
        this.popouts = this.popouts.map((kept) =>
          kept.chatId === popout.chatId ? { ...kept, bounds } : kept,
        );
      } else {
        // Closed by itself: its chat goes back into the main window.
        this.popouts = this.popouts.filter((kept) => kept.chatId !== popout.chatId);
        this.main()?.webContents.send('grimoire:popoutClosed', popout.chatId);
      }
      this.save();
    });
  }

  /** Opens the chats that were popped out when the main window last closed, each where it was. */
  reopen(): void {
    this.service()
      .then((client) => client.request('layout.get', {}))
      .then((layout) => {
        const saved = (layout as Partial<Layout> | undefined)?.popouts ?? [];
        // Any popped out meanwhile stay out too.
        this.popouts = [
          ...saved,
          ...this.popouts.filter((kept) => !saved.some((popout) => popout.chatId === kept.chatId)),
        ];
        for (const popout of saved) this.open(popout);
      })
      .catch((error: unknown) => console.error(error));
  }

  /** Another profile is in use: the popouts close, kept in the last one's layout as they were. */
  forget(): void {
    // Destroyed, not closed: a popout closing would put its chat back, in the new profile's layout.
    for (const popout of this.windows.values()) popout.destroy();
    this.windows.clear();
    this.popouts = [];
  }

  private save(): void {
    this.service()
      .then((client) =>
        client.request('layout.set', { popouts: this.popouts } satisfies Partial<Layout>),
      )
      .catch((error: unknown) => console.error(error));
  }

  /** Where a new popout goes: one page wide, at the side of the screen the main window is on. */
  private place(): WindowSize {
    const area = screen.getDisplayMatching(
      this.main()?.getBounds() ?? screen.getPrimaryDisplay().bounds,
    ).workArea;
    const width = Math.min(860, area.width);
    const height = Math.min(960, area.height);
    return {
      width,
      height,
      x: area.x + area.width - width,
      y: area.y + Math.round((area.height - height) / 2),
    };
  }
}
