/** A shell the background service runs, shown as a tab in the Terminal. */
export interface TerminalInfo {
  id: string;
  /** The folder it started in. */
  cwd: string;
  /** The shell's name, such as "pwsh" or "zsh". */
  shell: string;
  /** When it started, in ms since the epoch. */
  openedAt: number;
  /** On Windows, the system's build number, which the screen needs to draw ConPTY's output right. */
  windowsBuild?: number;
}

/** What a terminal shows now, with its scrollback, as text to write into a fresh screen. */
export interface TerminalScreen {
  data: string;
  /** The last output it includes; later `terminal.output` events have a higher one. */
  seq: number;
  cols: number;
  rows: number;
}

declare module './commands' {
  interface CommandMap {
    /** The terminals running now, oldest first. */
    'terminal.list': { request: Record<string, never>; response: TerminalInfo[] };
    /** Starts your shell in the folder, at the size given. */
    'terminal.open': { request: { cwd: string; cols: number; rows: number }; response: TerminalInfo };
    /** What the terminal shows now, to draw it again after its page was closed. */
    'terminal.screen': { request: { id: string }; response: TerminalScreen };
    /** Types into the terminal. */
    'terminal.write': { request: { id: string; data: string }; response: void };
    'terminal.resize': { request: { id: string; cols: number; rows: number }; response: void };
    /** Ends the shell. */
    'terminal.close': { request: { id: string }; response: void };
  }
}

declare module './events' {
  interface EventMap {
    /** What the shell wrote, in order: each one's seq is one more than the last. */
    'terminal.output': { id: string; seq: number; data: string };
    /** The shell ended, by itself or because it was closed. */
    'terminal.exited': { id: string; exitCode: number };
  }
}
