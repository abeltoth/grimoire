import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { EventName, EventPayload, TerminalInfo, TerminalScreen } from '@grimoire/contract';
import type * as Headless from '@xterm/headless';
import type * as Serialize from '@xterm/addon-serialize';
import { defaultShell, spawnPty, windowsBuild, type Pty, type Shell, type SpawnPty } from './shell';

// Both packages are CommonJS whose exports Node's ESM loader can't see, so
// they're required, once the first terminal opens.
const require = createRequire(import.meta.url);
let screens: { Screen: typeof Headless.Terminal; SerializeAddon: typeof Serialize.SerializeAddon } | undefined;
const loadScreens = () =>
  (screens ??= {
    Screen: (require('@xterm/headless') as typeof Headless).Terminal,
    SerializeAddon: (require('@xterm/addon-serialize') as typeof Serialize).SerializeAddon,
  });

export type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

export interface TerminalsOptions {
  spawn?: SpawnPty;
  shell?: () => Shell;
  /** How long output collects before it's sent to windows, in ms. */
  batchMs?: number;
  /** How many lines scrolled off the top each terminal keeps. */
  scrollback?: number;
}

interface Running {
  info: TerminalInfo;
  pty: Pty;
  /** The terminal's screen kept here too, so a window can draw it again. */
  screen: Headless.Terminal;
  serializer: Serialize.SerializeAddon;
  /** The last output sent to windows, and the last the screen here has taken in. */
  seq: number;
  drawnSeq: number;
  pending: string;
  flushTimer?: NodeJS.Timeout;
}

/**
 * The shells the Scriptorium runs (ADR-010): they live in the background
 * service, so they keep running when the page or the app closes, and
 * windows draw them again from the screen kept here.
 */
export class Terminals {
  private readonly running = new Map<string, Running>();
  private readonly spawn: SpawnPty;
  private readonly shell: () => Shell;
  private readonly batchMs: number;
  private readonly scrollback: number;

  constructor(
    private readonly emit: Emit,
    options: TerminalsOptions = {},
  ) {
    this.spawn = options.spawn ?? spawnPty;
    this.shell = options.shell ?? (() => defaultShell());
    this.batchMs = options.batchMs ?? 8;
    this.scrollback = options.scrollback ?? 5000;
  }

  list(): TerminalInfo[] {
    return [...this.running.values()].map(({ info }) => info);
  }

  open({ cwd, cols, rows }: { cwd: string; cols: number; rows: number }): TerminalInfo {
    const size = fit(cols, rows);
    const shell = this.shell();
    const build = windowsBuild();
    const info: TerminalInfo = {
      id: randomUUID(),
      cwd,
      shell: shell.name,
      openedAt: Date.now(),
      ...(build ? { windowsBuild: build } : {}),
    };
    const { Screen, SerializeAddon } = loadScreens();
    const pty = this.spawn(shell, { cwd, ...size });
    const screen = new Screen({
      ...size,
      scrollback: this.scrollback,
      allowProposedApi: true,
      ...(build ? { windowsPty: { backend: 'conpty', buildNumber: build } } : {}),
    });
    const serializer = new SerializeAddon();
    screen.loadAddon(serializer as unknown as Headless.ITerminalAddon);
    const terminal: Running = { info, pty, screen, serializer, seq: 0, drawnSeq: 0, pending: '' };
    this.running.set(info.id, terminal);

    pty.onData((data) => this.output(terminal, data));
    pty.onExit((exitCode) => this.exited(terminal, exitCode));
    return info;
  }

  /** What the terminal shows now; waits until the screen here has taken in all its output. */
  async screen(id: string): Promise<TerminalScreen> {
    const terminal = this.get(id);
    this.flush(terminal);
    await new Promise<void>((resolve) => terminal.screen.write('', resolve));
    return {
      data: terminal.serializer.serialize({ scrollback: this.scrollback }),
      seq: terminal.drawnSeq,
      cols: terminal.screen.cols,
      rows: terminal.screen.rows,
    };
  }

  write(id: string, data: string): void {
    this.get(id).pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.get(id);
    const size = fit(cols, rows);
    if (size.cols === terminal.screen.cols && size.rows === terminal.screen.rows) return;
    terminal.pty.resize(size.cols, size.rows);
    terminal.screen.resize(size.cols, size.rows);
  }

  close(id: string): void {
    const terminal = this.running.get(id);
    if (!terminal) return;
    try {
      terminal.pty.kill();
    } catch {
      // It ended already.
    }
    // Some shells on Windows don't report that they ended once killed.
    this.exited(terminal, 0);
  }

  closeAll(): void {
    for (const id of [...this.running.keys()]) this.close(id);
  }

  private get(id: string): Running {
    const terminal = this.running.get(id);
    if (!terminal) throw new Error('That terminal has ended');
    return terminal;
  }

  private output(terminal: Running, data: string): void {
    terminal.pending += data;
    terminal.flushTimer ??= setTimeout(() => this.flush(terminal), this.batchMs);
  }

  /** Sends the collected output now, and gives it to the screen kept here. */
  private flush(terminal: Running): void {
    clearTimeout(terminal.flushTimer);
    terminal.flushTimer = undefined;
    if (!terminal.pending) return;
    const data = terminal.pending;
    const seq = ++terminal.seq;
    terminal.pending = '';
    terminal.screen.write(data, () => (terminal.drawnSeq = seq));
    this.emit('terminal.output', { id: terminal.info.id, seq, data });
  }

  private exited(terminal: Running, exitCode: number): void {
    if (this.running.get(terminal.info.id) !== terminal) return;
    this.flush(terminal);
    this.running.delete(terminal.info.id);
    // Once it has taken in what's left, so a screen being read still answers.
    terminal.screen.write('', () => terminal.screen.dispose());
    this.emit('terminal.exited', { id: terminal.info.id, exitCode });
  }
}

/** A size a pseudo-terminal accepts: whole, and at least one cell. */
function fit(cols: number, rows: number): { cols: number; rows: number } {
  const whole = (n: number, fallback: number) => (Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback);
  return { cols: whole(cols, 80), rows: whole(rows, 24) };
}
