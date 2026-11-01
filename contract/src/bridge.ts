import type { CommandName, CommandRequest, CommandResponse } from './commands';
import type { EventName, EventPayload } from './events';

export type Platform = 'mac' | 'windows' | 'linux';

/**
 * Everything a window can reach. The preload script exposes it as
 * `window.grimoire`; windows have no other access to Node or the file system.
 */
export interface GrimoireBridge {
  readonly platform: Platform;
  invoke<K extends CommandName>(command: K, request: CommandRequest<K>): Promise<CommandResponse<K>>;
  /** Returns a function that stops listening. */
  on<K extends EventName>(event: K, listener: (payload: EventPayload<K>) => void): () => void;
  /** Asks for a folder with the system's folder picker; null when you cancel. */
  chooseFolder(): Promise<string | null>;
  readonly window: WindowControls;
}

/** For the window controls Grimoire draws itself (Windows and Linux). */
export interface WindowControls {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}
