import type { ChatId } from './agents';
import type { CommandName, CommandRequest, CommandResponse } from './commands';
import type { EventName, EventPayload } from './events';

export type Platform = 'mac' | 'windows' | 'linux';

/**
 * Everything a window can reach. The preload script exposes it as
 * `window.grimoire`; windows have no other access to Node or the file system.
 */
export interface GrimoireBridge {
  readonly platform: Platform;
  invoke<K extends CommandName>(
    command: K,
    request: CommandRequest<K>,
  ): Promise<CommandResponse<K>>;
  /** Returns a function that stops listening. */
  on<K extends EventName>(event: K, listener: (payload: EventPayload<K>) => void): () => void;
  /** Asks for a folder with the system's folder picker; null when you cancel. */
  chooseFolder(): Promise<string | null>;
  /** Asks for files with the system's file picker; none when you cancel. */
  chooseFiles(): Promise<string[]>;
  /** Where a dropped file is on disk; empty when it isn't a file on disk, such as a picture dragged from a web page. */
  pathOf(file: File): string;
  readonly window: WindowControls;
  /**
   * Pops a chat out of the main window into a window of its own, a popout,
   * or brings its window to the front when it's out already.
   */
  popOut(chatId: ChatId): void;
  /**
   * Tells the main window when a popout's window closes, so its chat comes
   * back. Returns a function that stops listening.
   */
  onPopoutClosed(listener: (chatId: ChatId) => void): () => void;
  /** Opens a web page in the system's browser; only https addresses open. */
  openExternal(url: string): void;
}

/** For the window controls Grimoire draws itself (Windows and Linux). */
export interface WindowControls {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}
