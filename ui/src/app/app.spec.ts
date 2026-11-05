import { TestBed } from '@angular/core/testing';
import type {
  CommandName,
  CommandRequest,
  EventName,
  EventPayload,
  GitBranches,
  GitStatus,
  GrimoireBridge,
  GrimoireSettings,
  OpenChat,
  PingResult,
  Preset,
  PullRequest,
  ScheduleInfo,
  ScheduleRun,
} from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { clock, dateline, upcoming, when } from '../../../modules/schedules/ui/wording';
import { App } from './app';
import { appConfig } from './app.config';
import { GRIMOIRE_BRIDGE } from './core/bridge';

const ping: PingResult = {
  pid: 4242,
  buildId: 'b1',
  startedAt: 0,
  uptimeMs: 65_000,
  node: '24.22.1',
};

/** A bridge to a fake service: answers commands and lets tests send events. */
function fakeBridge(overrides: Partial<GrimoireBridge> = {}) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const calls: { command: string; request: unknown }[] = [];
  const answers: Partial<Record<CommandName, (request: never) => unknown>> = {
    'core.ping': () => ping,
    'agents.list': () => [{ id: 'claude-code', name: 'Claude Code', capabilities: [] }],
    'agents.start': (request: CommandRequest<'agents.start'>): OpenChat => ({
      id: 'chat-1',
      agent: request.agent,
      title: '',
      settings: { cwd: 'C:/work/grimoire', ...request.settings },
      status: 'thinking',
      entries: [{ kind: 'user', id: 'u1', text: request.text }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],

      tags: [],
      copied: [],
    }),
    'agents.unqueue': () => true,
    'agents.interrupt': () => [],
    'agents.openChats': () => [],
    'agents.chats': () => [],
    'agents.models': () => ({
      models: [
        { id: 'opus', name: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], effort: 'xhigh' },
        { id: 'sonnet', name: 'Sonnet 5.5', efforts: ['low', 'medium', 'high', 'max'] },
        { id: 'haiku', name: 'Haiku 5.5' },
      ],
      default: 'opus',
    }),
    'agents.folders': () => ({
      home: 'C:/Users/me',
      recent: ['C:/Users/me/git/grimoire', 'C:/Users/me', 'C:/Users/me/git/breeder', 'D:/old'],
    }),
    'layout.get': () => ({ current: null, lastUsed: null }),
  };
  const bridge: GrimoireBridge = {
    platform: 'windows',
    invoke: (async (command: CommandName, request: never) => {
      calls.push({ command, request });
      return answers[command]?.(request);
    }) as GrimoireBridge['invoke'],
    on: (event, listener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (payload: unknown) => void);
      listeners.set(event, set);
      return () => set.delete(listener as (payload: unknown) => void);
    },
    window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
    chooseFolder: vi.fn(async () => 'C:/Users/me/git/new'),
    chooseFiles: vi.fn(async (): Promise<string[]> => []),
    pathOf: vi.fn(() => ''),
    ...overrides,
  };
  const emit = <K extends EventName>(event: K, payload: EventPayload<K>) =>
    listeners.get(event)?.forEach((listener) => listener(payload));
  return { bridge, calls, emit, answers };
}

async function render(bridge: GrimoireBridge) {
  TestBed.configureTestingModule({
    providers: [...appConfig.providers, { provide: GRIMOIRE_BRIDGE, useValue: bridge }],
  });
  const fixture = TestBed.createComponent(App);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const texts = (selector: string) =>
    [...el.querySelectorAll(selector)].map((node) => node.textContent!.replace(/\s+/g, ' ').trim());
  return { fixture, el, texts };
}

/** Clicks the settings card's choice with this text. */
function pick(el: HTMLElement, text: string) {
  const choices = [...el.querySelectorAll<HTMLButtonElement>('gr-settings-card .choice')];
  const choice = choices.find((c) => c.textContent!.replace(/\s+/g, ' ').trim().startsWith(text));
  if (!choice) throw new Error(`No choice ${text}`);
  choice.click();
}

async function write(fixture: { whenStable(): Promise<unknown> }, el: HTMLElement, text: string) {
  const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
  entry.value = text;
  entry.dispatchEvent(new Event('input'));
  entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  await fixture.whenStable();
}

/** A few bytes, as a picture file. */
function picture(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

/** A paste or drop carrying these files. */
function withFiles(type: 'paste' | 'drop', files: File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const holder = type === 'paste' ? 'clipboardData' : 'dataTransfer';
  Object.defineProperty(event, holder, { value: { files, types: ['Files'] } });
  return event;
}

describe('App', () => {
  it('marks the background service connected once it answers', async () => {
    const { el } = await render(fakeBridge().bridge);
    expect(el.getAttribute('data-service-state')).toBe('connected');
    expect(el.textContent).not.toContain('Background service unreachable');
  });

  it('says in the running foot when the service is unreachable', async () => {
    const { el } = await render(
      fakeBridge({ invoke: () => Promise.reject(new Error('pipe closed')) }).bridge,
    );
    expect(el.getAttribute('data-service-state')).toBe('failed');
    const alert = el.querySelector('gr-status-indicators .alert')!;
    expect(alert.textContent).toContain('Background service unreachable');
    expect(alert.getAttribute('title')).toBe('pipe closed');
  });

  it('draws window controls on Windows and wires them', async () => {
    const { bridge } = fakeBridge();
    const { el } = await render(bridge);
    el.querySelector<HTMLButtonElement>('[aria-label="Minimize window"]')!.click();
    el.querySelector<HTMLButtonElement>('[aria-label="Close window"]')!.click();
    expect(bridge.window.minimize).toHaveBeenCalledOnce();
    expect(bridge.window.close).toHaveBeenCalledOnce();
  });

  it('leaves the window controls to macOS', async () => {
    const { el } = await render(fakeBridge({ platform: 'mac' }).bridge);
    expect(el.querySelector('[aria-label="Close window"]')).toBeNull();
  });

  it('shows the registered thumb tabs, then the Index', async () => {
    const { texts } = await render(fakeBridge().bridge);
    expect(texts('gr-thumb-index button')).toEqual([
      'Table of contents',
      'Front matter',
      'Kanban',
      'Memory map',
      'Scheduled chats',
      'Ledger',
      'Scriptorium',
      'Colophon',
      'Index Ctrl K',
    ]);
  });

  it('prints shortcuts the way the platform writes them', async () => {
    const mac = await render(fakeBridge({ platform: 'mac' }).bridge);
    expect(mac.el.querySelector('gr-thumb-index .index')!.getAttribute('aria-label')).toBe(
      'Index, the command palette. Command K',
    );
    expect(mac.texts('gr-thumb-index .gr-kbd')).toEqual(['⌘K']);
    expect(mac.texts('gr-ribbon.new i')).toEqual(['Last settings · ⌘N']);
    TestBed.resetTestingModule();

    const windows = await render(fakeBridge().bridge);
    expect(windows.el.querySelector('gr-thumb-index .index')!.getAttribute('aria-label')).toBe(
      'Index, the command palette. Control K',
    );
    expect(windows.texts('gr-ribbon.new i')).toEqual(['Last settings · Ctrl+N']);
  });

  it('opens on a blank chapter', async () => {
    const { texts } = await render(fakeBridge().bridge);
    expect(texts('gr-running-head h1')).toEqual(['Untitled chapter']);
    expect(texts('.meta button')).toEqual([
      'Claude Code',
      'Opus 5.5',
      'Extra high effort',
      'Ask first',
      '~',
      'No preset',
    ]);
    expect(texts('.spine gr-ribbon b')).toEqual(['Untitled chapter']);
    expect(texts('.spine gr-ribbon i')).toEqual(['Claude Code · blank page']);
    expect(texts('.right-half gr-ribbon b')).toEqual(['New chapter']);
    expect(texts('gr-chapter-opening p')).toEqual([
      'A new chapter',
      expect.stringMatching(/^Begun at .+, to be written by Claude Code$/),
      'Write your first entry on the page below. Claude Code works in your home folder and asks before it edits a file or runs a command.',
    ]);
    expect(document.querySelector('#gr-next-entry')!.getAttribute('placeholder')).toBe(
      'Write the first entry…',
    );
    expect(texts('gr-transcript')).toEqual([]);
  });

  it('times the running turn by Stop, and keeps how long each turn took', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fix the flaky login test');
    const user = { kind: 'user' as const, id: 'u1', text: 'Fix the flaky login test' };
    emit('agents.entry', { chatId: 'chat-1', entry: { ...user, at: Date.now() - 134_000 } });
    await fixture.whenStable();
    expect(texts('.stop')).toEqual(['Stop Esc 2m 14s']);
    expect(texts('.you .took')).toEqual(['2m 14s']);

    emit('agents.entry', { chatId: 'chat-1', entry: { ...user, at: Date.now() - 200_000, took: 200_000 } });
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(texts('.stop')).toEqual([]);
    expect(texts('.you .took')).toEqual(['3m 20s']);
    expect(el.querySelector('.you .took')!.getAttribute('title')).toBe('This turn took 3m 20s');
  });

  it('starts the chat with the first entry and follows its events', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);

    await write(fixture, el, 'Fix the flaky login test');
    expect(calls.find((c) => c.command === 'agents.start')!.request).toEqual({
      agent: 'claude-code',
      settings: {},
      text: 'Fix the flaky login test',
    });
    expect(el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!.value).toBe('');
    expect(texts('.you p')).toEqual(['Fix the flaky login test']);
    expect(texts('.meta button')[4]).toBe('C:/work/grimoire');
    expect(texts('.stop')).toEqual(['Stop Esc']);

    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          {
            kind: 'tool',
            id: 't1',
            tool: 'Read',
            input: { file_path: 'C:\\work\\grimoire\\src\\login.spec.ts' },
          },
        ],
      },
    });
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: { kind: 'agent', id: 'a2', blocks: [{ kind: 'text', text: 'The test ' }] },
    });
    emit('agents.text', { chatId: 'chat-1', entryId: 'a2', block: 0, text: 'races the timer.' });
    emit('agents.status', { chatId: 'chat-1', status: 'writing' });
    emit('agents.title', { chatId: 'chat-1', title: 'Fix flaky login test' });
    await fixture.whenStable();

    expect(texts('.reply .who')).toEqual(['Claude Code']);
    expect(texts('.reply gr-markdown p')).toEqual(['The test races the timer. Stop Esc']);
    expect(texts('.note .note-head')).toEqual(['*Read']);
    expect(texts('.note .target')).toEqual(['login.spec.ts']);
    expect(el.querySelector('.note')!.getAttribute('title')).toBe('src/login.spec.ts');
    expect(texts('.note .detail')).toEqual(['running…']);
    expect(el.querySelector('.reply gr-markdown p .quill')).not.toBeNull();
    expect(texts('gr-running-head h1')).toEqual(['Fix flaky login test']);
    // A title too long for its line is cut short; pointing at it shows it all.
    expect(el.querySelector('gr-running-head h1')!.getAttribute('title')).toBe('Fix flaky login test');
    expect(texts('[aria-current="page"] b')).toEqual(['Fix flaky login test']);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · writing']);

    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    emit('agents.turnEnded', { chatId: 'chat-1', error: 'The agent stopped unexpectedly.' });
    await fixture.whenStable();
    expect(texts('.stop')).toEqual([]);
    expect(texts('[role="alert"]')).toEqual(['The agent stopped unexpectedly.']);
  });

  it('sends later entries to the running chat, and Esc stops it', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'First');
    await write(fixture, el, 'Second');
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: 'Second' },
    ]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(calls.filter((c) => c.command === 'agents.interrupt').map((c) => c.request)).toEqual([
      { chatId: 'chat-1' },
    ]);
  });

  it('shows entries queued during a turn; Edit and Remove take them out', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Add the meter');
    emit('agents.queued', {
      chatId: 'chat-1',
      queued: [
        { id: 'q1', text: 'Also add a tooltip.' },
        { id: 'q2', text: 'And a test.' },
      ],
    });
    await fixture.whenStable();
    expect(texts('.queued-text')).toEqual(['Also add a tooltip.', 'And a test.']);
    expect(texts('.queued-when')).toEqual([
      'sends when this turn ends',
      'sends when this turn ends',
    ]);

    const buttons = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('.queued button')].filter(
        (b) => b.textContent!.trim() === label,
      );
    buttons('Edit')[0]!.click();
    buttons('Remove')[1]!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.unqueue').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', id: 'q1' },
      { chatId: 'chat-1', id: 'q2' },
    ]);
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    expect(entry.value).toBe('Also add a tooltip.');
    expect(document.activeElement).toBe(entry);
  });

  it('shows how much of the page allowance the chapter uses', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    expect(el.querySelector('.allowance')).toBeNull();
    await write(fixture, el, 'Add the meter');
    emit('agents.context', { chatId: 'chat-1', context: { used: 124_000, limit: 200_000 } });
    await fixture.whenStable();
    expect(texts('.allowance > *')).toEqual(['', '62%', 'of the chapter’s page allowance']);
    expect(el.querySelector('.allowance')!.getAttribute('aria-valuenow')).toBe('62');
    expect(el.querySelector<HTMLElement>('.allowance .used')!.style.width).toBe('62%');
  });

  it('puts the queued entries back on the page when you stop the turn', async () => {
    const { bridge, emit, answers } = fakeBridge();
    answers['agents.interrupt'] = () => [{ id: 'q1', text: 'Also add a tooltip.' }];
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'Add the meter');
    emit('agents.status', { chatId: 'chat-1', status: 'writing' });
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry.value = 'Half a thought';
    entry.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(entry.value).toBe('Half a thought\n\nAlso add a tooltip.');
  });

  it('sets replies as markdown and numbers listings through the chapter', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Add the meter');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          { kind: 'text', text: 'The meter reads `usage`:\n\n- shows a share\n- warns at **80%**' },
        ],
      },
    });
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a2',
        blocks: [
          {
            kind: 'text',
            text: "```ts\nconst used = 1;\n```\n\nAnd the spec:\n\n```ts\nit('shows",
          },
        ],
      },
    });
    emit('agents.status', { chatId: 'chat-1', status: 'writing' });
    await fixture.whenStable();

    expect(texts('.reply gr-markdown > p')).toEqual(['The meter reads usage:', 'And the spec:']);
    expect(texts('.reply gr-markdown code')).toEqual(['usage']);
    expect(texts('.reply gr-markdown li')).toEqual(['shows a share', 'warns at 80%']);
    expect(texts('.reply gr-markdown li strong')).toEqual(['80%']);
    expect(texts('gr-listing figcaption')).toEqual(['Listing 1 · ts', 'Listing 2 · ts']);
    expect(texts('gr-listing .line')).toEqual(['const used = 1;', "it('shows Stop Esc"]);
    // The listing still being written stays open, with the quill on its last line.
    const listings = el.querySelectorAll('gr-listing .code');
    expect([...listings].map((l) => l.classList.contains('open'))).toEqual([false, true]);
    expect(el.querySelector('gr-listing:last-of-type .line .quill')).not.toBeNull();
  });

  it('sums up a run of margin notes, and folds them out to the corrections or the output', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Add the meter');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          {
            kind: 'tool',
            id: 't1',
            tool: 'Edit',
            input: {
              file_path: 'C:/work/grimoire/src/meter.ts',
              old_string: 'const a = 1;',
              new_string: 'const used = 1;\nconst limit = 2;',
            },
            result: { text: 'Updated.', isError: false },
          },
          {
            kind: 'tool',
            id: 't2',
            tool: 'Bash',
            input: { command: 'npm test' },
            result: { text: '\u001b[32m12 passed\u001b[0m\n1 failed\n', isError: true },
          },
          { kind: 'text', text: 'One test fails.' },
        ],
      },
    });
    await fixture.whenStable();

    expect(texts('.note.summary > *')).toEqual(['Changed 1 file, ran 1 command', '+2 −1', '1 failed']);
    const run = el.querySelector<HTMLButtonElement>('.note.summary')!;
    expect(run.getAttribute('aria-expanded')).toBe('false');

    run.click();
    await fixture.whenStable();
    expect(run.getAttribute('aria-expanded')).toBe('true');
    expect(texts('.run .note > *')).toEqual(['*Edited', 'meter.ts', '+2 −1', '†Ran', 'npm test', 'failed']);
    expect(el.querySelector('gr-corrections, gr-output')).toBeNull();

    const notes = el.querySelectorAll<HTMLButtonElement>('.run .note');
    notes[0]!.click();
    notes[1]!.click();
    await fixture.whenStable();
    expect(notes[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(texts('gr-corrections .head b')).toEqual(['src/meter.ts']);
    expect(texts('gr-corrections .head .detail')[0]).toBe('corrections, as marked by Claude Code');
    expect(texts('gr-output .head > *')).toEqual(['npm test', 'output']);
    expect(texts('gr-output .line')).toEqual(['12 passed', '1 failed']);

    notes[0]!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-corrections')).toBeNull();
  });

  it('says why a chapter could not start', async () => {
    const { bridge } = fakeBridge();
    const answer = bridge.invoke;
    bridge.invoke = ((command: CommandName, request: never) =>
      command === 'agents.start'
        ? Promise.reject(new Error('Claude Code is not signed in'))
        : answer(command, request)) as GrimoireBridge['invoke'];
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Hello');
    expect(texts('[role="alert"]')).toEqual(['Claude Code is not signed in']);
    expect(texts('gr-running-head h1')).toEqual(['Untitled chapter']);
  });

  it('keeps Shift+Enter for a new line', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el } = await render(bridge);
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry.value = 'Line one';
    entry.dispatchEvent(new Event('input'));
    entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    await fixture.whenStable();
    expect(calls.some((c) => c.command === 'agents.start')).toBe(false);
  });

  it('opens a new blank chapter from the New chapter ribbon', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    el.querySelector<HTMLButtonElement>('.meta [data-setting="folder"]')!.click();
    await fixture.whenStable();
    pick(el, '~/git/grimoire');
    await write(fixture, el, 'Fix the flaky login test');

    el.querySelector<HTMLButtonElement>('gr-ribbon.new button')!.click();
    await fixture.whenStable();
    expect(texts('gr-running-head h1')).toEqual(['Untitled chapter']);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
    // The ribbons keep the order the chapters were opened in.
    expect(texts('gr-ribbon.chapter i')).toEqual([
      'Claude Code · thinking',
      'Claude Code · blank page',
    ]);
    expect(texts('.spine gr-ribbon i')).toEqual(['Claude Code · blank page']);
    // The new chapter takes the settings last used.
    expect(texts('.meta button')[4]).toBe('~/git/grimoire');

    // The book opens at the first chapter: the one after it moves right of the spine.
    [...el.querySelectorAll<HTMLButtonElement>('gr-ribbon.chapter button')][0]!.click();
    await fixture.whenStable();
    expect(texts('.you p')).toEqual(['Fix the flaky login test']);
    expect(texts('.left-half gr-ribbon')).toEqual([]);
    expect(texts('.spine gr-ribbon i')).toEqual(['Claude Code · thinking']);
    expect(texts('.right-half gr-ribbon.chapter i')).toEqual(['Claude Code · blank page']);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · thinking']);
  });

  it('keeps what you wrote on a chapter, unsent, while you turn to another', async () => {
    const { bridge, calls } = fakeBridge({
      chooseFiles: vi.fn(async () => ['C:/work/grimoire/notes.txt']),
    });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fix the flaky login test');
    const entry = () => el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry().value = 'Half a thought';
    entry().dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('[aria-label="Attach files or a screenshot"]')!.click();
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('gr-ribbon.new button')!.click();
    await fixture.whenStable();
    expect(entry().value).toBe('');
    expect(el.querySelector('gr-composer gr-enclosures')).toBeNull();

    [...el.querySelectorAll<HTMLButtonElement>('gr-ribbon.chapter button')][0]!.click();
    await fixture.whenStable();
    expect(entry().value).toBe('Half a thought');
    expect(texts('gr-composer .ref code')).toEqual(['notes.txt']);
    expect(calls.filter((c) => c.command === 'agents.send')).toEqual([]);
  });

  it('changes a blank chapter\'s settings on its settings card', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    const model = el.querySelector<HTMLButtonElement>('.meta [data-setting="model"]')!;
    model.click();
    await fixture.whenStable();

    expect(model.getAttribute('aria-expanded')).toBe('true');
    expect(texts('gr-settings-card .column.on h3')).toEqual(['Model for Claude Code']);
    expect(texts('gr-settings-card [aria-checked="true"]')).toEqual([
      'Claude Code',
      'Opus 5.5',
      'Extra high',
      '~',
      'Ask first Asks before edits and commands',
      'No preset',
    ]);
    expect(texts('gr-settings-card [data-setting="folder"] code')).toEqual([
      '~',
      '~/git/grimoire',
      '~/git/breeder',
    ]);
    expect(document.activeElement?.textContent?.trim()).toBe('Opus 5.5');

    pick(el, 'Sonnet 5.5');
    await fixture.whenStable();
    // Sonnet takes no Extra high, and your settings give it no effort.
    expect(texts('gr-settings-card [data-setting="effort"] h3')).toEqual(['Effort for Sonnet 5.5']);
    expect(texts('gr-settings-card [data-setting="effort"] .choice')).toEqual(['Low', 'Medium', 'High', 'Max']);
    expect(texts('.meta button')[2]).toBe('Default effort');
    pick(el, 'Max');
    pick(el, 'Full access');
    pick(el, 'Choose another folder');
    await fixture.whenStable();
    expect(texts('.meta button')).toEqual([
      'Claude Code',
      'Sonnet 5.5',
      'Max effort',
      'Full access',
      '~/git/new',
      'No preset',
    ]);
    expect(calls.filter((c) => c.command === 'layout.set').at(-1)?.request).toEqual({
      lastUsed: {
        agent: 'claude-code',
        settings: { model: 'sonnet', effort: 'max', mode: 'allow-all', cwd: 'C:/Users/me/git/new' },
      },
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(el.querySelector('gr-settings-card')).toBeNull();
    expect(document.activeElement).toBe(model);

    await write(fixture, el, 'Hello');
    expect(calls.find((c) => c.command === 'agents.start')?.request).toMatchObject({
      settings: { model: 'sonnet', mode: 'allow-all', cwd: 'C:/Users/me/git/new' },
    });
  });

  it('begins a chapter in a worktree of its own when asked', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.start'] = (request: CommandRequest<'agents.start'>): OpenChat => ({
      id: 'chat-1',
      agent: request.agent,
      title: '',
      settings: { ...request.settings, cwd: 'C:/Users/me/git/grimoire/.claude/worktrees/hello', worktree: true },
      status: 'thinking',
      entries: [{ kind: 'user', id: 'u1', text: request.text }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
    });
    const { fixture, el, texts } = await render(bridge);
    el.querySelector<HTMLButtonElement>('.meta [data-setting="folder"]')!.click();
    await fixture.whenStable();
    pick(el, '~/git/grimoire');
    await fixture.whenStable();
    const worktree = () => el.querySelector('gr-settings-card [role="checkbox"]')!;
    expect(worktree().getAttribute('aria-checked')).toBe('false');

    pick(el, 'In a worktree of its own');
    await fixture.whenStable();
    expect(worktree().getAttribute('aria-checked')).toBe('true');
    expect(texts('.meta [data-setting="folder"]')).toEqual(['~/git/grimoire, own worktree']);
    expect(texts('gr-chapter-opening .note')[0]).toContain(
      'works in a worktree of its own, on a branch of its own, made from C:/Users/me/git/grimoire',
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await write(fixture, el, 'Hello');
    expect(calls.find((c) => c.command === 'agents.start')?.request).toMatchObject({
      settings: { cwd: 'C:/Users/me/git/grimoire', worktree: true },
    });
    expect(texts('.meta [data-setting="folder"]')).toEqual(['~/git/grimoire/.claude/worktrees/hello']);

    // Once begun, it stays in its worktree.
    el.querySelector<HTMLButtonElement>('.meta [data-setting="folder"]')!.click();
    await fixture.whenStable();
    expect(worktree().getAttribute('aria-checked')).toBe('true');
    expect(worktree().getAttribute('aria-disabled')).toBe('true');
  });

  it('brings back your earlier entries with Up, and sends one with Enter', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'Hello');
    emit('agents.entry', { chatId: 'chat-1', entry: { kind: 'user', id: 'u2', text: 'Add a meter' } });
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    const press = async (key: string) => {
      entry.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };

    await press('ArrowUp');
    expect(entry.value).toBe('Add a meter');
    await press('ArrowUp');
    expect(entry.value).toBe('Hello');
    await press('ArrowUp');
    expect(entry.value).toBe('Hello');
    await press('ArrowDown');
    expect(entry.value).toBe('Add a meter');
    await press('ArrowDown');
    expect(entry.value).toBe('');

    await press('ArrowUp');
    await press('Enter');
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: 'Add a meter' },
    ]);
    expect(entry.value).toBe('');

    // Once you change what came back, Up is the caret's again.
    await press('ArrowUp');
    entry.value = 'Add a meter, please';
    entry.dispatchEvent(new Event('input'));
    await press('ArrowUp');
    expect(entry.value).toBe('Add a meter, please');
  });

  it('says what the next entry re-reads once the prompt cache has run out, and offers to compact first', async () => {
    const { bridge, calls, emit, answers } = fakeBridge();
    answers['agents.list'] = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['compact'] }];
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Hello');
    emit('agents.cache', { chatId: 'chat-1', cache: { tokens: 283_412, until: Date.now() - 3 * 3_600_000 } });
    // Not while a turn runs: it's reading them already.
    await fixture.whenStable();
    expect(el.querySelector('gr-composer .cold')).toBeNull();

    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(texts('gr-composer .cold')).toEqual([
      'Cache expired 3 hours ago, so your next entry re-reads about 283k tokens Compact first',
    ]);
    el.querySelector<HTMLButtonElement>('gr-composer .cold button')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: '/compact' },
    ]);

    // A turn leaves a fresh cache.
    emit('agents.cache', { chatId: 'chat-1', cache: { tokens: 12_000, until: Date.now() + 3_600_000 } });
    await fixture.whenStable();
    expect(el.querySelector('gr-composer .cold')).toBeNull();
  });

  it('changes only the model and permission once the chapter has begun', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Hello');
    el.querySelector<HTMLButtonElement>('.meta [data-setting="mode"]')!.click();
    await fixture.whenStable();

    expect(texts('gr-settings-card .card-head span')).toEqual([
      'Its agent and folder stay as it began. Pick to change the rest.',
    ]);
    expect(
      texts('gr-settings-card [data-setting="folder"] .choice[aria-disabled]'),
    ).toEqual(['~/git/grimoire', '~']);
    expect(texts('gr-settings-card .action')).toEqual(['Save these settings as a preset…']);

    pick(el, 'Plan only');
    pick(el, 'Medium');
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.configure').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', change: { mode: 'plan' } },
      { chatId: 'chat-1', change: { effort: 'medium' } },
    ]);
    emit('agents.settings', {
      chatId: 'chat-1',
      settings: { cwd: 'C:/work/grimoire', mode: 'plan', effort: 'medium' },
    });
    await fixture.whenStable();
    expect(texts('.meta button').slice(2, 4)).toEqual(['Medium effort', 'Plan only']);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-settings-card')).toBeNull();
  });

  it('opens a chapter\'s settings from a right-click on its ribbon', async () => {
    const { fixture, el, texts } = await render(fakeBridge().bridge);
    el.querySelector('gr-ribbon.chapter button')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(texts('gr-settings-card .column.on h3')).toEqual(['Agent']);
  });

  it('undoes an entry\'s edits, and marks them withdrawn', async () => {
    const { bridge, calls, emit, answers } = fakeBridge();
    const edit = (id: string, file: string) => ({
      kind: 'tool' as const,
      id,
      tool: 'Edit',
      input: { file_path: `C:/work/grimoire/${file}`, old_string: 'a', new_string: 'b' },
      result: { text: 'ok', isError: false },
    });
    answers['agents.openChats'] = (): OpenChat[] => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Context meter',
        settings: { cwd: 'C:/work/grimoire' },
        status: 'idle',
        entries: [
          { kind: 'user', id: 'u1', text: 'Add a meter' },
          { kind: 'agent', id: 'a1', blocks: [edit('t1', 'meter.ts'), { kind: 'text', text: 'Added.' }] },
          { kind: 'user', id: 'u2', text: 'Colour it' },
          {
            kind: 'agent',
            id: 'a2',
            blocks: [
              { kind: 'tool', id: 't2', tool: 'Read', input: { file_path: 'C:/work/grimoire/meter.css' }, result: { text: 'x', isError: false } },
              edit('t3', 'meter.css'),
              { kind: 'text', text: 'Coloured.' },
            ],
          },
        ],
        approvals: [],
        queued: [],
        plan: [],
        withdrawn: [],
        dogEars: [],

        tags: [],
        copied: [],
      },
    ];
    answers['layout.get'] = () => ({ current: 'c1' });
    const { fixture, el, texts } = await render(bridge);
    const undoes = () => [...el.querySelectorAll<HTMLButtonElement>('.you .by button')].filter((b) => b.textContent!.trim() === 'Undo');
    expect(undoes().map((b) => b.getAttribute('aria-disabled'))).toEqual([null, null]);
    expect(texts('.you')).toHaveLength(2);

    undoes()[1]!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.undo').map((c) => c.request)).toEqual([
      { chatId: 'c1', entryId: 'u2' },
    ]);
    emit('agents.withdrawn', { chatId: 'c1', withdrawn: ['u2'] });
    await fixture.whenStable();
    expect(texts('.note .detail')).toEqual(['+1 −1', 'withdrawn']);
    // Only the first entry's edit is left to undo.
    expect(undoes().map((b) => b.getAttribute('aria-disabled'))).toEqual([null]);

    emit('agents.status', { chatId: 'c1', status: 'thinking' });
    await fixture.whenStable();
    expect(undoes().map((b) => b.getAttribute('aria-disabled'))).toEqual(['true']);
  });

  it('offers Undo only where it can restore files, and not on entries a fork copied', async () => {
    const { bridge, answers } = fakeBridge();
    const edit = (id: string) => ({
      kind: 'tool' as const,
      id,
      tool: 'Write',
      input: { file_path: 'C:/work/grimoire/a.ts', content: 'a' },
      result: { text: 'ok', isError: false },
    });
    const reply = (id: string, text: string) => ({ kind: 'agent' as const, id, blocks: [{ kind: 'text' as const, text }] });
    answers['agents.openChats'] = (): OpenChat[] => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Context meter (a)',
        settings: { cwd: 'C:/work/grimoire' },
        status: 'idle',
        entries: [
          { kind: 'user', id: 'u1', text: 'Copied, with an edit' },
          { kind: 'agent', id: 'a1', blocks: [edit('t1'), { kind: 'text', text: 'Wrote it.' }] },
          { kind: 'user', id: 'u2', text: 'Mine, with an edit' },
          { kind: 'agent', id: 'a2', blocks: [edit('t2'), { kind: 'text', text: 'Wrote it again.' }] },
          { kind: 'user', id: 'u3', text: 'Mine, only talk' },
          reply('a3', 'Just talk.'),
        ],
        approvals: [],
        queued: [],
        plan: [],
        withdrawn: [],
        dogEars: [],

        tags: [],
        copied: ['u1'],
      },
    ];
    answers['layout.get'] = () => ({ current: 'c1' });
    const { el } = await render(bridge);
    const undoable = [...el.querySelectorAll('.you')].map((you) =>
      [...you.querySelectorAll('.by button')].some((b) => b.textContent!.trim() === 'Undo'),
    );
    expect(undoable).toEqual([false, true, false]);
  });

  it('forks a chapter into a variant and turns to it', async () => {
    const { bridge, calls, answers } = fakeBridge();
    const chat = (id: string, title: string, status: OpenChat['status'] = 'idle'): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/work/grimoire' },
      status,
      entries: [{ kind: 'user', id: 'u1', text: 'Add a meter' }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],

      tags: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
    answers['layout.get'] = () => ({ current: 'c1' });
    answers['agents.fork'] = () => chat('c2', 'Context meter (a)');
    const { fixture, el, texts } = await render(bridge);
    const forkButton = () =>
      [...el.querySelectorAll<HTMLButtonElement>('.you .by button')].find((b) => b.textContent!.trim() === 'Fork')!;

    forkButton().click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.fork').map((c) => c.request)).toEqual([
      { chatId: 'c1', entryId: 'u1' },
    ]);
    expect(texts('gr-running-head h1')).toEqual(['Context meter (a)']);
    expect(texts('gr-ribbon b')).toEqual(['Context meter', 'Context meter (a)', 'New chapter']);
  });

  it('pins and stars a chapter with its dog-ears, but not a blank one', async () => {
    const { bridge, calls, emit, answers } = fakeBridge();
    answers['agents.openChats'] = (): OpenChat[] => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Context meter',
        settings: { cwd: 'C:/work/grimoire' },
        status: 'idle',
        entries: [{ kind: 'user', id: 'u1', text: 'Add a meter' }],
        approvals: [],
        queued: [],
        plan: [],
        withdrawn: [],
        dogEars: ['star'],

        tags: [],
        copied: [],
      },
    ];
    answers['layout.get'] = () => ({ current: 'c1' });
    const { fixture, el } = await render(bridge);
    const labels = () => [...el.querySelectorAll('gr-dog-ears button')].map((b) => b.getAttribute('aria-label'));
    expect(labels()).toEqual(['Pin this chapter', 'Starred. Unfold to unstar']);

    el.querySelector<HTMLButtonElement>('gr-dog-ears .pin')!.click();
    el.querySelector<HTMLButtonElement>('gr-dog-ears .star')!.click();
    expect(calls.filter((c) => c.command === 'agents.dogEar').map((c) => c.request)).toEqual([
      { chatId: 'c1', dogEar: 'pin', folded: true },
      { chatId: 'c1', dogEar: 'star', folded: false },
    ]);
    emit('agents.dogEars', { chatId: 'c1', dogEars: ['pin'] });
    await fixture.whenStable();
    expect(labels()).toEqual(['Pinned. Unfold to unpin', 'Star this chapter']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }));
    await fixture.whenStable();
    const blank = [...el.querySelectorAll('gr-dog-ears button')];
    expect(blank.map((b) => b.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    (blank[0] as HTMLButtonElement).click();
    expect(calls.filter((c) => c.command === 'agents.dogEar')).toHaveLength(2);
  });

  it('looks up actions and chapters in the Index, turned to with Ctrl+K', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.chats'] = () => [
      { id: 'c7', agent: 'claude-code', title: 'Old notes', cwd: 'C:/Users/me', updatedAt: 0, dogEars: ['pin', 'star'], tags: [] },
      { id: 'c8', agent: 'claude-code', title: 'Fix flaky login test', cwd: 'C:/Users/me/git/grimoire', updatedAt: 1, dogEars: ['star'], tags: [] },
      { id: 'c9', agent: 'claude-code', title: 'New onboarding flow', cwd: 'C:/Users/me/git/breeder', updatedAt: 2, dogEars: [], tags: [] },
    ];
    answers['agents.open'] = (request: CommandRequest<'agents.open'>): OpenChat => ({
      id: request.chatId,
      agent: request.agent,
      title: 'New onboarding flow',
      settings: request.settings,
      status: 'idle',
      entries: [{ kind: 'user', id: 'u1', text: 'Plan the onboarding' }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],

      tags: [],
      copied: [],
    });
    const { fixture, el, texts } = await render(bridge);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    // The chats arrive from the service a moment later.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(texts('gr-index-page h2')).toEqual(['Index']);
    expect(texts('gr-index-page h3')).toEqual(['Actions', 'Chapters']);
    // A pinned chapter stays at the top, however old.
    expect(texts('gr-index-page .entry .label')).toEqual([
      'New chapter',
      'New chapter from preset',
      'Close chapter',
      'Old notes',
      'New onboarding flow',
      'Fix flaky login test',
    ]);
    const field = el.querySelector<HTMLInputElement>('#gr-index-look-up')!;
    expect(document.activeElement).toBe(field);

    field.value = 'new';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-index-page .entry .label')).toEqual([
      'New chapter',
      'New chapter from preset',
      'New onboarding flow',
    ]);
    expect(texts('gr-index-page .entry b')).toEqual(['New', 'New', 'New']);
    expect(texts('gr-index-page .count')).toEqual(['3 entries']);
    expect(texts('gr-index-page .entry .gloss')).toEqual([
      'with your last settings',
      'pick a preset first',
      'Claude Code · ~/git/breeder',
    ]);
    expect(texts('gr-index-page .entry .where .gr-kbd')).toEqual(['Ctrl', 'N']);
    expect(texts('gr-index-page .entry[aria-selected="true"] .label')).toEqual(['New chapter']);

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.open').map((c) => c.request)).toEqual([
      { agent: 'claude-code', chatId: 'c9', settings: { cwd: 'C:/Users/me/git/breeder' } },
    ]);
    expect(el.querySelector('gr-index-page')).toBeNull();
    expect(texts('gr-running-head h1')).toEqual(['New onboarding flow']);
  });

  it('opens the Index from its thumb notch, and turns back with Esc', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    const notch = el.querySelector<HTMLButtonElement>('gr-thumb-index .index')!;
    notch.click();
    await fixture.whenStable();
    expect(notch.getAttribute('aria-current')).toBe('page');
    expect(texts('gr-index-page .row .gr-link')).toEqual(['Back to the Outline Esc']);

    const field = el.querySelector<HTMLInputElement>('#gr-index-look-up')!;
    field.value = 'zzz';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-index-page .entries .note')).toEqual(['Nothing in the index matches “zzz”.']);
    expect(texts('gr-index-page .count')).toEqual(['0 entries']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-index-page')).toBeNull();
    expect(notch.getAttribute('aria-current')).toBeNull();
  });

  it('lists every chapter in the Table of contents, in parts by project, narrowed and tagged there', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    answers['agents.chats'] = () => [
      { id: 'c1', agent: 'claude-code', title: 'Context meter', cwd: 'C:/Users/me/git/grimoire', updatedAt: 9, dogEars: [], tags: ['ui', 'bug'] },
      { id: 'c2', agent: 'claude-code', title: 'Fix flaky login test', cwd: 'C:/Users/me/git/breeder', updatedAt: 8, dogEars: [], tags: ['bug'] },
      { id: 'c3', agent: 'claude-code', title: 'Refactor storage migrations', cwd: 'C:/Users/me/git/grimoire/.claude/worktrees/storage', updatedAt: 7, dogEars: [], tags: [] },
      { id: 'c4', agent: 'claude-code', title: 'Morning repo summary', cwd: 'C:/Users/me/git/grimoire', updatedAt: 1, dogEars: ['pin'], tags: [] },
    ];
    answers['agents.open'] = (request: CommandRequest<'agents.open'>): OpenChat => ({
      id: request.chatId,
      agent: request.agent,
      title: 'Fix flaky login test',
      settings: request.settings,
      status: 'idle',
      entries: [],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: ['bug'],
      copied: [],
    });
    const { fixture, el, texts } = await render(bridge);
    const tab = [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')].find(
      (t) => t.textContent!.trim() === 'Table of contents',
    )!;
    tab.click();
    await fixture.whenStable();

    expect(texts('gr-thumb-page .title')).toEqual(['Table of contents']);
    expect(texts('gr-contents-page h3')).toEqual(['Part I', 'Part II']);
    expect(texts('gr-contents-page h2')).toEqual(['grimoire ~/git/grimoire', 'breeder ~/git/breeder']);
    // A pinned chapter comes first in its part; a worktree's chapter is in its repository's.
    expect(texts('gr-contents-page li .chapter')).toEqual([
      'Morning repo summary',
      'Context meter',
      'Refactor storage migrations',
      'Fix flaky login test',
    ]);
    expect(texts('gr-contents-page li .tag')).toEqual(['ui', 'bug', 'bug']);
    expect(texts('gr-contents-page .pick')).toEqual(['bug', 'ui']);

    const pick = (tag: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-contents-page .pick')].find((b) => b.textContent!.trim() === tag)!;
    pick('bug').click();
    await fixture.whenStable();
    expect(pick('bug').getAttribute('aria-pressed')).toBe('true');
    expect(texts('gr-contents-page li .chapter')).toEqual(['Context meter', 'Fix flaky login test']);
    pick('ui').click();
    await fixture.whenStable();
    expect(texts('gr-contents-page li .chapter')).toEqual(['Context meter']);
    el.querySelector<HTMLButtonElement>('gr-contents-page .narrow .gr-link')!.click();
    await fixture.whenStable();
    expect(texts('gr-contents-page li .chapter')).toHaveLength(4);

    // A tag is written in place on the chapter, and kept by the service.
    const row = (id: string) => el.querySelector<HTMLElement>(`gr-contents-page li[data-chat="${id}"]`)!;
    row('c3').querySelector<HTMLButtonElement>('.add')!.click();
    await fixture.whenStable();
    const field = row('c3').querySelector<HTMLInputElement>('.field')!;
    expect(document.activeElement).toBe(field);
    field.value = ' storage ';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    const tagCalls = () => calls.filter((c) => c.command === 'agents.tag').map((c) => c.request);
    expect(tagCalls()).toEqual([{ chatId: 'c3', tags: ['storage'] }]);
    expect(texts('gr-contents-page li[data-chat="c3"] .tag')).toEqual(['storage']);
    expect(texts('gr-contents-page .pick')).toEqual(['bug', 'storage', 'ui']);
    expect(document.activeElement).toBe(row('c3').querySelector('.add'));

    row('c1').querySelector<HTMLButtonElement>('[aria-label="Remove tag ui"]')!.click();
    await fixture.whenStable();
    expect(tagCalls().at(-1)).toEqual({ chatId: 'c1', tags: ['bug'] });
    expect(texts('gr-contents-page .pick')).toEqual(['bug', 'storage']);

    // Tags and titles changed on a chapter itself show here too.
    emit('agents.tags', { chatId: 'c2', tags: ['bug', 'login'] });
    emit('agents.title', { chatId: 'c4', title: 'Morning summary' });
    await fixture.whenStable();
    expect(texts('gr-contents-page li[data-chat="c2"] .tag')).toEqual(['bug', 'login']);
    expect(texts('gr-contents-page li[data-chat="c4"] .chapter')).toEqual(['Morning summary']);

    // A title opens its chapter on the left page; the contents stay open beside it.
    row('c2').querySelector<HTMLButtonElement>('.chapter')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.open').map((c) => c.request)).toEqual([
      { agent: 'claude-code', chatId: 'c2', settings: { cwd: 'C:/Users/me/git/breeder' } },
    ]);
    expect(texts('gr-running-head h1')).toEqual(['Fix flaky login test']);
    expect(row('c2').getAttribute('aria-current')).toBe('page');
    expect(el.querySelector('gr-contents-page')).not.toBeNull();
  });

  it('looks up words through the chapters in the Table of contents, each with its passage', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.chats'] = () => [
      { id: 'c1', agent: 'claude-code', title: 'Context meter', cwd: 'C:/Users/me/git/grimoire', updatedAt: 9, dogEars: [], tags: [] },
      { id: 'c2', agent: 'claude-code', title: 'Fix flaky login test', cwd: 'C:/Users/me/git/breeder', updatedAt: 8, dogEars: [], tags: [] },
      { id: 'c3', agent: 'claude-code', title: 'Refactor storage migrations', cwd: 'C:/Users/me/git/grimoire', updatedAt: 7, dogEars: [], tags: [] },
    ];
    answers['search.chats'] = ({ query }: CommandRequest<'search.chats'>) => {
      if (query === 'boom') throw new Error('the worker stopped');
      if (query !== 'timer') return [];
      return [
        {
          chatId: 'c2',
          agent: 'claude-code',
          kind: 'agent',
          excerpt: [{ text: '…the login test waited on a ' }, { text: 'timer', match: true }, { text: '; it now…' }],
        },
        { chatId: 'c1', agent: 'claude-code', kind: 'title', excerpt: [{ text: 'Context meter' }] },
        // A chat the contents don't list yet is left out.
        { chatId: 'new', agent: 'claude-code', kind: 'you', excerpt: [{ text: 'timer', match: true }] },
      ];
    };
    answers['agents.open'] = (request: CommandRequest<'agents.open'>): OpenChat => ({
      id: request.chatId,
      agent: request.agent,
      title: 'Context meter',
      settings: request.settings,
      status: 'idle',
      entries: [],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((t) => t.textContent!.trim() === 'Table of contents')!
      .click();
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('#gr-contents-look-up')!;
    expect(document.activeElement).toBe(field);
    const look = async (query: string) => {
      field.value = query;
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };

    await look('timer');
    expect(calls.filter((c) => c.command === 'search.chats').map((c) => c.request)).toEqual([{ query: 'timer' }]);
    expect(texts('gr-contents-page li .chapter')).toEqual(['Context meter', 'Fix flaky login test']);
    // A passage is shown with who wrote it; a title that has the words shows as it is.
    expect(texts('gr-contents-page .excerpt')).toEqual(['Claude Code …the login test waited on a timer; it now…']);
    expect(texts('gr-contents-page .excerpt b')).toEqual(['timer']);
    expect(texts('gr-contents-page .count')).toEqual(['2 chapters']);

    // Enter opens the first chapter listed.
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.open').map((c) => c.request)).toEqual([
      { agent: 'claude-code', chatId: 'c1', settings: { cwd: 'C:/Users/me/git/grimoire' } },
    ]);

    await look('zzz');
    expect(texts('gr-contents-page .none')).toEqual(['Nothing in the chapters matches “zzz”.']);
    expect(texts('gr-contents-page .count')).toEqual(['0 chapters']);

    await look('boom');
    expect(texts('gr-contents-page [role="alert"]')).toEqual([
      'The chapters couldn’t be looked through: the worker stopped',
    ]);

    // Nothing looked up lists every chapter again, without asking.
    await look('  ');
    expect(texts('gr-contents-page li .chapter')).toHaveLength(3);
    expect(texts('gr-contents-page .count')).toEqual(['']);
    expect(el.querySelector('gr-contents-page [role="alert"]')).toBeNull();
    expect(calls.filter((c) => c.command === 'search.chats')).toHaveLength(3);
  });

  it('says so in the Table of contents when there are no chapters, or none with the tags picked', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.chats'] = () => [];
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((t) => t.textContent!.trim() === 'Table of contents')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-contents-page .none')).toEqual(['No chapters yet. Each chat you begin is written in here.']);
    expect(el.querySelector('gr-contents-page .narrow')).toBeNull();
  });

  it('turns the facing page to a thumb tab\'s page, blank until its feature is written', async () => {
    const { fixture, el, texts } = await render(fakeBridge().bridge);
    const kanban = [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')].find(
      (tab) => tab.textContent!.trim() === 'Kanban',
    )!;
    kanban.click();
    await fixture.whenStable();
    expect(kanban.getAttribute('aria-current')).toBe('page');
    expect(texts('gr-thumb-page .title')).toEqual(['Kanban']);
    expect(texts('gr-thumb-page .blank')).toEqual(['Not written yet.']);
    expect(texts('gr-thumb-page .row .gr-link')).toEqual(['Back to the Outline Esc']);

    // Its tab again turns back, and so does Esc.
    kanban.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-thumb-page')).toBeNull();
    kanban.click();
    await fixture.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-thumb-page')).toBeNull();
    expect(kanban.getAttribute('aria-current')).toBeNull();
  });

  it('shows how much of the plan\'s limits is used in the Ledger, and reads it again', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const tonight = new Date();
    tonight.setHours(23, 0, 0, 0);
    let used = 37;
    answers['agents.usage'] = () => ({
      plan: 'max',
      windows: [
        { span: 'session', used: used++, resetsAt: tonight.getTime() },
        { span: 'week', used: 70, resetsAt: null },
        { span: 'week', model: 'Opus', used: 12, resetsAt: null },
      ],
      at: tonight.getTime(),
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-thumb-page .title')).toEqual(['Ledger']);
    expect(texts('gr-ledger-page h2')).toEqual(['Claude Code’s plan limits']);
    expect(texts('gr-ledger-page .sub')[0]).toMatch(/^Max plan, read at .+Read again$/);
    expect(texts('gr-ledger-page .name')).toEqual([
      'Current session',
      'This week, all models',
      'This week, Opus',
    ]);
    expect(texts('gr-ledger-page b')).toEqual(['37%', '70%', '12%']);
    expect(texts('gr-ledger-page .resets')[0]).toMatch(/^resets at \S/);
    const meter = el.querySelector('gr-ledger-page [role="meter"]')!;
    expect(meter.getAttribute('aria-valuenow')).toBe('37');

    el.querySelector<HTMLButtonElement>('gr-ledger-page .sub .gr-link')!.click();
    await fixture.whenStable();
    expect(texts('gr-ledger-page b')[0]).toBe('38%');
    expect(calls.filter((call) => call.command === 'agents.usage')).toHaveLength(2);
  });

  it("shows an organization's monthly allowance in the Ledger, with no session or week limits", async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.usage'] = () => ({
      plan: 'enterprise',
      windows: [],
      credits: {
        spent: 12345,
        limit: 60000,
        currency: 'USD',
        used: 20.575,
        resetsAt: new Date(2026, 11, 1).getTime(),
      },
      at: 0,
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-ledger-page .sub')[0]).toMatch(/^Enterprise plan, read at /);
    expect(texts('gr-ledger-page .none')).toEqual([]);
    const spent = (12345 / 100).toLocaleString([], { style: 'currency', currency: 'USD' });
    const limit = (600).toLocaleString([], { style: 'currency', currency: 'USD' });
    expect(texts('gr-ledger-page .name')).toEqual([`Usage credits this month ${spent} of ${limit}`]);
    expect(texts('gr-ledger-page .resets')[0]).toMatch(/^resets on \S/);
    expect(texts('gr-ledger-page b')).toEqual(['21%']);
    const meter = el.querySelector('gr-ledger-page [role="meter"]')!;
    expect(meter.getAttribute('aria-valuetext')).toBe(`${spent} of ${limit}`);
  });

  it('shows usage credits with no limit as money spent, without a meter', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.usage'] = () => ({
      plan: 'team',
      windows: [],
      credits: { spent: 900, limit: null, currency: 'EUR', used: null, resetsAt: 0 },
      at: 0,
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    const spent = (9).toLocaleString([], { style: 'currency', currency: 'EUR' });
    expect(texts('gr-ledger-page .spent')).toEqual([`${spent} spent, no limit`]);
    expect(el.querySelector('gr-ledger-page [role="meter"]')).toBeNull();
  });

  it('says so in the Ledger when the agent has no plan limits', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.usage'] = () => ({ plan: null, windows: [], at: 0 });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-ledger-page .none')).toEqual([
      'No limits to show: Claude Code isn’t signed in with a Claude subscription.',
    ]);
  });

  it('turns the facing page to the agent\'s commands at a "/" in the entry', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    answers['agents.commands'] = () => [
      { name: 'compact', description: 'Free up context', kind: 'command' },
      { name: 'init', description: 'Write a CLAUDE.md', kind: 'command' },
      { name: 'code-review', description: 'Review the diff', kind: 'skill' },
      { name: 'simplify', description: 'Tidy the changed code', kind: 'skill' },
      { name: 'review', description: 'Review a pull request', kind: 'command' },
    ];
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    emit('agents.context', { chatId: 'chat-1', context: { used: 62, limit: 100 } });
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    const type = async (text: string) => {
      entry.value = text;
      entry.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const press = async (key: string) => {
      entry.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };

    await type('/');
    expect(calls.filter((c) => c.command === 'agents.commands').map((c) => c.request)).toEqual([
      { agent: 'claude-code', cwd: 'C:/work/grimoire' },
    ]);
    expect(texts('gr-command-index h3')).toEqual(['Claude Code’s commands', 'Claude Code’s skills']);
    expect(texts('gr-command-index .entry .label')).toEqual([
      '/compact',
      '/init',
      '/review',
      'code-review',
      'simplify',
    ]);
    expect(texts('gr-command-index .entry .where')).toEqual([
      '62% used',
      'C:/work/grimoire',
      'command',
      'skill',
      'skill',
    ]);
    expect(texts('gr-command-index .count')).toEqual(['Claude Code’s commands and skills · 5 entries']);
    expect(texts('gr-composer .slash-hint')).toEqual([
      'Claude Code’s commands and skills are on the facing page →',
    ]);

    await type('/re');
    expect(texts('gr-command-index .entry .label')).toEqual(['/review', 'code-review']);
    expect(texts('gr-command-index .entry b')).toEqual(['/re', 're']);
    await press('ArrowDown');
    expect(texts('gr-command-index .entry[aria-selected="true"] .label')).toEqual(['code-review']);
    expect(entry.getAttribute('aria-activedescendant')).toBe('gr-command-code-review');
    await press('Tab');
    expect(entry.value).toBe('/code-review ');
    expect(el.querySelector('gr-command-index')).toBeNull();
    expect(texts('gr-composer .slash-hint')).toEqual([]);

    await type('/zzz');
    expect(texts('gr-command-index .entries .note')).toEqual([
      'Nothing in Claude Code’s commands and skills matches “/zzz”.',
    ]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-command-index')).toBeNull();
    expect(calls.filter((c) => c.command === 'agents.interrupt')).toEqual([]);

    await type('/comp');
    await press('Enter');
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: '/compact' },
    ]);
    expect(entry.value).toBe('');
    expect(el.querySelector('gr-command-index')).toBeNull();
    // Asked for each time the facing page turns to them; the service keeps them a minute.
    expect(calls.filter((c) => c.command === 'agents.commands')).toHaveLength(3);
  });

  it('uses a command clicked on the facing page', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.commands'] = () => [
      { name: 'compact', description: 'Free up context', kind: 'command' },
    ];
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'First');
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry.value = '/';
    entry.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-command-index .entry')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: '/compact' },
    ]);
    expect(document.activeElement).toBe(entry);
  });

  it('says why the agent\'s commands could not be listed', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.commands'] = () => {
      throw new Error('Claude Code is not installed');
    };
    const { fixture, el, texts } = await render(bridge);
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry.value = '/';
    entry.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    // A blank chapter's folder isn't chosen yet: the agent looks in your home folder.
    expect(calls.filter((c) => c.command === 'agents.commands').map((c) => c.request)).toEqual([
      { agent: 'claude-code' },
    ]);
    expect(texts('gr-command-index .entries .note')).toEqual([
      'Claude Code’s commands and skills couldn’t be listed: Claude Code is not installed',
    ]);
  });

  it('renames a chapter in place with the pen beside its title', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.list'] = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['rename'] }];
    const { fixture, el, texts } = await render(bridge);
    await fixture.whenStable();
    const pen = () => el.querySelector<HTMLButtonElement>('[aria-label="Rename chapter"]');
    const field = () => el.querySelector<HTMLInputElement>('gr-running-head input.rename');
    const rename = async (title: string, key: string) => {
      pen()!.click();
      await fixture.whenStable();
      expect(document.activeElement).toBe(field());
      field()!.value = title;
      field()!.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };

    // A blank chapter's chat starts with the title you gave it.
    await rename('Login bug', 'Enter');
    expect(texts('gr-running-head h1')).toEqual(['Login bug']);
    await write(fixture, el, 'First');
    expect(calls.find((c) => c.command === 'agents.start')!.request).toMatchObject({ title: 'Login bug' });

    await rename('  Flaky login test ', 'Enter');
    expect(calls.filter((c) => c.command === 'agents.rename').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', title: 'Flaky login test' },
    ]);
    expect(texts('gr-running-head h1')).toEqual(['Flaky login test']);
    expect(document.activeElement).toBe(pen());

    // Esc puts the title back, and leaves the turn running.
    await rename('Something else', 'Escape');
    expect(texts('gr-running-head h1')).toEqual(['Flaky login test']);
    expect(calls.filter((c) => c.command === 'agents.rename')).toHaveLength(1);
    expect(calls.filter((c) => c.command === 'agents.interrupt')).toEqual([]);
  });

  it('leaves the pen out for agents that can\'t rename their chats', async () => {
    const { bridge } = fakeBridge();
    const { el } = await render(bridge);
    expect(el.querySelector('[aria-label="Rename chapter"]')).toBeNull();
  });

  it('tags a chapter in its running head, and takes tags off again', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    const add = async (tag: string, key: string) => {
      el.querySelector<HTMLButtonElement>('gr-chapter-tags .gr-link')!.click();
      await fixture.whenStable();
      const field = el.querySelector<HTMLInputElement>('gr-chapter-tags input')!;
      expect(document.activeElement).toBe(field);
      field.value = tag;
      field.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };
    const tagCalls = () => calls.filter((c) => c.command === 'agents.tag').map((c) => c.request);

    // A blank chapter's tags go to its chat once it starts.
    await add('ui', 'Enter');
    expect(texts('gr-chapter-tags .tag')).toEqual(['ui']);
    await write(fixture, el, 'First');
    expect(tagCalls()).toEqual([{ chatId: 'chat-1', tags: ['ui'] }]);

    await add(' bug ', 'Enter');
    await add('UI', 'Enter');
    await add('later', 'Escape');
    expect(texts('gr-chapter-tags .tag')).toEqual(['ui', 'bug']);
    expect(tagCalls()).toEqual([
      { chatId: 'chat-1', tags: ['ui'] },
      { chatId: 'chat-1', tags: ['ui', 'bug'] },
    ]);
    expect(calls.filter((c) => c.command === 'agents.interrupt')).toEqual([]);
    expect(document.activeElement).toBe(el.querySelector('gr-chapter-tags .gr-link'));

    el.querySelector<HTMLButtonElement>('[aria-label="Remove tag ui"]')!.click();
    await fixture.whenStable();
    expect(texts('gr-chapter-tags .tag')).toEqual(['bug']);
    expect(tagCalls().at(-1)).toEqual({ chatId: 'chat-1', tags: ['bug'] });
  });

  it('saves a chapter\'s settings as a preset, and puts chapters on it', async () => {
    const { bridge, calls, answers } = fakeBridge();
    let saved: Preset[] = [];
    answers['presets.list'] = () => saved;
    answers['presets.save'] = (preset: Preset) => (saved = [...saved, preset]);
    const { fixture, el, texts } = await render(bridge);
    const head = () => texts('.meta button');
    const open = async (setting: string) => {
      el.querySelector<HTMLButtonElement>(`.meta [data-setting="${setting}"]`)!.click();
      await fixture.whenStable();
    };
    const presetColumn = '.column[data-setting="preset"]';

    await open('preset');
    expect(texts(`${presetColumn} .none`)).toEqual(['No saved presets yet']);
    expect(texts(`${presetColumn} [aria-checked="true"]`)).toEqual(['No preset']);
    el.querySelector<HTMLButtonElement>(`${presetColumn} .action`)!.click();
    await fixture.whenStable();
    const name = el.querySelector<HTMLInputElement>('.preset-name')!;
    expect(document.activeElement).toBe(name);
    name.value = 'Plan a feature';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();

    // The defaults are written in, so the preset means the same later.
    expect(calls.find((c) => c.command === 'presets.save')!.request).toEqual({
      name: 'Plan a feature',
      agent: 'claude-code',
      settings: { cwd: 'C:/Users/me', model: 'opus', effort: 'xhigh', mode: 'ask' },
    });
    expect(texts(`${presetColumn} [aria-checked="true"]`)).toEqual(['Plan a feature Claude Code · Ask first']);
    expect(head()[5]).toBe('Plan a feature');
    expect(document.activeElement).toBe(el.querySelector(`${presetColumn} .action`));

    // Another setting takes the chapter off the preset; picking the preset puts it back.
    pick(el, 'Plan only');
    pick(el, 'Low');
    await fixture.whenStable();
    expect(head()[5]).toBe('No preset');
    pick(el, 'Plan a feature');
    await fixture.whenStable();
    expect(head().slice(2)).toEqual(['Extra high effort', 'Ask first', '~', 'Plan a feature']);

    // Once begun in another folder, the chapter can't take it.
    pick(el, '~/git/breeder');
    await fixture.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await write(fixture, el, 'First');
    await open('preset');
    const choice = [...el.querySelectorAll(`${presetColumn} .choice`)].find((c) =>
      c.textContent!.includes('Plan a feature'),
    )!;
    expect(choice.getAttribute('aria-disabled')).toBe('true');
    expect(head()[5]).toBe('No preset');
  });

  it('begins a chapter from a preset listed in the Index', async () => {
    const { bridge, answers } = fakeBridge();
    answers['presets.list'] = (): Preset[] => [
      {
        name: 'Bug fix',
        agent: 'claude-code',
        settings: { cwd: 'C:/Users/me/git/breeder', model: 'sonnet', mode: 'accept-edits' },
      },
    ];
    const { fixture, el, texts } = await render(bridge);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('#gr-index-look-up')!;
    field.value = 'preset';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-index-page .entry .where')).toEqual(['opens a list ›']);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();

    expect(texts('gr-index-page h3')).toEqual(['Presets']);
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    expect(texts('gr-index-page .entry .gloss')).toEqual(['Claude Code · Accept edits · ~/git/breeder']);
    // Esc goes back to the whole Index first.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(texts('gr-index-page h3')).toEqual(['Actions']);
    el.querySelector<HTMLButtonElement>('#gr-index-action-from-preset')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-index-page .entry')!.click();
    await fixture.whenStable();

    expect(el.querySelector('gr-index-page')).toBeNull();
    expect(texts('.meta button')).toEqual([
      'Claude Code',
      'Sonnet 5.5',
      'Default effort',
      'Accept edits',
      '~/git/breeder',
      'Bug fix',
    ]);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
  });

  it('attaches files, and pasted or dropped pictures, and sends them with the entry', async () => {
    const { bridge, calls } = fakeBridge({
      chooseFiles: vi.fn(async () => ['C:/work/grimoire/src/app/ribbon.ts', 'D:/notes.txt']),
      pathOf: vi.fn((file: File) => (file.name === 'README.md' ? 'C:/work/grimoire/README.md' : '')),
    });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');

    el.querySelector<HTMLButtonElement>('[aria-label="Attach files or a screenshot"]')!.click();
    await fixture.whenStable();
    expect(texts('gr-composer .ref code')).toEqual(['src/app/ribbon.ts', 'D:/notes.txt']);
    expect(texts('gr-composer .ref figcaption span')).toEqual([
      'Ref. 1. Attached file',
      'Ref. 2. Attached file',
    ]);

    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry.dispatchEvent(withFiles('paste', [picture('shot.png')]));
    await fixture.whenStable();
    entry.dispatchEvent(withFiles('drop', [new File(['# Grimoire'], 'README.md'), picture('photo.png')]));
    await fixture.whenStable();
    expect(texts('gr-composer .ref code')).toEqual(['src/app/ribbon.ts', 'D:/notes.txt', 'README.md']);
    expect(texts('gr-composer .plate figcaption span')).toEqual([
      expect.stringMatching(/^Plate I\. Screenshot, pasted at .+$/),
      expect.stringMatching(/^Plate II\. Picture, dropped at .+$/),
    ]);
    expect(el.querySelector('gr-composer .plate img')!.getAttribute('src')).toBe(
      'data:image/png;base64,AQID',
    );

    el.querySelector<HTMLButtonElement>('[aria-label="Remove notes.txt"]')!.click();
    el.querySelector<HTMLButtonElement>('[aria-label="Remove plate II"]')!.click();
    await fixture.whenStable();
    await write(fixture, el, 'Why is this blurry?');
    expect(calls.filter((c) => c.command === 'agents.send').at(-1)!.request).toEqual({
      chatId: 'chat-1',
      text: 'Why is this blurry?',
      enclosures: [
        { kind: 'file', path: 'C:/work/grimoire/src/app/ribbon.ts' },
        {
          kind: 'picture',
          mediaType: 'image/png',
          data: 'AQID',
          caption: expect.stringMatching(/^Screenshot, pasted at /),
        },
        { kind: 'file', path: 'C:/work/grimoire/README.md' },
      ],
    });
    expect(el.querySelector('gr-composer gr-enclosures')).toBeNull();
  });

  it('shows what went with an entry, on its page and while it waits', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'user',
        id: 'u2',
        text: '',
        enclosures: [
          { kind: 'picture', mediaType: 'image/png', data: 'AQID' },
          { kind: 'file', path: 'src/app/ribbon.ts' },
        ],
      },
    });
    emit('agents.queued', {
      chatId: 'chat-1',
      queued: [
        { id: 'q1', text: 'And this.', enclosures: [{ kind: 'file', path: 'C:/work/grimoire/notes.txt' }] },
      ],
    });
    await fixture.whenStable();
    expect(texts('.you p')).toEqual(['First']);
    expect(texts('.you .plate figcaption span')).toEqual(['Plate I. Picture']);
    expect(texts('.you .ref code')).toEqual(['src/app/ribbon.ts']);
    expect(el.querySelector('.you .x')).toBeNull();
    expect(texts('.queued-text')).toEqual(['And this. + 1 attached']);

    [...el.querySelectorAll<HTMLButtonElement>('.queued button')]
      .find((b) => b.textContent!.trim() === 'Edit')!
      .click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!.value).toBe('And this.');
    expect(texts('gr-composer .ref code')).toEqual(['notes.txt']);
  });

  it('shows why an undo failed', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.openChats'] = (): OpenChat[] => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: '',
        settings: { cwd: 'C:/work/grimoire' },
        status: 'idle',
        entries: [
          { kind: 'user', id: 'u1', text: 'Add a meter' },
          {
            kind: 'agent',
            id: 'a1',
            blocks: [
              {
                kind: 'tool',
                id: 't1',
                tool: 'Write',
                input: { file_path: 'C:/work/grimoire/meter.ts', content: 'meter' },
                result: { text: 'ok', isError: false },
              },
            ],
          },
        ],
        approvals: [],
        queued: [],
        plan: [],
        withdrawn: [],
        dogEars: [],

        tags: [],
        copied: [],
      },
    ];
    answers['layout.get'] = () => ({ current: 'c1' });
    answers['agents.undo'] = () => Promise.reject(new Error('No checkpoint for this entry'));
    const { fixture, el, texts } = await render(bridge);
    el.querySelector<HTMLButtonElement>('.you .by button')!.click();
    await fixture.whenStable();
    expect(texts('.error')).toEqual(['No checkpoint for this entry']);
  });

  it('reopens the chapters the hub has open, on the one you were on', async () => {
    const { bridge, calls, answers } = fakeBridge();
    const chat = (id: string, title: string, text: string): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/work/grimoire' },
      status: 'idle',
      entries: [{ kind: 'user', id: `${id}-u`, text }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],

      tags: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [
      chat('c1', 'Fix flaky login test', 'Why does login fail?'),
      chat('c2', 'Context meter', 'Add a context meter'),
    ];
    answers['layout.get'] = () => ({ current: 'c2' });
    const { fixture, el, texts } = await render(bridge);

    expect(texts('gr-running-head h1')).toEqual(['Context meter']);
    expect(texts('.you p')).toEqual(['Add a context meter']);
    expect(texts('gr-ribbon b')).toEqual([
      'Fix flaky login test',
      'Context meter',
      'New chapter',
    ]);

    el.querySelectorAll<HTMLButtonElement>('gr-ribbon.chapter button')[0]!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'layout.set').map((c) => c.request)).toEqual([
      { current: 'c1' },
    ]);
  });

  it('closes a chapter from the running head, with Ctrl+W, or by middle-clicking its ribbon', async () => {
    const { bridge, calls, answers } = fakeBridge();
    const chat = (id: string, title: string): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/work' },
      status: 'idle',
      entries: [],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],

      tags: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [chat('c1', 'One'), chat('c2', 'Two'), chat('c3', 'Three')];
    answers['layout.get'] = () => ({ current: 'c2' });
    const { fixture, el, texts } = await render(bridge);
    const closed = () =>
      calls.filter((c) => c.command === 'agents.close').map((c) => (c.request as { chatId: string }).chatId);

    [...el.querySelectorAll<HTMLButtonElement>('gr-running-head .gr-link')]
      .find((b) => b.textContent!.trim() === 'Close')!
      .click();
    await fixture.whenStable();
    expect(closed()).toEqual(['c2']);
    expect(texts('gr-running-head h1')).toEqual(['Three']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }));
    await fixture.whenStable();
    expect(closed()).toEqual(['c2', 'c3']);
    expect(texts('gr-running-head h1')).toEqual(['One']);

    el.querySelector<HTMLButtonElement>('[aria-current="page"]')!.dispatchEvent(
      new MouseEvent('auxclick', { button: 1, bubbles: true }),
    );
    await fixture.whenStable();
    expect(closed()).toEqual(['c2', 'c3', 'c1']);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
  });

  it('opens a new chapter with Ctrl+N', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fix the flaky login test');
    const event = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true });
    document.dispatchEvent(event);
    await fixture.whenStable();
    expect(event.defaultPrevented).toBe(true);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
  });

  it('turns the facing page to every slip awaiting your seal, oldest first', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    const chat = (id: string, title: string, command: string, at: number): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/Users/me/git/grimoire' },
      status: 'waiting',
      entries: [],
      approvals: [{ id: `${id}-seal`, chatId: id, tool: 'Bash', input: { command }, at }],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],

      tags: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [
      chat('c1', 'Fix flaky login test', 'npm test', 200),
      chat('c2', 'Context meter', 'git push', 100),
    ];
    answers['layout.get'] = () => ({ current: 'c2', lastUsed: null });
    const { fixture, el, texts } = await render(bridge);
    const ribbon = [...el.querySelectorAll<HTMLButtonElement>('gr-ribbon button')].find((b) =>
      b.textContent!.includes('Awaiting your seal'),
    )!;
    const focusedSlip = () => document.activeElement?.closest('gr-approval-slip')?.querySelector('.well')?.textContent;

    ribbon.click();
    await fixture.whenStable();
    expect(ribbon.getAttribute('aria-expanded')).toBe('true');
    expect(texts('gr-seals-page .hint')).toEqual(['2 slips from 2 chapters, oldest first']);
    expect(texts('gr-seals-page .gr-link')[0]).toBe('Back to the Outline Esc');
    expect(texts('gr-seals-page gr-approval-slip .head b')).toEqual([
      'Context meter',
      'Fix flaky login test',
    ]);
    expect(texts('gr-seals-page gr-approval-slip .meta span')[0]).toBe('Runs in ~/git/grimoire');
    // In its chapter, the slip is a stub pointing to the facing page.
    expect(texts('gr-chapter-page gr-seal-stub code')).toEqual(['git push']);
    expect(focusedSlip()).toBe('$git push');
    el.querySelector('gr-seals-page gr-approval-slip')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(focusedSlip()).toBe('$npm test');

    // Esc turns back, denying nothing.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(el.querySelector('gr-seals-page')).toBeNull();
    expect(texts('gr-chapter-page gr-approval-slip .well')).toEqual(['$git push']);
    expect(calls.some((c) => c.command === 'agents.decide')).toBe(false);

    // The stub opens the page on its own slip; sealing answers in that chapter.
    ribbon.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-seal-stub button')!.click();
    await fixture.whenStable();
    expect(focusedSlip()).toBe('$git push');
    el.querySelectorAll<HTMLButtonElement>('gr-seals-page .seal-button')[1]!.click();
    expect(calls.find((c) => c.command === 'agents.decide')?.request).toEqual({
      approvalId: 'c1-seal',
      decision: 'allow-once',
    });
    emit('agents.approvalSettled', { chatId: 'c1', approvalId: 'c1-seal' });
    await fixture.whenStable();
    expect(texts('gr-seals-page .hint')).toEqual(['1 slip from 1 chapter, oldest first']);

    // Sealing the last one turns the page back.
    emit('agents.approvalSettled', { chatId: 'c2', approvalId: 'c2-seal' });
    await fixture.whenStable();
    expect(el.querySelector('gr-seals-page')).toBeNull();
    expect(texts('gr-facing-page .tabs [aria-pressed="true"]')).toEqual(['Outline']);
  });

  it('opens a slip\'s chapter from the facing page', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.openChats'] = () => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Fix flaky login test',
        settings: { cwd: 'C:/work' },
        status: 'waiting',
        entries: [],
        approvals: [{ id: 's1', chatId: 'c1', tool: 'Bash', input: { command: 'npm test' } }],
        queued: [],
        plan: [],
        withdrawn: [],
        dogEars: [],

        tags: [],
        copied: [],
      },
    ];
    const { fixture, el, texts } = await render(bridge);
    expect(texts('gr-running-head h1')).toEqual(['Untitled chapter']);
    el.querySelector<HTMLButtonElement>('gr-ribbon[data-tone="seal"] button')!.click();
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('gr-seals-page gr-approval-slip .gr-link')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-seals-page')).toBeNull();
    expect(texts('gr-running-head h1')).toEqual(['Fix flaky login test']);
    expect(texts('gr-chapter-page gr-approval-slip .well')).toEqual(['$npm test']);
  });

  it('tucks an approval into the page and seals it', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Push it');
    emit('agents.approval', {
      approval: {
        id: 'ap1',
        chatId: 'chat-1',
        tool: 'Bash',
        input: { command: 'git push origin main', description: 'Pushes the branch' },
        alwaysAllow: { rule: 'git push', scope: 'project' },
      },
    });
    emit('agents.status', { chatId: 'chat-1', status: 'waiting' });
    await fixture.whenStable();

    expect(texts('gr-approval-slip .head > *')).toEqual([
      '¶ Awaiting your seal',
      'Claude Code asks to run this command',
    ]);
    expect(texts('gr-approval-slip .well')).toEqual(['$git push origin main']);
    expect(texts('gr-approval-slip .meta span')).toEqual([
      'Runs in C:/work/grimoire',
      'Pushes the branch',
    ]);
    expect(texts('gr-approval-slip .choice')).toEqual([
      'Always allow git push in this project ⇧⏎',
      'Deny Esc',
    ]);
    expect(texts('.stop')).toEqual([]);
    expect(texts('gr-ribbon .seal')).toEqual(['1']);
    expect(document.activeElement?.textContent).toContain('Allow once');

    el.querySelector<HTMLButtonElement>('gr-approval-slip .seal-button')!.click();
    el.querySelector('gr-approval-slip')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(calls.filter((c) => c.command === 'agents.decide').map((c) => c.request)).toEqual([
      { approvalId: 'ap1', decision: 'allow-once' },
      { approvalId: 'ap1', decision: 'allow-always' },
      { approvalId: 'ap1', decision: 'deny' },
    ]);
    expect(calls.some((c) => c.command === 'agents.interrupt')).toBe(false);

    emit('agents.approvalSettled', { chatId: 'chat-1', approvalId: 'ap1' });
    await fixture.whenStable();
    expect(el.querySelector('gr-approval-slip')).toBeNull();
    expect(texts('gr-ribbon .seal')).toEqual([]);
  });

  it('shows a file change as corrections on the slip', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Rename it');
    emit('agents.approval', {
      approval: {
        id: 'ap2',
        chatId: 'chat-1',
        tool: 'Edit',
        input: {
          file_path: 'C:/work/grimoire/src/a.ts',
          old_string: 'const a = 1;\nexport { a };',
          new_string: 'const b = 1;\nexport { b };',
        },
        alwaysAllow: { scope: 'chat' },
      },
    });
    await fixture.whenStable();
    expect(texts('gr-corrections .head b')).toEqual(['src/a.ts']);
    expect(texts('gr-corrections .line .mark')).toEqual(['dele', 'dele', '‸ insert 2 lines', '']);
    expect(texts('gr-approval-slip .choice')).toEqual([
      'Always allow edits in this chapter ⇧⏎',
      'Deny Esc',
    ]);
  });

  it('prints the agent’s questions as a form and sends your answers', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Build the meter');
    emit('agents.approval', {
      approval: {
        id: 'q1',
        chatId: 'chat-1',
        tool: 'AskUserQuestion',
        input: {},
        questions: [
          {
            question: 'Where should the meter appear?',
            options: [
              { label: 'In the composer', recommended: true },
              { label: 'In the running head' },
            ],
            multiSelect: false,
          },
          {
            question: 'Which warnings do you want?',
            options: [{ label: 'At 80% used' }, { label: 'At 95% used' }],
            multiSelect: true,
          },
        ],
      },
    });
    emit('agents.status', { chatId: 'chat-1', status: 'waiting' });
    await fixture.whenStable();

    expect(texts('gr-questions-form h2')).toEqual(['Questions from Claude Code']);
    expect(texts('gr-questions-form legend')).toEqual([
      'I.Where should the meter appear?Tick one.',
      'II.Which warnings do you want?Tick any.',
    ]);
    expect(texts('gr-questions-form .recommended')).toEqual(['recommended']);
    // Questions don't wait for a seal.
    expect(texts('gr-ribbon .seal')).toEqual([]);

    const options = [...el.querySelectorAll<HTMLInputElement>('gr-questions-form .option input')];
    expect(options.map((o) => o.type)).toEqual(['radio', 'radio', 'checkbox', 'checkbox']);
    options[1]!.click();
    options[0]!.click();
    options[2]!.click();
    options[3]!.click();
    options[3]!.click();
    const ownWords = el.querySelectorAll<HTMLInputElement>(
      'gr-questions-form .own-words input',
    )[1]!;
    ownWords.value = ' and at 99% ';
    ownWords.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-questions-form .option.on span:first-of-type')).toEqual([
      'In the composer',
      'At 80% used',
    ]);

    el.querySelector<HTMLButtonElement>('gr-questions-form .send')!.click();
    expect(calls.filter((c) => c.command === 'agents.answer').map((c) => c.request)).toEqual([
      {
        approvalId: 'q1',
        answers: [
          { chosen: ['In the composer'] },
          { chosen: ['At 80% used'], ownWords: 'and at 99%' },
        ],
      },
    ]);
  });

  it('shows the first facing page that can be picked', async () => {
    const { el, texts } = await render(fakeBridge().bridge);
    expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Outline']);
    expect(texts('.tabs [aria-disabled="true"]')).toEqual(['Files', 'Second chapter']);
    expect(el.querySelector('gr-outline')).not.toBeNull();
  });

  it('keeps the chapter\'s plan in the Outline, and its tools out of the margin', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    expect(texts('gr-outline .none')).toEqual([
      'No plan yet. Claude Code writes one here when a task takes several steps.',
    ]);
    await write(fixture, el, 'Add a context meter');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          { kind: 'tool', id: 't1', tool: 'TaskCreate', input: { subject: 'Read the composer' } },
          { kind: 'tool', id: 't2', tool: 'Read', input: { file_path: 'C:/work/grimoire/a.ts' } },
        ],
      },
    });
    emit('agents.plan', {
      chatId: 'chat-1',
      plan: [
        { text: 'Read the composer', status: 'done' },
        { text: 'Fill in the meter', status: 'active', activeText: 'Filling in the meter' },
        { text: 'Run the tests', status: 'pending' },
      ],
    });
    emit('agents.status', { chatId: 'chat-1', status: 'writing' });
    await fixture.whenStable();

    expect(texts('gr-outline li > *')).toEqual([
      'i.', 'Read the composer', 'done',
      'ii.', 'Fill in the meter', 'writing',
      'iii.', 'Run the tests', 'to do',
    ]);
    expect(texts('gr-outline li.now .text')).toEqual(['Fill in the meter']);
    expect(texts('gr-facing-page gr-running-foot')).toEqual(['1 of 3 done']);
    expect(texts('.note .note-head')).toEqual(['*Read']);
  });

  it('shows no indicators or stamps without a repository or a schedule', async () => {
    const { texts } = await render(fakeBridge().bridge);
    expect(texts('gr-status-indicators button')).toEqual([]);
    expect(texts('gr-review-stamps button')).toEqual([]);
  });

  it("keeps scheduled chats as journal entries, names the next run, and adds a run's chapter to the book", async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextAt = tomorrow.setHours(8, 0, 0, 0);
    const dueAt = new Date(nextAt - 24 * 60 * 60_000).getTime();
    const schedule: ScheduleInfo = {
      id: 's1',
      name: 'Morning repo summary',
      agent: 'claude-code',
      settings: { cwd: 'C:/Users/me/git/grimoire', model: 'opus' },
      prompt: 'Summarize what changed since yesterday.',
      days: [1, 2, 3, 4, 5],
      time: '08:00',
      enabled: true,
      nextAt,
      runs: [{ scheduleId: 's1', dueAt, outcome: 'missed' }],
    };
    answers['schedules.list'] = () => [schedule];
    answers['schedules.save'] = () => [schedule];
    answers['schedules.run'] = (): ScheduleRun => {
      const run: ScheduleRun = { scheduleId: 's1', dueAt: Date.now(), outcome: 'began', chatId: 'run-1', cwd: 'C:/Users/me/git/grimoire' };
      emit('schedules.began', {
        run,
        chat: {
          id: 'run-1',
          agent: 'claude-code',
          title: 'Morning repo summary · today',
          settings: { cwd: 'C:/Users/me/git/grimoire', mode: 'allow-all' },
          status: 'thinking',
          entries: [{ kind: 'user', id: 'u1', text: schedule.prompt }],
          approvals: [],
          queued: [],
          plan: [],
          withdrawn: [],
          dogEars: [],
          tags: [],
          copied: [],
        },
      });
      return run;
    };
    const { fixture, el, texts } = await render(bridge);

    const indicator = `Morning repo summary ${upcoming(nextAt, Date.now())}`;
    expect(indicator).toMatch(/^Morning repo summary tomorrow at /);
    expect(texts('gr-status-indicators button')).toEqual([indicator]);
    el.querySelector<HTMLButtonElement>('gr-status-indicators button')!.click();
    await fixture.whenStable();

    expect(texts('gr-thumb-page .title')).toEqual(['Scheduled chats']);
    expect(texts('gr-schedules-page .dateline')).toEqual([dateline(nextAt)]);
    expect(texts('gr-schedules-page h2')).toEqual(['Morning repo summary']);
    expect(texts('gr-schedules-page .sub')).toEqual([
      `Weekdays at ${clock('08:00')} · Claude Code · Opus 5.5, extra high effort · ~/git/grimoire`,
    ]);
    expect(texts('gr-schedules-page .runs li')).toEqual([`${when(dueAt)} Missed: the service wasn’t running in time`]);

    // Run now begins its chapter, which joins the book and is turned to.
    [...el.querySelectorAll<HTMLButtonElement>('gr-schedules-page .actions button')].find((b) => b.textContent!.includes('Run now'))!.click();
    await fixture.whenStable();
    expect(texts('.spine gr-ribbon b')).toContain('Morning repo summary · today');
    expect(texts('gr-running-head h1')).toEqual(['Morning repo summary · today']);
    expect(texts('.meta button')).toContain('Full access');

    // A new schedule is written out in place.
    el.querySelector<HTMLButtonElement>('gr-schedules-page .add')!.click();
    await fixture.whenStable();
    const field = (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    field('gr-schedule-name', 'Dependency check');
    field('gr-schedule-prompt', 'Check for outdated dependencies.');
    field('gr-schedule-time', '09:00');
    const word = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-schedule-form .word')].find((b) => b.textContent!.trim() === text)!;
    for (const day of ['Tue', 'Wed', 'Thu', 'Fri']) word(day).click();
    word('Sonnet 5.5').click();
    await fixture.whenStable();
    word('Low').click();
    await fixture.whenStable();
    expect(texts('gr-schedule-form .note')).toEqual([
      'Each run begins a new chapter with Full access: it edits files and runs commands without asking, as no one is there to approve.',
    ]);
    el.querySelector<HTMLButtonElement>('gr-schedule-form .send')!.click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'schedules.save')!.request).toEqual({
      name: 'Dependency check',
      agent: 'claude-code',
      settings: { cwd: 'C:/Users/me/git/grimoire', model: 'sonnet', effort: 'low' },
      prompt: 'Check for outdated dependencies.',
      days: [1],
      time: '09:00',
      enabled: true,
    });
    expect(el.querySelector('gr-schedule-form')).toBeNull();
  });

  it("shows the chapter's branch and review stamps, and its repository on the Git page", async () => {
    const { bridge, calls, answers } = fakeBridge();
    const now = Date.now();
    answers['git.status'] = (): GitStatus => ({
      root: 'C:/Users/me/git/grimoire',
      branch: 'feature/context-meter',
      head: 'abc1234',
      upstream: { name: 'origin/feature/context-meter', ahead: 2, behind: 0 },
      changes: [
        { path: 'ui/src/context-meter.component.ts', kind: 'modified', staged: false },
        { path: 'ui/src/context-meter.component.spec.ts', kind: 'new', staged: true },
      ],
    });
    answers['git.branches'] = (): GitBranches => ({
      trunk: 'master',
      branches: [
        { name: 'master', current: false, ahead: 0, behind: 0, subject: 'Merge the outline', at: now },
        { name: 'feature/context-meter', current: true, ahead: 3, behind: 1, subject: 'Draw the meter', at: now },
        {
          name: 'feature/storage-migrations',
          current: false,
          ahead: 1,
          behind: 4,
          subject: 'Add the migrations table',
          at: now,
          worktree: 'C:/Users/me/git/grimoire/.claude/worktrees/storage',
        },
      ],
    });
    answers['git.diff'] = () => [
      { kind: 'same', text: 'export class ContextMeter {' },
      { kind: 'removed', text: '  used = 0;' },
      { kind: 'inserted', text: '  used = input(0);' },
    ];
    answers['git.pullRequest'] = (): PullRequest => ({
      number: 12,
      title: 'Context meter',
      url: 'https://github.com/me/grimoire/pull/12',
      state: 'open',
      review: 'review-required',
      checks: { passed: 3, failed: 1, pending: 0 },
    });
    const { fixture, el, texts } = await render(bridge);

    expect(texts('gr-status-indicators button')).toEqual(['feature/context-meter']);
    const branch = el.querySelector<HTMLButtonElement>('gr-status-indicators button')!;
    expect(branch.getAttribute('title')).toBe(
      '2 files not committed · 2 ahead of origin/feature/context-meter',
    );
    expect(texts('gr-review-stamps button')).toEqual(['PR #12: in review', 'CI: 1 check failing']);
    expect(el.querySelector('gr-review-stamps .alert')!.textContent!.trim()).toBe('CI: 1 check failing');
    expect(calls.find((c) => c.command === 'git.status')!.request).toEqual({ cwd: 'C:/Users/me' });

    branch.click();
    await fixture.whenStable();
    expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Git']);
    expect(texts('gr-git-page h2')).toEqual(['~/git/grimoire']);
    expect(texts('gr-git-page .sub')).toEqual([
      'On feature/context-meter at abc1234· 2 ahead of origin/feature/context-meter',
      'Pull request #12: Context meter',
    ]);
    expect(texts('gr-git-page .change')).toEqual([
      'ui/src/context-meter.component.ts modified',
      'ui/src/context-meter.component.spec.ts new · staged',
    ]);
    expect(texts('gr-git-page .branch-row .name')).toEqual([
      'master',
      'feature/context-meter',
      'feature/storage-migrations',
    ]);
    expect(texts('gr-git-page .branch-row .distance')).toEqual([
      'the trunk',
      '3 ahead, 1 behind',
      '1 ahead, 4 behind',
    ]);
    expect(texts('gr-git-page .current .here')).toEqual(['checked out']);
    expect(texts('gr-git-page .grown .branch-row .name')).toHaveLength(2);
    expect(texts('gr-git-page .last')[2]).toContain(
      'in the worktree at ~/git/grimoire/.claude/worktrees/storage',
    );

    el.querySelector<HTMLButtonElement>('gr-git-page .change')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'git.diff').map((c) => c.request)).toEqual([
      { cwd: 'C:/Users/me', path: 'ui/src/context-meter.component.ts' },
    ]);
    expect(texts('gr-git-page gr-corrections .code')).toEqual([
      'export class ContextMeter {',
      'used = 0;',
      'used = input(0);',
    ]);
    expect(texts('gr-git-page gr-corrections .head .detail')[0]).toBe('corrections, not committed yet');

    // Folded back in.
    el.querySelector<HTMLButtonElement>('gr-git-page .change')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-git-page gr-corrections')).toBeNull();
  });

  it('says so on the Git page when the folder is not in a repository', async () => {
    const { fixture, el, texts } = await render(fakeBridge().bridge);
    [...el.querySelectorAll<HTMLButtonElement>('.tabs button')]
      .find((tab) => tab.textContent!.trim() === 'Git')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-git-page .none')).toEqual(['~ isn’t in a git repository.']);
  });

  it('keeps the Colophon’s settings with the service, and the book follows them', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const word = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-colophon-page .word')].find(
        (button) => button.textContent!.trim() === text,
      )!;
    const checked = () => texts('gr-colophon-page .word[aria-checked="true"]');
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-thumb-page .title')).toEqual(['Colophon']);
    expect(texts('gr-colophon-page .label')).toEqual([
      'Names',
      'Drawings',
      'Default agent for new chapters',
      'New chapters begin with',
    ]);
    expect(checked()).toEqual(['The book’s', 'Drawn', 'The one used last', 'Your last settings']);

    word('Plain').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'settings.set').map((c) => c.request)).toEqual([
      { wording: 'plain' },
    ]);
    expect(texts('gr-thumb-index .thumb:not(.index)')).toEqual([
      'History',
      'Workflow setup',
      'Kanban',
      'Memories',
      'Scheduled chats',
      'Usage',
      'Terminal',
      'Settings',
    ]);
    expect(texts('gr-thumb-page .title')).toEqual(['Settings']);
    expect(texts('gr-thumb-page .row .gr-link')).toEqual(['Back to Plan Esc']);
    expect(texts('gr-colophon-page .label')[2]).toBe('Default agent for new chats');
    expect(texts('gr-ribbon.new b')).toEqual(['New chat']);

    word('Left out').click();
    await fixture.whenStable();
    expect(document.documentElement.dataset['drawings']).toBe('off');

    // Another window changed them back.
    emit('settings.changed', { settings: DEFAULT_SETTINGS });
    await fixture.whenStable();
    expect(texts('gr-thumb-page .title')).toEqual(['Colophon']);
    expect(document.documentElement.dataset['drawings']).toBe('on');

    answers['settings.set'] = () => {
      throw new Error('the service is busy');
    };
    word('Plain').click();
    await fixture.whenStable();
    expect(checked()[0]).toBe('The book’s');
    expect(texts('gr-colophon-page [role="alert"]')).toEqual([
      'That setting couldn’t be kept: the service is busy',
    ]);
  });

  it('begins new chapters with the default agent, or the preset the Colophon names', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.list'] = () => [
      { id: 'claude-code', name: 'Claude Code', capabilities: [] },
      { id: 'codex', name: 'Codex', capabilities: [] },
    ];
    answers['presets.list'] = (): Preset[] => [
      { name: 'Bug fix', agent: 'codex', settings: { mode: 'accept-edits' } },
    ];
    let kept: GrimoireSettings = {
      ...DEFAULT_SETTINGS,
      newChapter: { from: 'preset', preset: 'Bug fix' },
    };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);

    // The blank page it opens on begins with the preset too.
    expect(texts('.meta button')[0]).toBe('Codex');
    expect(texts('.meta button').at(-1)).toBe('Bug fix');
    expect(texts('gr-ribbon.new i')).toEqual(['Bug fix · Ctrl+N']);

    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-colophon-page .word[aria-checked="true"]').slice(2)).toEqual([
      'The one used last',
      'Bug fix',
    ]);
    const word = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-colophon-page .word')].find(
        (button) => button.textContent!.trim() === text,
      )!;
    word('Your last settings').click();
    word('Claude Code').click();
    await fixture.whenStable();
    expect(kept.newChapter).toEqual({ from: 'last-used' });
    expect(kept.defaultAgent).toBe('claude-code');
    expect(texts('gr-ribbon.new i')).toEqual(['Last settings · Ctrl+N']);

    el.querySelector<HTMLButtonElement>('gr-ribbon.new button')!.click();
    await fixture.whenStable();
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
  });

  it('speaks plainly everywhere once the Colophon says so', async () => {
    const { bridge, answers } = fakeBridge();
    answers['settings.get'] = (): GrimoireSettings => ({ ...DEFAULT_SETTINGS, wording: 'plain' });
    const waiting = (id: string, title: string, command: string): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/Users/me/git/grimoire' },
      status: 'waiting',
      entries: [{ kind: 'user', id: 'u1', text: 'Run the tests' }],
      approvals: [{ id: `${id}-seal`, chatId: id, tool: 'Bash', input: { command }, at: 1 }],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [waiting('c1', 'Fix flaky login test', 'npm test')];
    answers['agents.chats'] = () => [
      { id: 'c1', agent: 'claude-code', title: 'Fix flaky login test', updatedAt: 1, dogEars: [], tags: [] },
    ];
    answers['layout.get'] = () => ({ current: 'c1', lastUsed: null });
    const { fixture, el, texts } = await render(bridge);
    // The book's own words, which plain wording has none of; the TOOL names and code stay as they are.
    const BOOK =
      /\b(chapters?|entry|entries|seals?|sealed|sealing|slips?|facing page|index|outline|colophon|ledger|scriptorium|table of contents|front matter|memory map|annotated|variorum|look up|thumb|begun)\b/i;
    const bookWords = () => {
      const said = [
        el.textContent!,
        ...[...el.querySelectorAll('[aria-label], [placeholder], [title]')].flatMap((node) =>
          ['aria-label', 'placeholder', 'title'].map((name) => node.getAttribute(name) ?? ''),
        ),
      ].join('\n');
      return said.split('\n').filter((line) => BOOK.test(line)).map((line) => line.trim());
    };
    const thumb = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
        .find((tab) => tab.textContent!.trim() === label)!
        .click();

    expect(bookWords()).toEqual([]);
    expect(texts('gr-ribbon.seals b')).toEqual(['Waiting for approval']);

    el.querySelector<HTMLButtonElement>('gr-ribbon.seals button')!.click();
    await fixture.whenStable();
    expect(texts('gr-seals-page .title')).toEqual(['Waiting for approval']);
    expect(texts('gr-seals-page .hint')).toEqual(['1 request from 1 chat, oldest first']);
    expect(bookWords()).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(texts('gr-index-page .title')).toEqual(['Command palette']);
    expect(texts('gr-index-page h3')).toEqual(['Actions', 'Chats']);
    expect(bookWords()).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();

    thumb('History');
    await fixture.whenStable();
    expect(texts('gr-thumb-page .title')).toEqual(['History']);
    expect(bookWords()).toEqual([]);
    for (const label of ['Scheduled chats', 'Terminal', 'Settings']) {
      thumb(label);
      await fixture.whenStable();
      expect(texts('gr-thumb-page .title')).toEqual([label]);
      expect(bookWords()).toEqual([]);
    }
    el.querySelector<HTMLButtonElement>('.meta button')!.click();
    await fixture.whenStable();
    expect(texts('gr-settings-card h2')).toEqual(['Settings for this chat']);
    expect(bookWords()).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('gr-ribbon.new button')!.click();
    await fixture.whenStable();
    expect(texts('gr-chapter-opening .kicker')).toEqual(['A new chat']);
    expect(bookWords()).toEqual([]);
  });
});
