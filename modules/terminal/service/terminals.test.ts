import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { EventName, EventPayload } from '@grimoire/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultShell, shellEnv, spawnPty, type Pty, type Shell } from './shell';
import { Terminals } from './terminals';

type Sent = { event: EventName; payload: unknown };

/** A shell that writes what the test says and remembers what it was sent. */
class FakePty implements Pty {
  written: string[] = [];
  sizes: Array<[number, number]> = [];
  killed = false;
  private data?: (data: string) => void;
  private exit?: (code: number) => void;

  onData(listener: (data: string) => void): void {
    this.data = listener;
  }
  onExit(listener: (code: number) => void): void {
    this.exit = listener;
  }
  write(data: string): void {
    this.written.push(data);
  }
  resize(cols: number, rows: number): void {
    this.sizes.push([cols, rows]);
  }
  kill(): void {
    this.killed = true;
  }
  print(data: string): void {
    this.data?.(data);
  }
  end(code: number): void {
    this.exit?.(code);
  }
}

const fakeShell: Shell = { file: 'fake', args: [], name: 'fake' };

function setUp() {
  const sent: Sent[] = [];
  const ptys: FakePty[] = [];
  const spawned: Array<{ cwd: string; cols: number; rows: number }> = [];
  const terminals = new Terminals(
    <K extends EventName>(event: K, payload: EventPayload<K>) => sent.push({ event, payload }),
    {
      shell: () => fakeShell,
      spawn: (_shell, options) => {
        spawned.push(options);
        const pty = new FakePty();
        ptys.push(pty);
        return pty;
      },
      batchMs: 1,
      scrollback: 100,
    },
  );
  return { terminals, sent, ptys, spawned };
}

const outputs = (sent: Sent[]) =>
  sent
    .filter((s) => s.event === 'terminal.output')
    .map((s) => s.payload as EventPayload<'terminal.output'>);

describe('Terminals', () => {
  it('starts a shell in the folder at the size asked, and lists it', () => {
    const { terminals, spawned } = setUp();
    const info = terminals.open({ cwd: '/work', cols: 100.6, rows: 0 });
    expect(spawned).toEqual([{ cwd: '/work', cols: 100, rows: 24 }]);
    expect(info).toMatchObject({ cwd: '/work', shell: 'fake' });
    expect(terminals.list()).toEqual([info]);
  });

  it('sends output in batches, numbered in order', async () => {
    const { terminals, sent, ptys } = setUp();
    const { id } = terminals.open({ cwd: '/work', cols: 80, rows: 24 });
    ptys[0]!.print('one ');
    ptys[0]!.print('two');
    await delay(10);
    ptys[0]!.print('three');
    await delay(10);
    expect(outputs(sent)).toEqual([
      { id, seq: 1, data: 'one two' },
      { id, seq: 2, data: 'three' },
    ]);
  });

  it('draws the screen again with everything written so far', async () => {
    const { terminals, ptys } = setUp();
    const { id } = terminals.open({ cwd: '/work', cols: 40, rows: 5 });
    ptys[0]!.print('first line\r\n\x1b[31mred\x1b[0m');
    const screen = await terminals.screen(id);
    expect(screen).toMatchObject({ seq: 1, cols: 40, rows: 5 });
    expect(screen.data).toContain('first line');
    expect(screen.data).toContain('red');
  });

  it('types into the shell and resizes it and its screen', async () => {
    const { terminals, ptys } = setUp();
    const { id } = terminals.open({ cwd: '/work', cols: 80, rows: 24 });
    terminals.write(id, 'ls\r');
    terminals.resize(id, 120, 30);
    terminals.resize(id, 120, 30);
    expect(ptys[0]!.written).toEqual(['ls\r']);
    expect(ptys[0]!.sizes).toEqual([[120, 30]]);
    expect(await terminals.screen(id)).toMatchObject({ cols: 120, rows: 30 });
  });

  it('forgets a shell that ends, after sending what it wrote last', async () => {
    const { terminals, sent, ptys } = setUp();
    const { id } = terminals.open({ cwd: '/work', cols: 80, rows: 24 });
    ptys[0]!.print('bye');
    ptys[0]!.end(3);
    expect(sent.map((s) => s.event)).toEqual(['terminal.output', 'terminal.exited']);
    expect(sent[1]!.payload).toEqual({ id, exitCode: 3 });
    expect(terminals.list()).toEqual([]);
    expect(() => terminals.write(id, 'x')).toThrow('That terminal has ended');
  });

  it('kills a shell it closes, and says so once', () => {
    const { terminals, sent, ptys } = setUp();
    const { id } = terminals.open({ cwd: '/work', cols: 80, rows: 24 });
    terminals.close(id);
    ptys[0]!.end(1);
    terminals.close(id);
    expect(ptys[0]!.killed).toBe(true);
    expect(sent).toEqual([{ event: 'terminal.exited', payload: { id, exitCode: 0 } }]);
  });
});

describe('defaultShell', () => {
  it('uses PowerShell on Windows', () => {
    expect(defaultShell('win32', { PATH: '' })).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo'],
      name: 'powershell',
    });
  });

  it('uses your login shell elsewhere', () => {
    expect(defaultShell('darwin', { SHELL: '/opt/homebrew/bin/fish' })).toEqual({
      file: '/opt/homebrew/bin/fish',
      args: ['-l'],
      name: 'fish',
    });
    expect(defaultShell('darwin', {}).file).toBe('/bin/zsh');
    expect(defaultShell('linux', {}).file).toBe('/bin/bash');
  });
});

describe('shellEnv', () => {
  it("drops Electron's Node switch and says what the terminal can draw", () => {
    const env = shellEnv({ ELECTRON_RUN_AS_NODE: '1', HOME: '/me' }, 'darwin');
    expect(env).toEqual({
      HOME: '/me',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Grimoire',
      LANG: 'en_US.UTF-8',
    });
    expect(shellEnv({ LANG: 'de_DE.UTF-8' }, 'darwin')['LANG']).toBe('de_DE.UTF-8');
    expect(shellEnv({}, 'win32')['LANG']).toBeUndefined();
  });
});

describe('a real shell', () => {
  let folder: string | undefined;
  afterEach(() => folder && rmSync(folder, { recursive: true, force: true }));

  it('runs in a pseudo-terminal, in the folder given', async () => {
    folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-terminal-')));
    const sent: Sent[] = [];
    // Node stands in for the shell, the same on every system.
    const node: Shell = {
      file: process.execPath,
      args: ['-e', 'process.stdout.write("cwd=" + process.cwd() + " tty=" + process.stdout.isTTY)'],
      name: 'node',
    };
    const terminals = new Terminals(
      <K extends EventName>(event: K, payload: EventPayload<K>) => sent.push({ event, payload }),
      { shell: () => node, spawn: spawnPty, batchMs: 1 },
    );
    terminals.open({ cwd: folder, cols: 200, rows: 10 });
    const deadline = Date.now() + 15_000;
    while (!sent.some((s) => s.event === 'terminal.exited') && Date.now() < deadline)
      await delay(50);
    terminals.closeAll();

    const text = outputs(sent)
      .map((o) => o.data)
      .join('')
      .replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|[\r\n]/g, '');
    expect(text.toLowerCase()).toContain(`cwd=${folder} tty=true`.toLowerCase());
  }, 20_000);
});
