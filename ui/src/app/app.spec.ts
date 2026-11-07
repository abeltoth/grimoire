import type { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AgentMemories,
  AgentSetup,
  AgentSignIn,
  CommandName,
  CommandRequest,
  EventName,
  EventPayload,
  FolderEntry,
  GitBranches,
  GitStatus,
  GrimoireBridge,
  GrimoireSettings,
  Memory,
  OpenChat,
  OpenFile,
  PingResult,
  Preset,
  PullRequest,
  ScheduleInfo,
  ScheduleRun,
  SetupFile,
  TokenTotals,
  TokenUse,
  UsageBreakdown,
  UsageReading,
  UsageSpan,
} from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { DENSITIES, TEXT_FONTS } from '../../../modules/colophon/ui/theme';
import { MONACO, type MonacoApi } from '../../../modules/files/ui/monaco';
import { clock, dateline, upcoming, when } from '../../../modules/schedules/ui/wording';
import { App } from './app';
import { appConfig } from './app.config';
import { GRIMOIRE_BRIDGE } from './core/bridge';
import { LEAF } from './core/leaf';

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
  const leafListeners = new Set<(chatId: string) => void>();
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
    popOut: vi.fn(),
    onLeafClosed: vi.fn((listener: (chatId: string) => void) => {
      leafListeners.add(listener);
      return () => leafListeners.delete(listener);
    }),
    ...overrides,
  };
  const emit = <K extends EventName>(event: K, payload: EventPayload<K>) =>
    listeners.get(event)?.forEach((listener) => listener(payload));
  /** A loose leaf's window closed. */
  const closeLeaf = (chatId: string) => leafListeners.forEach((listener) => listener(chatId));
  return { bridge, calls, emit, answers, closeLeaf };
}

async function render(bridge: GrimoireBridge, providers: Provider[] = []) {
  TestBed.configureTestingModule({
    providers: [...appConfig.providers, { provide: GRIMOIRE_BRIDGE, useValue: bridge }, ...providers],
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

  it('times the running turn by Stop, and shows how long each turn took once it ended', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fix the flaky login test');
    const user = { kind: 'user' as const, id: 'u1', text: 'Fix the flaky login test' };
    emit('agents.entry', { chatId: 'chat-1', entry: { ...user, at: Date.now() - 134_000 } });
    await fixture.whenStable();
    expect(texts('.stop')).toEqual(['Stop Esc 2m 14s']);
    expect(texts('.spent-line .took')).toEqual([]);

    emit('agents.entry', { chatId: 'chat-1', entry: { ...user, at: Date.now() - 200_000, took: 200_000 } });
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(texts('.stop')).toEqual([]);
    expect(texts('.spent-line .took')).toEqual(['3m 20s']);
    expect(el.querySelector('.spent-line .took')!.getAttribute('title')).toBe('This turn took 3m 20s');
  });

  it("shows what each turn spent at its end, the chapter's costliest three in rubric", async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'u1');
    const use = (input: number, output = 0) => ({
      model: 'claude-opus-5-5',
      input,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead: 0,
      output,
    });
    const turn = (id: string, ...uses: TokenUse[]) => ({
      chatId: 'chat-1',
      entry: { kind: 'user' as const, id, text: id, at: 1, took: 1, tokens: { at: 1, uses } },
    });
    emit('agents.entry', turn('u1', use(500, 100), { ...use(2_000), model: 'claude-haiku-4-5', subagent: true }));
    await fixture.whenStable();
    expect(texts('.spent-line .spent')).toEqual(['3K tokens']);
    // One turn alone isn't marked the costliest.
    expect(el.querySelector('.spent-line .spent.costly')).toBeNull();
    expect(el.querySelector('.spent-line .spent')!.getAttribute('title')).toBe(
      'This turn: 3K tokens, weighed as the API prices them\n' +
        'Opus 5.5: 500 fresh input, 100 output\n' +
        'Subagents on Haiku 4.5: 2K fresh input',
    );

    emit('agents.entry', turn('u2', use(500)));
    emit('agents.entry', turn('u3', use(4_000)));
    emit('agents.entry', turn('u4', use(100)));
    emit('agents.entry', turn('u5', use(2_000)));
    await fixture.whenStable();
    expect(texts('.spent-line .spent')).toEqual(['3K tokens', '500 tokens', '4K tokens', '100 tokens', '2K tokens']);
    expect(texts('.spent-line .spent.costly')).toEqual(['3K tokens', '4K tokens', '2K tokens']);
    expect(el.querySelector('.spent-line .spent.costly')!.getAttribute('title')).toMatch(
      /^One of the costliest turns in this chapter: 3K tokens/,
    );
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

  it('turns the facing page to what a helper did, from its note, and keeps it current as it works', async () => {
    const { bridge, emit, answers, calls } = fakeBridge();
    answers['agents.helper'] = () => ({
      entries: [
        {
          kind: 'agent',
          id: 'h1',
          model: 'claude-haiku-4-5',
          blocks: [
            { kind: 'tool', id: 'ht1', tool: 'Grep', input: { pattern: 'meter' }, result: { text: 'meter.ts', isError: false } },
            { kind: 'text', text: 'Found the meter.' },
          ],
        },
      ],
      state: 'working',
    });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Find the meter');
    const helperCall = {
      kind: 'tool' as const,
      id: 't1',
      tool: 'Agent',
      input: {
        description: 'Find the meter',
        prompt: 'Look for the context meter.',
        subagent_type: 'Explore',
        model: 'sonnet',
        run_in_background: true,
      },
    };
    emit('agents.entry', { chatId: 'chat-1', entry: { kind: 'agent', id: 'a1', blocks: [helperCall] } });
    await fixture.whenStable();

    const note = [...el.querySelectorAll<HTMLButtonElement>('gr-chapter-page .note')].find((n) =>
      n.textContent!.includes('Asked a helper'),
    )!;
    note.click();
    await fixture.whenStable();
    expect(calls.at(-1)).toEqual({ command: 'agents.helper', request: { chatId: 'chat-1', toolId: 't1' } });
    expect(texts('gr-facing-tabs .tabs [aria-pressed="true"]')).toEqual(['Find the meter']);
    expect(texts('gr-helper-page .title')).toEqual(['Find the meter']);
    expect(texts('gr-helper-page .meta')).toEqual(['Explore · Haiku 4.5 · Working…']);
    // Its task opens the page, signed by the agent that asked.
    expect(texts('gr-helper-page gr-transcript .you .who')).toEqual(['Claude Code']);
    expect(texts('gr-helper-page gr-transcript .you .text')).toEqual(['Look for the context meter.']);
    expect(el.querySelector('gr-helper-page gr-transcript .row')!.querySelector('.you')).not.toBeNull();
    expect(texts('gr-helper-page gr-transcript .reply .who')).toEqual(['Helper']);
    expect(texts('gr-helper-page gr-transcript .note > *')).toEqual(['*Searched', 'meter']);
    expect(el.querySelector('gr-helper-page gr-transcript .stop')).toBeNull();
    expect([...el.querySelectorAll('gr-helper-page gr-transcript .you .gr-link')]).toEqual([]);
    expect(el.querySelector('gr-helper-page gr-composer')).toBeNull();
    expect(texts('gr-helper-page gr-running-foot')).toEqual(['Working…']);

    // A background helper's tool call has its result at once; the helper is still at work.
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [{ ...helperCall, result: { text: 'Async agent launched successfully.', isError: false } }],
      },
    });
    emit('agents.helperEntry', {
      chatId: 'chat-1',
      toolId: 't1',
      entry: {
        kind: 'agent',
        id: 'h2',
        blocks: [{ kind: 'tool', id: 'ht2', tool: 'Bash', input: { command: 'npm test' } }],
      },
    });
    await fixture.whenStable();
    expect(texts('gr-helper-page gr-running-foot')).toEqual(['Working…']);
    expect(el.querySelector('gr-helper-page .line.waiting')).toBeNull();

    // It asks for your OK in the chapter, where you give it.
    emit('agents.approval', {
      approval: { id: 'ht2', chatId: 'chat-1', tool: 'Bash', input: { command: 'npm test' } },
    });
    await fixture.whenStable();
    expect(texts('gr-helper-page .line.waiting')).toEqual(['Awaiting your seal in the chapter']);
    expect(el.querySelector('gr-helper-page gr-approval-slip')).toBeNull();
    emit('agents.approvalSettled', { chatId: 'chat-1', approvalId: 'ht2' });
    await fixture.whenStable();
    expect(el.querySelector('gr-helper-page .line.waiting')).toBeNull();

    // It hands its report back, which reads as its last reply.
    emit('agents.helperEntry', {
      chatId: 'chat-1',
      toolId: 't1',
      entry: {
        kind: 'agent',
        id: 'h2',
        blocks: [
          { kind: 'tool', id: 'ht2', tool: 'Bash', input: { command: 'npm test' }, result: { text: 'ok', isError: false } },
        ],
      },
    });
    emit('agents.helperEntry', {
      chatId: 'chat-1',
      toolId: 't1',
      entry: {
        kind: 'agent',
        id: 'h3',
        blocks: [
          { kind: 'text', text: 'Handing it back.' },
          { kind: 'tool', id: 'ht3', tool: 'SubagentHandback', input: { message: 'It is in **meter.ts**.' } },
        ],
      },
    });
    emit('agents.helperState', { chatId: 'chat-1', toolId: 't1', state: 'done' });
    await fixture.whenStable();
    expect(texts('gr-helper-page gr-transcript .reply gr-markdown')).toEqual([
      'Found the meter.',
      'Handing it back.',
      'It is in meter.ts.',
    ]);
    expect(texts('gr-helper-page gr-transcript .note > *')).toEqual(['*Searched', 'meter', '†Ran', 'npm test']);
    expect(texts('gr-helper-page gr-running-foot')).toEqual(['Done']);
    expect(texts('gr-helper-page .meta')).toEqual(['Explore · Haiku 4.5 · Done']);
  });

  it('names the model a helper was asked to work on until it says which it works on', async () => {
    const { bridge, emit, answers } = fakeBridge();
    answers['agents.helper'] = () => ({ entries: [] });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Find the meter');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [{ kind: 'tool', id: 't1', tool: 'Agent', input: { description: 'Look', prompt: 'Look.', model: 'sonnet' } }],
      },
    });
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-chapter-page .note')]
      .find((n) => n.textContent!.includes('Asked a helper'))!
      .click();
    await fixture.whenStable();
    expect(texts('gr-helper-page .meta')).toEqual(['sonnet · Working…']);
    expect(texts('gr-helper-page .line')).toEqual(['The helper has only just begun.']);
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

  it('begins a chapter on Auto, then shows the model Auto picked', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.start'] = (request: CommandRequest<'agents.start'>): OpenChat => ({
      id: 'chat-1',
      agent: request.agent,
      title: '',
      settings: { ...request.settings, cwd: 'C:/work/grimoire', model: 'sonnet', effort: 'medium' },
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
    const model = () => el.querySelector<HTMLButtonElement>('.meta [data-setting="model"]')!;
    model().click();
    await fixture.whenStable();
    expect(texts('gr-settings-card [data-setting="model"] .choice')).toEqual([
      'Auto',
      'Opus 5.5',
      'Sonnet 5.5',
      'Haiku 5.5',
    ]);

    pick(el, 'Auto');
    await fixture.whenStable();
    expect(texts('gr-settings-card [data-setting="model"] [aria-checked="true"]')).toEqual(['Auto']);
    expect(texts('gr-settings-card [data-setting="effort"] .none')).toEqual(['Auto picks the effort too']);
    // Auto picks the effort with the model, so the head shows no effort yet.
    expect(texts('.meta button')).toEqual(['Claude Code', 'Auto', 'Ask first', '~', 'No preset']);
    expect(calls.filter((c) => c.command === 'layout.set').at(-1)?.request).toMatchObject({
      lastUsed: { agent: 'claude-code', settings: { autoModel: true } },
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    await write(fixture, el, 'Rename the ribbon');
    const started = calls.find((c) => c.command === 'agents.start')!.request as CommandRequest<'agents.start'>;
    expect(started.settings).toMatchObject({ autoModel: true });
    expect(started.settings.model).toBeUndefined();
    expect(texts('.meta button').slice(1, 3)).toEqual(['Auto: Sonnet 5.5', 'Medium effort']);

    // Once begun, Auto can't be picked again; another model ends it.
    model().click();
    await fixture.whenStable();
    expect(texts('gr-settings-card [data-setting="model"] .choice')).toEqual(['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']);
    expect(texts('gr-settings-card [data-setting="model"] .none')).toEqual([
      'Auto picked Sonnet 5.5 for your first entry',
    ]);
    pick(el, 'Opus 5.5');
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.configure')?.request).toEqual({
      chatId: 'chat-1',
      change: { model: 'opus' },
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

  it("turns MCP servers off for one chapter on its settings card, and not for the next", async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    answers['agents.setup'] = (request: CommandRequest<'agents.setup'>): AgentSetup => ({
      cwd: request.cwd ?? 'C:/Users/me',
      sections: {
        ...empty,
        mcpServers: [
          { name: 'github', source: 'project', tokens: 4200 },
          { name: 'slack', source: 'user', tokens: 900 },
        ],
      },
      settingsFiles: [],
      at: Date.now(),
    });
    answers['settings.get'] = () => ({ ...DEFAULT_SETTINGS, mcpOff: ['slack'] });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Hello');
    el.querySelector<HTMLButtonElement>('.meta [data-setting="mode"]')!.click();
    await fixture.whenStable();

    const column = 'gr-settings-card [data-setting="mcp"]';
    // What each costs; one off in every chapter stays off here.
    expect(texts(`${column} .choice`)).toEqual(['github 4,200 tokens', 'slack off in every chapter']);
    expect(texts(`${column} .choice[aria-checked="true"]`)).toEqual(['github 4,200 tokens']);
    expect(texts(`${column} .choice[aria-disabled]`)).toEqual(['slack off in every chapter']);
    expect(texts(`${column} .none`)).toEqual(['A change counts from its next turn']);

    pick(el, 'github');
    pick(el, 'slack');
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.configure').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', change: { mcpOff: ['github'] } },
    ]);
    emit('agents.settings', { chatId: 'chat-1', settings: { cwd: 'C:/work/grimoire', mcpOff: ['github'] } });
    await fixture.whenStable();
    expect(texts(`${column} .choice[aria-checked="true"]`)).toEqual([]);
    // A new chapter takes the settings used last, but not the servers turned off for this one.
    expect(calls.filter((c) => c.command === 'layout.set').at(-1)?.request).toEqual({
      lastUsed: { agent: 'claude-code', settings: { cwd: 'C:/work/grimoire' } },
    });
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
      'Single page',
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
    expect(texts('gr-ledger-page .plan h2')).toEqual(['Claude Code’s plan limits']);
    expect(texts('gr-ledger-page .sub')[0]).toMatch(/^Max plan, read at .+Read again$/);
    expect(texts('gr-ledger-page .plan .name')).toEqual([
      'Current session',
      'This week, all models',
      'This week, Opus',
    ]);
    expect(texts('gr-ledger-page .plan b')).toEqual(['37%', '70%', '12%']);
    expect(texts('gr-ledger-page .plan .resets')[0]).toMatch(/^resets at \S/);
    const meter = el.querySelector('gr-ledger-page .plan [role="meter"]')!;
    expect(meter.getAttribute('aria-valuenow')).toBe('37');

    el.querySelector<HTMLButtonElement>('gr-ledger-page .sub .gr-link')!.click();
    await fixture.whenStable();
    expect(texts('gr-ledger-page .plan b')[0]).toBe('38%');
    expect(calls.filter((call) => call.command === 'agents.usage')).toHaveLength(2);
  });

  it("draws the week's limit as steps and each session's peak in the Ledger, with a row a day", async () => {
    const { bridge, answers, calls } = fakeBridge();
    const now = Date.now();
    const minutes = (n: number) => now - n * 60_000;
    const lastWeek = minutes(3 * 24 * 60);
    const nextWeek = now + 4 * 24 * 60 * 60_000;
    const firstSession = minutes(100);
    const secondSession = now + 270 * 60_000;
    answers['agents.usage'] = () => ({
      plan: 'max',
      windows: [
        { span: 'session', used: 40, resetsAt: secondSession },
        { span: 'week', used: 20, resetsAt: nextWeek },
      ],
      at: now,
    });
    answers['agents.usageHistory'] = (): UsageReading[] => [
      { at: minutes(4 * 24 * 60), span: 'week', used: 90, resetsAt: lastWeek },
      { at: minutes(300), span: 'session', used: 10, resetsAt: firstSession },
      { at: minutes(300), span: 'week', used: 15, resetsAt: nextWeek },
      // A reset read a few seconds off is the same session.
      { at: minutes(285), span: 'session', used: 60, resetsAt: firstSession + 30_000 },
      { at: minutes(30), span: 'session', used: 35, resetsAt: secondSession },
      { at: minutes(15), span: 'session', used: 40, resetsAt: secondSession },
      { at: minutes(15), span: 'week', used: 20, resetsAt: nextWeek },
    ];
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    const since = (calls.find((c) => c.command === 'agents.usageHistory')!.request as { since: number }).since;
    expect(now - since).toBeGreaterThan(7 * 24 * 60 * 60_000 - 60_000);
    expect(texts('gr-ledger-page .plan figcaption')).toEqual([
      'The week\u2019s limit over the last 7 days',
      'How full each session got',
    ]);
    // One series each: the caption names it, with no legend.
    expect(el.querySelector('gr-ledger-page .plan .legend')).toBeNull();
    // Last week's reading stands apart from this week's steps, with the new week marked.
    const steps = [...el.querySelectorAll('gr-ledger-page .plan path.line')].map((p) => p.getAttribute('d')!);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatch(/^M[\d.]+,[\d.]+H[\d.]+V[\d.]+$/);
    expect(texts('gr-ledger-page .plan .mark-label')).toEqual(['New week']);
    expect(texts('gr-ledger-page .plan .end-label')).toEqual(['20%']);

    // A row a day, in place of every reading.
    const rows = [...el.querySelectorAll('gr-ledger-page .plan tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent!.trim()),
    );
    // Only the days anything was read.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows[0]).toEqual(['\u2013', '90%']);
    expect(rows.some(([, week]) => week === '20%')).toBe(true);

    // Two sessions, each at its peak.
    const sessions = el.querySelectorAll('gr-ledger-page .plan gr-ledger-columns rect.hit');
    expect(sessions).toHaveLength(2);
    sessions[0]!.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(texts('gr-ledger-page .plan gr-ledger-columns .tip strong')).toEqual(['60%']);

    // Focus puts the crosshair on the latest reading; the arrow keys step back.
    const plot = el.querySelector<SVGRectElement>('gr-ledger-page .plan gr-ledger-lines rect.hit')!;
    plot.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(texts('gr-ledger-page .plan gr-ledger-lines .tip strong')).toEqual(['20%']);
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await fixture.whenStable();
    expect(texts('gr-ledger-page .plan gr-ledger-lines .tip strong')).toEqual(['15%']);
    expect(plot.getAttribute('aria-label')).toMatch(/This week, all models 15%$/);
  });

  it('draws the tokens and the share served from the cache by day and by hour in the Ledger', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.usage'] = () => ({ plan: 'max', windows: [], at: 0 });
    answers['agents.usageBreakdown'] = () => null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = (back: number) => {
      const date = new Date(today);
      date.setDate(date.getDate() - back);
      const two = (n: number) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    };
    const counts = (input: number, cacheRead: number, output: number) => ({
      input,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead,
      output,
      weight: input + cacheRead * 0.1 + output * 5,
    });
    const hour = new Date();
    hour.setMinutes(0, 0, 0);
    answers['tokens.totals'] = ({ since }: CommandRequest<'tokens.totals'>): TokenTotals => ({
      since,
      total: counts(1_300, 9_000, 100),
      days: [
        { day: day(2), ...counts(1_000, 3_000, 0) },
        { day: day(0), ...counts(300, 6_000, 100) },
      ],
      hours: [{ hour: hour.getTime(), ...counts(300, 6_000, 100) }],
      models: [],
      folders: [],
      chats: [],
      tools: [],
      skills: [],
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .tabs button')]
      .find((button) => button.textContent!.trim() === 'Where it went')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-ledger-page figcaption')).toEqual(['Tokens by day', 'Served from the cache']);
    expect(texts('gr-ledger-page gr-ledger-columns .legend li')).toEqual([
      'Read from the cache',
      'Written to the cache',
      'Fresh input',
      'Output',
    ]);
    // A column for each day of the span, the days without turns empty.
    const columns = el.querySelectorAll('gr-ledger-page gr-ledger-columns rect.hit');
    expect(columns.length).toBeGreaterThanOrEqual(8);
    const rows = [...el.querySelectorAll('gr-ledger-page gr-ledger-columns tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent!.trim()),
    );
    // Weighed: a cache read a tenth, output five times.
    expect(rows[rows.length - 1]).toEqual(['600', '0', '300', '500', '1.4K']);
    expect(rows[rows.length - 2]).toEqual(['0', '0', '0', '0', '0']);
    expect(rows[rows.length - 3]).toEqual(['300', '0', '1K', '0', '1.3K']);
    expect(texts('gr-ledger-page gr-ledger-lines tbody td')).toEqual(['75%', '95%']);

    columns[columns.length - 1]!.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(texts('gr-ledger-page gr-ledger-columns .tip strong')).toEqual(['1.4K', '600', '0', '300', '500']);

    [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .spans button')]
      .find((button) => button.textContent!.trim() === 'Last 24 hours')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-ledger-page figcaption')).toEqual(['Tokens by hour', 'Served from the cache']);
    expect(el.querySelectorAll('gr-ledger-page gr-ledger-columns rect.hit').length).toBeGreaterThanOrEqual(24);
    expect(texts('gr-ledger-page gr-ledger-lines tbody td')).toEqual(['95%']);
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
    expect(texts('gr-ledger-page .plan .none')).toEqual([]);
    const spent = (12345 / 100).toLocaleString([], { style: 'currency', currency: 'USD' });
    const limit = (600).toLocaleString([], { style: 'currency', currency: 'USD' });
    expect(texts('gr-ledger-page .plan .name')).toEqual([`Usage credits this month ${spent} of ${limit}`]);
    expect(texts('gr-ledger-page .plan .resets')[0]).toMatch(/^resets on \S/);
    expect(texts('gr-ledger-page .plan b')).toEqual(['21%']);
    const meter = el.querySelector('gr-ledger-page .plan [role="meter"]')!;
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
    expect(texts('gr-ledger-page .plan .spent')).toEqual([`${spent} spent, no limit`]);
    expect(el.querySelector('gr-ledger-page .plan [role="meter"]')).toBeNull();
  });

  it('says so in the Ledger when the agent has no plan limits', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.usage'] = () => ({ plan: null, windows: [], at: 0 });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-ledger-page .plan .none')).toEqual([
      'No limits to show: Claude Code isn’t signed in with a Claude subscription.',
    ]);
  });

  it("shows where the tokens went in the Ledger, as Claude Code says and by Grimoire's count", async () => {
    const { bridge, answers, calls } = fakeBridge();
    answers['agents.usage'] = () => ({ plan: 'max', windows: [], at: 0 });
    const span = (requests: number): UsageSpan => ({
      requests,
      chats: 4,
      behaviours: [
        { key: 'long_context', share: 80, requests: 40 },
        { key: 'brand_new', share: 5.4, requests: 2 },
      ],
      advice: [{ key: 'long_context', share: 80, title: 'Start fresh when you switch tasks', detail: 'run /clear' }],
      sources: [{ kind: 'mcp', name: 'docs', share: 9 }],
    });
    answers['agents.usageBreakdown'] = (): UsageBreakdown => ({ day: span(10), week: span(70), at: 0 });
    const total = (weight: number) => ({
      input: weight,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead: 0,
      output: 0,
      weight,
    });
    answers['tokens.totals'] = ({ since }: CommandRequest<'tokens.totals'>): TokenTotals => ({
      since,
      total: total(4_000),
      days: [{ day: '2026-11-05', ...total(4_000) }],
      hours: [{ hour: new Date(2026, 10, 5, 14).getTime(), ...total(4_000) }],
      models: [
        { model: 'claude-opus-5-5', subagent: false, ...total(3_000) },
        { model: 'claude-haiku-4-5', subagent: true, ...total(1_000) },
      ],
      folders: [{ cwd: 'C:/work/grimoire', ...total(4_000) }],
      chats: [{ id: 'old-1', agent: 'claude-code', title: 'Ribbon', cwd: 'C:/work/grimoire', ...total(4_000) }],
      tools: [
        { name: 'Read', uses: 40 },
        { name: 'Bash', uses: 10 },
      ],
      skills: [{ name: 'code-review', uses: 1 }],
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    const showView = async (name: string) => {
      [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .tabs button')]
        .find((button) => button.textContent!.trim() === name)!
        .click();
      await fixture.whenStable();
    };
    expect(texts('gr-ledger-page h2')).toEqual(['Claude Code’s plan limits']);
    expect(texts('gr-ledger-page .tabs [aria-selected="true"]')).toEqual(['Limits']);

    await showView('Where it went');
    expect(texts('gr-ledger-page .spans [aria-checked="true"]')).toEqual(['Last 7 days']);
    const pick = async (name: string) => {
      [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .groups button')]
        .find((button) => button.textContent!.trim() === name)!
        .click();
      await fixture.whenStable();
    };
    expect(texts('gr-ledger-page .tokens h3')).toEqual(['Claude Code’s advice', 'By Grimoire’s count']);
    expect(texts('gr-ledger-page .groups [aria-checked="true"]')).toEqual(['Day']);
    expect(texts('gr-ledger-page .tokens h4')).toEqual(['Ways of working', 'What took a share']);
    const day = new Date(2026, 10, 5).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    // Advice, the total, and the one list shown: by day.
    expect(texts('gr-ledger-page .tokens > .advice .name, .tokens > .total .name, .tokens > .limits .name')).toEqual([
      'Start fresh when you switch tasks',
      '4K tokens',
      day,
    ]);
    expect(texts('gr-ledger-page .tokens > .limits b')).toEqual(['100%']);
    await pick('Model');
    expect(texts('gr-ledger-page .tokens > .limits .name')).toEqual(['Opus 5.5', 'Subagents on Haiku 4.5']);
    expect(texts('gr-ledger-page .tokens > .limits b')).toEqual(['75%', '25%']);
    await pick('Folder');
    expect(texts('gr-ledger-page .tokens > .limits .name')).toEqual(['C:/work/grimoire']);
    await pick('Day');
    // Claude Code's own scan is folded away, with the explanations.
    expect(texts('gr-ledger-page .how summary')).toEqual(['Claude Code’s own scan', 'How this is counted']);
    expect(texts('gr-ledger-page .how .name')).toEqual(['Long context', 'brand new', 'docs']);
    // A way of working Grimoire has no name for keeps Claude Code's.
    expect(texts('gr-ledger-page .how b')).toEqual(['80%', '5%', '9%']);
    expect(texts('gr-ledger-page .tokens .detail')).toEqual(['run /clear', '4K fresh input']);
    expect(texts('gr-ledger-page .how p')[0]).toBe('70 requests in 4 chats');

    await showView('Tools & skills');
    expect(texts('gr-ledger-page .tokens h4')).toEqual(['The tools used most', 'The skills used most']);
    expect(texts('gr-ledger-page .tokens .name')).toEqual(['Read', 'Bash', 'code-review']);
    expect(texts('gr-ledger-page .tokens b')).toEqual(['40', '10', '1']);
    // Each tool's and skill's uses, against the most used in its list.
    expect(texts('gr-ledger-page [data-used] .resets')).toEqual(['40 uses', '10 uses', '1 use']);
    expect(
      [...el.querySelectorAll('gr-ledger-page [data-used="tools"] [role="meter"]')].map((m) =>
        m.getAttribute('aria-valuenow'),
      ),
    ).toEqual(['100', '25']);
    await showView('Where it went');

    // The last 24 hours: Claude Code's scan already has them; Grimoire counts again.
    const asked = () =>
      calls
        .filter((c) => c.command === 'tokens.totals')
        .map((c) => (c.request as CommandRequest<'tokens.totals'>).since);
    [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .spans button')]
      .find((button) => button.textContent!.trim() === 'Last 24 hours')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-ledger-page .how p')[0]).toBe('10 requests in 4 chats');
    expect(asked()).toHaveLength(2);
    expect(asked()[1]! - asked()[0]!).toBeGreaterThan(6 * 24 * 60 * 60_000 - 60_000);
    expect(calls.filter((c) => c.command === 'agents.usageBreakdown')).toHaveLength(1);

    // A chat that weighed much opens from the list.
    await pick('Chat');
    [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .tokens button.name')]
      .find((button) => button.textContent!.trim() === 'Ribbon')!
      .click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.open')!.request).toEqual({
      agent: 'claude-code',
      chatId: 'old-1',
      settings: { cwd: 'C:/work/grimoire' },
    });
  });

  it("says so in the Ledger when there's nothing to say of the tokens", async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.usage'] = () => ({ plan: 'max', windows: [], at: 0 });
    answers['agents.usageBreakdown'] = () => null;
    answers['tokens.totals'] = () => {
      throw new Error('The search stopped');
    };
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .tabs button')]
      .find((button) => button.textContent!.trim() === 'Where it went')!
      .click();
    await fixture.whenStable();
    // No scan from Claude Code: only Grimoire's count, which failed.
    expect(texts('gr-ledger-page .tokens h3')).toEqual(['By Grimoire’s count']);
    expect(texts('gr-ledger-page .tokens .none')).toEqual([
      'The chats’ tokens couldn’t be counted: The search stopped',
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
    expect(texts('.tabs [aria-disabled="true"]')).toEqual([]);
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
      [...el.querySelectorAll<HTMLButtonElement>('#gr-colophon-settings ~ .form .word')].find(
        (button) => button.textContent!.trim() === text,
      )!;
    const checked = () => texts('#gr-colophon-settings ~ .form .word[aria-checked="true"]');
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-thumb-page .title')).toEqual(['Colophon']);
    expect(texts('section[aria-labelledby="gr-colophon-settings"] .label')).toEqual([
      'Names',
      'Drawings',
      'Default agent for new chapters',
      'New chapters begin with',
      'MCP servers in every chapter',
    ]);
    expect(checked()).toEqual(['The book’s', 'Drawn', 'The one used last', 'Your last settings']);
    expect(texts('gr-colophon-page [aria-labelledby="gr-colophon-mcp"] .none')).toEqual(['None']);

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
    expect(texts('section[aria-labelledby="gr-colophon-settings"] .label')[2]).toBe('Default agent for new chats');
    expect(texts('gr-ribbon.new b')).toEqual(['New chat']);

    word('Left out').click();
    await fixture.whenStable();
    expect(document.documentElement.dataset['drawings']).toBe('off');

    // Another window changed them back.
    kept = { ...DEFAULT_SETTINGS };
    emit('settings.changed', { settings: kept });
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

  it('turns MCP servers off in every chat on the Colophon', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    answers['agents.setup'] = (request: CommandRequest<'agents.setup'>): AgentSetup => ({
      cwd: request.cwd ?? 'C:/Users/me',
      sections: {
        ...empty,
        mcpServers: [
          { name: 'github', source: 'user', tokens: 4200 },
          { name: 'claude.ai Gmail', source: 'account' },
        ],
      },
      settingsFiles: [],
      at: Date.now(),
    });
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS, mcpOff: ['linear'] };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();

    const row = 'gr-colophon-page [aria-labelledby="gr-colophon-mcp"]';
    // Those your agents load, and those turned off they no longer list; the ones on underlined.
    expect(texts(`${row} .word`)).toEqual(['github', 'claude.ai Gmail', 'linear']);
    expect(texts(`${row} .word[aria-checked="true"]`)).toEqual(['github', 'claude.ai Gmail']);

    el.querySelector<HTMLButtonElement>(`${row} .word`)!.click();
    await fixture.whenStable();
    el.querySelectorAll<HTMLButtonElement>(`${row} .word`)[2]!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'settings.set').map((c) => c.request)).toEqual([
      { mcpOff: ['linear', 'github'] },
      { mcpOff: ['github'] },
    ]);
    // One turned on again that no agent lists any more is gone.
    expect(texts(`${row} .word`)).toEqual(['github', 'claude.ai Gmail']);
    expect(texts(`${row} .word[aria-checked="true"]`)).toEqual(['claude.ai Gmail']);
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
    expect(
      texts('#gr-colophon-settings ~ .form .word[aria-checked="true"]').slice(2),
    ).toEqual(['The one used last', 'Bug fix']);
    const word = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('#gr-colophon-settings ~ .form .word')].find(
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
      /\b(chapters?|entry|entries|seals?|sealed|sealing|slips?|facing page|index|outline|colophon|ledger|scriptorium|table of contents|front matter|memory map|look up|thumb|begun)\b/i;
    const bookWords = () => {
      // The theme file's own headings are its source, as its token names are.
      const book = el.cloneNode(true) as HTMLElement;
      book.querySelectorAll('gr-theme-editor summary').forEach((heading) => heading.remove());
      const said = [
        book.textContent!,
        ...[...book.querySelectorAll('[aria-label], [placeholder], [title]')].flatMap((node) =>
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

  it('switches the account Claude Code signs in as on the Colophon, for every chat', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    answers['agents.list'] = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['sign-in'] }];
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS, accounts: ['mum@example.com'] };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const me = { email: 'me@example.com', plan: 'pro', expiresAt: null };
    answers['agents.account'] = (): AgentSignIn => ({ agent: 'claude-code', account: me, pending: null });
    let finish!: (state: AgentSignIn) => void;
    let fail!: (error: Error) => void;
    answers['agents.signIn'] = () =>
      new Promise<AgentSignIn>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    const row = '[aria-labelledby="gr-colophon-account"]';
    const word = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>(`${row} .word`)].find(
        (button) => button.textContent!.trim() === text,
      )!;
    const link = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-colophon-page .gr-link')].find(
        (button) => button.textContent!.trim() === text,
      )!;
    const signIns = () => calls.filter((c) => c.command === 'agents.signIn').map((c) => c.request);

    expect(texts('section[aria-labelledby="gr-colophon-settings"] .label').at(-1)).toBe(
      'Claude Code signs in as',
    );
    expect(texts(`${row} .word`)).toEqual(['mum@example.com', 'me@example.com']);
    expect(texts(`${row} .word[aria-checked="true"]`)).toEqual(['me@example.com']);
    expect(texts('gr-colophon-page .note').at(-1)).toMatch(/^Pro\. Every chapter uses it/);

    // Signing in to another keeps the one signed in as, to switch back to.
    word('mum@example.com').click();
    await fixture.whenStable();
    expect(kept.accounts).toEqual(['mum@example.com', 'me@example.com']);
    expect(signIns()).toEqual([{ agent: 'claude-code', email: 'mum@example.com' }]);
    emit('agents.account', {
      agent: 'claude-code',
      account: me,
      pending: { email: 'mum@example.com', url: 'https://example.com/sign-in' },
    });
    await fixture.whenStable();
    expect(texts('gr-colophon-page [role="status"]')[0]).toMatch(
      /^Waiting for you to sign in as mum@example\.com in the browser\. Copy the sign-in link Cancel$/,
    );
    expect(word('me@example.com').disabled).toBe(true);
    const code = el.querySelector<HTMLInputElement>('#gr-colophon-sign-in-code')!;
    code.value = 'abc#123';
    code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.signInCode')!.request).toEqual({
      agent: 'claude-code',
      code: 'abc#123',
    });

    const mum: AgentSignIn = {
      agent: 'claude-code',
      account: { email: 'mum@example.com', plan: 'max', expiresAt: null },
      pending: null,
    };
    emit('agents.account', mum);
    finish(mum);
    await fixture.whenStable();
    expect(texts(`${row} .word[aria-checked="true"]`)).toEqual(['mum@example.com']);
    expect(texts('gr-colophon-page .note').at(-1)).toMatch(/^Max\. /);

    // Forgetting an account takes it off the list only.
    el.querySelector<HTMLButtonElement>(`${row} [aria-label="Forget me@example.com"]`)!.click();
    await fixture.whenStable();
    expect(kept.accounts).toEqual(['mum@example.com']);

    // Another account is signed in to once its email is written; a failure says why.
    link('Another account').click();
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('gr-colophon-page .account-field')!;
    expect(document.activeElement).toBe(field);
    field.value = 'dad@example.com';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(signIns().at(-1)).toEqual({ agent: 'claude-code', email: 'dad@example.com' });
    expect(kept.accounts).toEqual(['mum@example.com', 'dad@example.com']);
    fail(new Error('Login failed: the account is on hold'));
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(texts('gr-colophon-page [role="alert"]')).toEqual(['Login failed: the account is on hold']);
  });

  it('keeps presets on the Colophon, to rename, remove, and give a first entry new chapters begin with', async () => {
    const { bridge, answers, calls } = fakeBridge();
    let saved: Preset[] = [
      { name: 'Bug fix', agent: 'claude-code', settings: { mode: 'accept-edits', cwd: 'C:/Users/me/git/breeder' } },
      { name: 'Plan a feature', agent: 'claude-code', settings: { mode: 'plan' } },
    ];
    answers['presets.list'] = () => saved;
    answers['presets.save'] = (preset: Preset) =>
      (saved = saved.map((p) => (p.name === preset.name ? preset : p)));
    answers['presets.rename'] = ({ from, to }: { from: string; to: string }) =>
      (saved = saved.map((p) => (p.name === from ? { ...p, name: to } : p)));
    answers['presets.remove'] = ({ name }: { name: string }) =>
      (saved = saved.filter((p) => p.name !== name));
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    const preset = (name: string) =>
      [...el.querySelectorAll<HTMLElement>('gr-colophon-page .preset')].find(
        (article) => article.querySelector('h3')?.textContent!.trim() === name,
      )!;
    const link = (within: HTMLElement, text: string) =>
      [...within.querySelectorAll<HTMLButtonElement>('.gr-link')].find(
        (button) => button.textContent!.trim() === text,
      )!;

    expect(texts('gr-colophon-page .preset h3')).toEqual(['Bug fix', 'Plan a feature']);
    expect(texts('gr-colophon-page .preset .sub')[0]).toBe('Claude Code · Accept edits · ~/git/breeder');

    const prompt = preset('Bug fix').querySelector<HTMLTextAreaElement>('textarea')!;
    prompt.value = 'Find the failing test and fix it';
    prompt.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'presets.save')!.request).toMatchObject({
      name: 'Bug fix',
      prompt: 'Find the failing test and fix it',
    });

    link(preset('Plan a feature'), 'Rename').click();
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('gr-colophon-page .name-field')!;
    expect(document.activeElement).toBe(field);
    field.value = 'Plan it';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'presets.rename').map((c) => c.request)).toEqual([
      { from: 'Plan a feature', to: 'Plan it' },
    ]);
    expect(texts('gr-colophon-page .preset h3')).toEqual(['Bug fix', 'Plan it']);

    link(preset('Plan it'), 'Remove').click();
    await fixture.whenStable();
    expect(texts('gr-colophon-page .ask')).toEqual([
      'Remove “Plan it”? Chapters begun with it keep their settings.',
    ]);
    preset('Plan it').querySelector<HTMLButtonElement>('.danger')!.click();
    await fixture.whenStable();
    expect(texts('gr-colophon-page .preset h3')).toEqual(['Bug fix']);

    // New chapters begin with the preset, its first entry written in.
    [...el.querySelectorAll<HTMLButtonElement>('#gr-colophon-settings ~ .form .word')]
      .find((word) => word.textContent!.trim() === 'Bug fix')!
      .click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-ribbon.new button')!.click();
    await fixture.whenStable();
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    expect(entry.value).toBe('Find the failing test and fix it');
    expect(texts('.meta button').at(-1)).toBe('Bug fix');
  });

  it('changes the theme’s tokens on the Colophon, the book showing each change at once', async () => {
    const { bridge, answers, calls } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const root = document.documentElement.style;
    const sets = () => calls.filter((c) => c.command === 'settings.set').map((c) => c.request);
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await fixture.whenStable();
    };
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    for (let i = 0; i < 50 && !el.querySelector('gr-theme-editor details'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fixture.whenStable();
    }

    expect(texts('gr-theme-editor .form .label')).toEqual([
      'Desk',
      'Cover',
      'Paper',
      'Ink',
      'Soft ink',
      'Rubric',
      'Pen',
      'Lapis',
      'Gilt',
      'Size of the text',
      'Face of the text',
      'Room on the page',
    ]);
    expect(texts('gr-theme-editor summary')[0]).toMatch(/^Desk, binding and thumb index\s*\d+$/);
    // Folded shut until opened.
    expect(el.querySelector('gr-theme-editor li')).toBeNull();

    const paper = el.querySelector<HTMLInputElement>('#gr-theme---gr-page')!;
    expect(paper.value).toBe('#f3ebd9');
    paper.value = '#fffaf0';
    paper.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(root.getPropertyValue('--gr-page')).toBe('#fffaf0');
    // Kept once you stop, not at every step.
    paper.value = '#ffffff';
    paper.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(sets()).toEqual([]);
    await settle();
    expect(sets()).toEqual([{ theme: { '--gr-page': '#ffffff' } }]);
    expect(texts('gr-theme-editor .count')).toEqual([expect.stringMatching(/ tokens · 1 changed$/)]);

    const field = el.querySelector<HTMLInputElement>('#gr-theme-look-up')!;
    field.value = 'composer';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-theme-editor summary')).toEqual([expect.stringMatching(/^Chat: composer\s*\d+$/)]);
    const gap = el.querySelector<HTMLInputElement>('gr-theme-editor input[aria-label="--gr-composer-gap"]')!;
    expect(gap.value).toBe('5px');
    gap.value = '8px';
    gap.dispatchEvent(new Event('change'));
    await settle();
    expect(root.getPropertyValue('--gr-composer-gap')).toBe('8px');
    expect(kept.theme).toEqual({ '--gr-page': '#ffffff', '--gr-composer-gap': '8px' });

    // Written back as drawn, it's no longer changed.
    gap.value = '5px';
    gap.dispatchEvent(new Event('change'));
    await settle();
    expect(kept.theme).toEqual({ '--gr-page': '#ffffff' });
    expect(root.getPropertyValue('--gr-composer-gap')).toBe('');

    [...el.querySelectorAll<HTMLButtonElement>('gr-theme-editor .gr-link')]
      .find((button) => button.textContent!.trim() === 'Reset all')!
      .click();
    await fixture.whenStable();
    expect(kept.theme).toEqual({});
    expect(root.getPropertyValue('--gr-page')).toBe('');
  });

  it('sets the text’s face and the room on the page on the Colophon, as changes to the theme', async () => {
    const { bridge, answers } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const root = document.documentElement.style;
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await fixture.whenStable();
    };
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    for (let i = 0; i < 50 && !el.querySelector('gr-theme-editor details'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fixture.whenStable();
    }
    const group = (name: string) =>
      el.querySelector(`gr-theme-editor [aria-labelledby="gr-theme-${name}"]`)!;
    const words = (name: string) => [...group(name).querySelectorAll<HTMLButtonElement>('.word')];
    const named = (name: string) => words(name).map((button) => button.textContent!.trim());
    const word = (name: string, label: string) => words(name)[named(name).indexOf(label)]!;
    const picked = (name: string) =>
      words(name)
        .filter((button) => button.getAttribute('aria-checked') === 'true')
        .map((button) => button.textContent!.trim());
    const reset = (name: string) =>
      group(name).parentElement!.querySelector<HTMLButtonElement>('.gr-link');
    const [, sans, , mono] = TEXT_FONTS;
    const [compact, , roomy] = DENSITIES;

    expect(named('font')).toEqual(['The book’s', 'Sans-serif', 'Serif', 'Monospace']);
    expect(picked('font')).toEqual(['The book’s']);
    expect(named('density')).toEqual(['Compact', 'Normal', 'Roomy']);
    // Normal is the book as drawn: nothing changed, nothing to reset.
    expect(picked('density')).toEqual(['Normal']);
    expect(reset('font')).toBeNull();
    expect(reset('density')).toBeNull();

    word('font', 'Sans-serif').click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value });
    expect(root.getPropertyValue('--gr-font-text')).toBe(sans!.value);
    expect(picked('font')).toEqual(['Sans-serif']);

    word('density', 'Compact').click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value, ...compact!.tokens });
    expect(root.getPropertyValue('--gr-space-3')).toBe('9px');
    expect(picked('density')).toEqual(['Compact']);
    const changed = Object.keys(compact!.tokens).length + 1;
    expect(texts('gr-theme-editor .count')).toEqual([
      expect.stringMatching(new RegExp(` · ${changed} changed$`)),
    ]);

    // Roomy takes Compact's place; the face stays.
    word('density', 'Roomy').click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value, ...roomy!.tokens });

    // One of its tokens changed by hand is none of the densities.
    const field = el.querySelector<HTMLInputElement>('#gr-theme-look-up')!;
    field.value = '--gr-space-3';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const space = el.querySelector<HTMLInputElement>(
      'gr-theme-editor input[aria-label="--gr-space-3"]',
    )!;
    expect(space.value).toBe('15px');
    space.value = '14px';
    space.dispatchEvent(new Event('change'));
    await settle();
    expect(picked('density')).toEqual([]);

    reset('density')!.click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value });
    expect(root.getPropertyValue('--gr-space-3')).toBe('');
    expect(picked('density')).toEqual(['Normal']);

    word('font', 'The book’s').click();
    await settle();
    expect(kept.theme).toEqual({});
    expect(root.getPropertyValue('--gr-font-text')).toBe('');
    expect(reset('font')).toBeNull();

    // Another theme starts afresh, the face and the density with it, even before they were kept.
    word('font', 'Monospace').click();
    word('density', 'Compact').click();
    await fixture.whenStable();
    expect(root.getPropertyValue('--gr-font-text')).toBe(mono!.value);
    [...el.querySelectorAll<HTMLButtonElement>('gr-theme-editor .theme')]
      .find((button) => button.querySelector('.theme-name')!.textContent!.trim() === 'Sepia')!
      .click();
    await settle();
    expect(kept.themeName).toBe('sepia');
    expect(kept.theme).toEqual({});
    expect(picked('font')).toEqual(['The book’s']);
    expect(picked('density')).toEqual(['Normal']);
  });

  it('chooses a ready-made theme on the Colophon, which starts afresh from it', async () => {
    const { bridge, answers } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS, theme: { '--gr-page': '#fffaf0' } };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const theme = () => document.documentElement.dataset['theme'];
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-theme-editor .theme-name')).toEqual([
      'Grimoire',
      'Night',
      'Sepia',
      'High contrast',
      'Automatic',
    ]);
    const card = (name: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-theme-editor .theme')].find(
        (button) => button.querySelector('.theme-name')!.textContent!.trim() === name,
      )!;
    expect(card('Grimoire').getAttribute('aria-checked')).toBe('true');
    expect(theme()).toBe('grimoire');

    card('Night').click();
    await fixture.whenStable();
    expect(kept.themeName).toBe('night');
    // The colour changed over Grimoire isn't carried over to Night.
    expect(kept.theme).toEqual({});
    expect(theme()).toBe('night');
    expect(card('Night').getAttribute('aria-checked')).toBe('true');
    expect(card('Grimoire').getAttribute('aria-checked')).toBe('false');

    // Automatic follows the system, which a test's window calls light.
    card('Automatic').click();
    await fixture.whenStable();
    expect(kept.themeName).toBe('auto');
    expect(theme()).toBe('grimoire');
  });

  it('lays the chapter alone on the desk at Single page, and brings everything back at Two pages', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el } = await render(bridge);

    const shown = (selector: string) => el.querySelector(selector) !== null;

    [...el.querySelectorAll<HTMLButtonElement>('gr-facing-page .gr-link')]
      .find((link) => link.textContent!.includes('Single page'))!
      .click();
    await fixture.whenStable();
    expect(el.classList).toContain('focus');
    expect(el.classList).toContain('single');
    expect(shown('gr-title-strip')).toBe(false);
    expect(shown('gr-thumb-index')).toBe(false);
    expect(shown('gr-ribbons')).toBe(false);
    expect(shown('gr-facing-page')).toBe(false);
    expect(shown('.desk.end gr-window-controls [aria-label="Close window"]')).toBe(true);
    expect(calls).toContainEqual({ command: 'layout.set', request: { focus: true } });

    // The Index comes back beside the chapter, and goes again with it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    expect(el.classList).not.toContain('single');
    expect(shown('gr-facing-page gr-index-page')).toBe(true);
    expect(shown('gr-thumb-index')).toBe(false);
    const labels = [...el.querySelectorAll('gr-index-page .entry .label')].map((n) => n.textContent!.trim());
    expect(labels).toContain('Two pages');
    expect(labels).not.toContain('Single page');
    expect(el.querySelector('gr-index-page .gr-link')!.textContent).toContain('Back to the single page');
    expect(el.querySelector('gr-index-page .hint')!.textContent).not.toContain('thumb notch');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.classList).toContain('single');
    expect(shown('gr-facing-page')).toBe(false);

    [...el.querySelectorAll<HTMLButtonElement>('gr-running-head .gr-link')]
      .find((link) => link.textContent!.includes('Two pages'))!
      .click();
    await fixture.whenStable();
    expect(el.classList).not.toContain('focus');
    expect(shown('gr-title-strip')).toBe(true);
    expect(shown('gr-thumb-index')).toBe(true);
    expect(shown('gr-ribbons')).toBe(true);
    expect(shown('gr-facing-page')).toBe(true);
    expect(shown('.desk')).toBe(false);
    expect(calls).toContainEqual({ command: 'layout.set', request: { focus: false } });
  });

  it('opens at a single page when the book was left that way', async () => {
    const { bridge, answers } = fakeBridge();
    answers['layout.get'] = () => ({ current: null, lastUsed: null, focus: true });
    const { fixture, el } = await render(bridge);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(el.classList).toContain('focus');
    expect(el.querySelector('gr-title-strip')).toBeNull();
    expect(el.querySelector('gr-facing-page')).toBeNull();
  });

  it('notes in the running foot, in focus, the other chapters waiting for you', async () => {
    const { bridge, answers, emit } = fakeBridge();
    const chat = (id: string, title: string, approvals: OpenChat['approvals']): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/work/grimoire' },
      status: approvals.length ? 'waiting' : 'idle',
      entries: [],
      approvals,
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
    });
    const question = {
      question: 'Where should the meter appear?',
      options: [{ label: 'In the composer' }, { label: 'In the running head' }],
      multiSelect: false,
    };
    answers['agents.openChats'] = () => [
      chat('c1', 'Fix flaky login test', [
        { id: 's1', chatId: 'c1', tool: 'Bash', input: { command: 'npm test' }, at: 1 },
        { id: 's2', chatId: 'c1', tool: 'Bash', input: { command: 'git push' }, at: 2 },
      ]),
      chat('c2', 'Context meter', [
        { id: 'q1', chatId: 'c2', tool: 'AskUserQuestion', input: {}, questions: [question], at: 3 },
      ]),
      chat('c3', 'New onboarding flow', [
        { id: 's3', chatId: 'c3', tool: 'Bash', input: { command: 'npm run build' }, at: 4 },
      ]),
    ];
    answers['layout.get'] = () => ({ current: 'c3', lastUsed: null, focus: true });
    const { fixture, el, texts } = await render(bridge);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    const notes = () => texts('gr-status-indicators .alert');
    const note = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-status-indicators .alert')].find((b) =>
        b.textContent!.includes(text),
      )!;

    // The chapter on the desk shows its own slip on its page.
    expect(notes()).toEqual(['2 approvals awaiting your seal', 'Questions from Context meter']);
    expect(note('awaiting your seal').getAttribute('title')).toBe('From Fix flaky login test');

    note('awaiting your seal').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-facing-page')).not.toBeNull();
    expect(el.classList).toContain('focus');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();

    note('Questions from').click();
    await fixture.whenStable();
    expect(texts('gr-running-head h1')).toEqual(['Context meter']);
    expect(el.classList).toContain('focus');
    expect(notes()).toEqual(['3 approvals awaiting your seal']);
    expect(note('awaiting').getAttribute('title')).toBe(
      'From Fix flaky login test and New onboarding flow',
    );

    // Answered elsewhere, the note goes.
    emit('agents.approvalSettled', { chatId: 'c1', approvalId: 's1' });
    emit('agents.approvalSettled', { chatId: 'c1', approvalId: 's2' });
    emit('agents.approvalSettled', { chatId: 'c3', approvalId: 's3' });
    await fixture.whenStable();
    expect(notes()).toEqual([]);
  });

  it("shows on the Front matter what Claude Code loads in the chapter's folder, and where each piece comes from", async () => {
    const { bridge, answers, calls } = fakeBridge();
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    answers['agents.setup'] = (request: CommandRequest<'agents.setup'>): AgentSetup => ({
      cwd: request.cwd ?? 'C:/Users/me',
      sections: {
        ...empty,
        memory: [
          { name: '~/.claude/CLAUDE.md', detail: 'Your instructions, in every folder', source: 'user', path: 'C:/Users/me/.claude/CLAUDE.md', tokens: 310 },
        ],
        skills: [
          { name: 'deploy', source: 'plugin', plugin: 'ship', tokens: 60 },
          { name: 'notes', source: 'user' },
          { name: 'wrangler', detail: 'Cloudflare Workers CLI', source: 'user', tokens: 2148 },
        ],
        mcpServers: [{ name: 'github', detail: 'Failed to connect', source: 'project', problem: 'spawn gh-mcp ENOENT' }],
      },
      settingsFiles: [
        { source: 'user', path: 'C:/Users/me/.claude/settings.json', exists: true },
        { source: 'project', path: 'C:/Users/me/git/new/.claude/settings.json', exists: false },
      ],
      at: Date.now(),
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Front matter')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-thumb-page .title')).toEqual(['Front matter']);
    expect(texts('gr-front-matter-page .sub')[0]).toMatch(/^In ~\s*·\s*Another folder\s*·\s*read at .+\s*·\s*Read again$/);
    expect(texts('gr-front-matter-page h2')).toEqual(['Claude Code']);
    expect(texts('gr-front-matter-page summary .part')).toEqual([
      'Memory',
      'Skills',
      'Subagents',
      'Commands',
      'Hooks',
      'MCP servers',
      'Plugins',
      'Permissions',
      'Settings files',
    ]);
    expect(texts('gr-front-matter-page summary .n')).toEqual([
      '1 · 310 tokens',
      '3 · 2,208 tokens',
      '0',
      '0',
      '0',
      '1',
      '0',
      '0',
      '2',
    ]);
    const section = (name: string) => `gr-front-matter-page [data-section="${name}"]`;
    // Each row's cells: its name, whose it is, what it does, and its cost.
    const rows = (name: string) =>
      [...el.querySelectorAll(`${section(name)} li`)].map((row) =>
        [...row.children].map((cell) => cell.textContent!.trim()).join(' | '),
      );
    // The costliest first, those without a cost last; the heavy ones flagged.
    expect(rows('skills')).toEqual([
      'wrangler | Yours | Cloudflare Workers CLI | 2,148 tokens',
      'deploy | ship |  | 60 tokens',
      'notes | Yours |  | ',
    ]);
    expect(texts(`${section('skills')} li.heavy .name`)).toEqual(['wrangler']);
    expect(el.querySelector(`${section('skills')} li.heavy .n`)!.getAttribute('title')).toBe(
      'Heavy: 2,000 tokens or more in every chat',
    );
    expect(el.querySelector(`${section('memory')} .name`)!.getAttribute('title')).toBe('C:/Users/me/.claude/CLAUDE.md');
    expect(texts(`${section('mcpServers')} .problem`)).toEqual(['spawn gh-mcp ENOENT']);
    expect(texts(`${section('hooks')} .none`)).toEqual(['None.']);
    expect(rows('settings')).toEqual([
      '~/.claude/settings.json | Yours |  | ',
      '~/git/new/.claude/settings.json | Project | None yet | ',
    ]);
    expect(calls.filter((c) => c.command === 'agents.setup').map((c) => c.request)).toEqual([
      { agent: 'claude-code' },
    ]);

    // Another folder reads it again there.
    [...el.querySelectorAll<HTMLButtonElement>('gr-front-matter-page .sub .gr-link')]
      .find((link) => link.textContent!.includes('Another folder'))!
      .click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.setup').at(-1)!.request).toEqual({
      agent: 'claude-code',
      cwd: 'C:/Users/me/git/new',
    });
    expect(texts('gr-front-matter-page .sub')[0]).toMatch(/^In ~\/git\/new\s*·/);
  });

  it('opens a file of the setup on the Front matter, to change and save in place', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    const memory = 'C:/Users/me/.claude/CLAUDE.md';
    const managed = 'C:/Program Files/ClaudeCode/managed-settings.json';
    answers['agents.setup'] = (): AgentSetup => ({
      cwd: 'C:/Users/me',
      sections: { ...empty, memory: [{ name: '~/.claude/CLAUDE.md', source: 'user', path: memory, tokens: 310 }] },
      settingsFiles: [{ source: 'managed', path: managed, exists: true }],
      at: Date.now(),
    });
    let kept = '# Mine';
    answers['agents.openSetupFile'] = (request: CommandRequest<'agents.openSetupFile'>): SetupFile => ({
      path: request.path,
      text: request.path === memory ? kept : '{ "permissions": {} }',
      exists: true,
      changedAt: 100,
      editable: request.path === memory,
    });
    answers['agents.saveSetupFile'] = (request: CommandRequest<'agents.saveSetupFile'>): SetupFile => {
      if (request.text.includes('oops')) throw new Error('It changed on disk since you opened it.');
      kept = request.text;
      return { path: request.path, text: kept, exists: true, changedAt: 200, editable: true };
    };
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Front matter')!
      .click();
    await fixture.whenStable();
    const link = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-front-matter-page .gr-link')].find((b) =>
        b.textContent!.includes(text),
      )!;
    const editor = () => el.querySelector<HTMLTextAreaElement>('gr-front-matter-page textarea');
    const type = async (text: string) => {
      editor()!.value = text;
      editor()!.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const press = async (init: KeyboardEventInit) => {
      editor()!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      await fixture.whenStable();
    };

    el.querySelector<HTMLButtonElement>('gr-front-matter-page [data-section="memory"] button.name')!.click();
    await fixture.whenStable();
    expect(calls).toContainEqual({ command: 'agents.openSetupFile', request: { agent: 'claude-code', path: memory } });
    expect(editor()!.value).toBe('# Mine');
    expect(editor()!.readOnly).toBe(false);
    expect(texts('gr-front-matter-page gr-file-editor .sub')[0]).toMatch(/^~\/.claude\/CLAUDE.md\s*·\s*Yours\s*·\s*Back to the list$/);
    expect(link('Save').getAttribute('aria-disabled')).toBe('true');

    // Changes can't be left behind unsaved: Esc stays, and so does the Front matter.
    await type('# Mine\nUse tabs.');
    await press({ key: 'Escape' });
    expect(editor()).not.toBeNull();
    expect(el.querySelector('gr-thumb-page')).not.toBeNull();
    expect(texts('gr-front-matter-page .note.alert')).toEqual(['Save your changes, or discard them, first.']);
    // Nor by the link back, another thumb tab, or the Index.
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-page .row .gr-link')]
      .find((b) => b.textContent!.includes('Back to the'))!
      .click();
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    expect(editor()!.value).toBe('# Mine\nUse tabs.');
    expect(texts('gr-thumb-page .title')).toEqual(['Front matter']);
    expect(el.querySelector('gr-index-page')).toBeNull();
    expect(texts('gr-front-matter-page .note.alert')).toEqual(['Save your changes, or discard them, first.']);

    await press({ key: 's', ctrlKey: true });
    expect(calls).toContainEqual({
      command: 'agents.saveSetupFile',
      request: { agent: 'claude-code', path: memory, text: '# Mine\nUse tabs.', changedAt: 100 },
    });
    expect(texts('gr-front-matter-page .note')).toEqual(['Saved. Chats begun from now on load it.']);
    expect(link('Save').getAttribute('aria-disabled')).toBe('true');

    await type('# Mine\noops');
    link('Save').click();
    await fixture.whenStable();
    expect(texts('gr-front-matter-page .note.alert')).toEqual(['It changed on disk since you opened it.']);
    link('Discard changes').click();
    await fixture.whenStable();
    expect(editor()!.value).toBe('# Mine\nUse tabs.');

    // Back to the list, read again after the save.
    const reads = () => calls.filter((c) => c.command === 'agents.setup').length;
    const before = reads();
    await press({ key: 'Escape' });
    expect(editor()).toBeNull();
    expect(el.querySelector('gr-thumb-page')).not.toBeNull();
    expect(reads()).toBe(before + 1);

    // The managed settings open only to read.
    el.querySelector<HTMLButtonElement>('gr-front-matter-page [data-section="settings"] button.name')!.click();
    await fixture.whenStable();
    expect(editor()!.readOnly).toBe(true);
    expect(texts('gr-front-matter-page .why')).toEqual(['Your organization’s settings, only to read here.']);
    expect(el.querySelector('gr-front-matter-page .actions .gr-link')).toBeNull();
  });

  it('reads the Front matter again when a file of its setup changes, and the open file too', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    const memory = 'C:/Users/me/.claude/CLAUDE.md';
    let skills = 1;
    answers['agents.setup'] = (): AgentSetup => ({
      cwd: 'C:/Users/me',
      sections: {
        ...empty,
        memory: [{ name: '~/.claude/CLAUDE.md', source: 'user', path: memory }],
        skills: Array.from({ length: skills }, (_, i) => ({ name: `skill-${i}`, source: 'user' as const })),
      },
      settingsFiles: [],
      at: Date.now(),
    });
    let onDisk = '# Mine';
    answers['agents.openSetupFile'] = (request: CommandRequest<'agents.openSetupFile'>): SetupFile => ({
      path: request.path,
      text: onDisk,
      exists: true,
      changedAt: onDisk.length,
      editable: true,
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Front matter')!
      .click();
    await fixture.whenStable();
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    const skillCount = () => texts('gr-front-matter-page [data-section="skills"] summary .n')[0];
    expect(skillCount()).toBe('1');

    // A change in another folder isn't this page's.
    skills = 2;
    emit('agents.setupChanged', { agent: 'claude-code', cwd: 'D:/elsewhere' });
    await settle();
    expect(skillCount()).toBe('1');
    emit('agents.setupChanged', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(skillCount()).toBe('2');

    // The open file is opened again as it is now, while you haven't changed it.
    el.querySelector<HTMLButtonElement>('gr-front-matter-page [data-section="memory"] button.name')!.click();
    await fixture.whenStable();
    const editor = () => el.querySelector<HTMLTextAreaElement>('gr-front-matter-page textarea')!;
    onDisk = '# Changed elsewhere';
    skills = 3;
    emit('agents.setupChanged', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(editor().value).toBe('# Changed elsewhere');

    editor().value = '# Mine again';
    editor().dispatchEvent(new Event('input'));
    onDisk = '# Changed once more';
    emit('agents.setupChanged', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(editor().value).toBe('# Mine again');

    // Back at the list, it's read again.
    [...el.querySelectorAll<HTMLButtonElement>('gr-front-matter-page .gr-link')]
      .find((b) => b.textContent!.includes('Discard changes'))!
      .click();
    await fixture.whenStable();
    editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(skillCount()).toBe('3');
    expect(calls.filter((c) => c.command === 'agents.setup')).toHaveLength(3);
  });

  it('draws the memories on the Memory map in columns by kind, with their links and errata', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const folder = 'C:/Users/me/.claude/projects/C--Users-me/memory';
    const memory = (name: string, type: string, links: string[], indexed = true): Memory => ({
      name,
      path: `${folder}/${name}.md`,
      description: `About ${name}`,
      type,
      changedAt: new Date(2026, 9, 31).getTime(),
      links,
      indexed,
    });
    answers['agents.memories'] = (request: CommandRequest<'agents.memories'>): AgentMemories => ({
      cwd: request.cwd ?? 'C:/Users/me',
      folder,
      index: { path: `${folder}/MEMORY.md`, exists: true },
      enabled: true,
      memories: [
        memory('scope-discipline', 'feedback', ['concise-answers']),
        memory('angular-conventions', 'project', []),
        memory('design-tokens', 'project', ['angular-conventions']),
        memory('commit-style', 'feedback', [], false),
        memory('testing-strategy', 'reference', ['commit-style']),
      ],
      problems: [
        'scope-discipline links to [[concise-answers]], which doesn’t exist.',
        'The index leaves out commit-style.',
      ],
      elsewhere: [{ cwd: 'C:/Users/me/git/breeder', count: 3 }, { cwd: null, count: 1 }],
      at: Date.now(),
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-thumb-page .title')).toEqual(['Memory map']);
    expect(texts('gr-memory-map-page .none')[0]).toBe(
      'Claude Code keeps them in ~/.claude/projects/C--Users-me/memory and reads its index in every chat.',
    );
    expect(texts('gr-memory-map-page h2')).toEqual(['Errata']);
    expect(texts('gr-memory-map-page .errata li')).toEqual([
      'scope-discipline links to [[concise-answers]], which doesn’t exist.',
      'The index leaves out commit-style.',
    ]);
    expect(texts('gr-memory-map-page .column h3')).toEqual(['Feedback', 'Projects', 'References']);
    const column = (title: string) =>
      [...el.querySelectorAll('gr-memory-map-page .column')]
        .find((c) => c.querySelector('h3')!.textContent!.trim() === title)!;
    expect([...column('Projects').querySelectorAll('.name')].map((n) => n.textContent!.trim())).toEqual([
      'angular-conventions',
      'design-tokens',
    ]);
    const card = (name: string) => el.querySelector<HTMLElement>(`gr-memory-map-page [data-memory="${name}"]`)!;
    expect([...card('scope-discipline').querySelectorAll('.flag')].map((f) => f.textContent!.trim())).toEqual([
      '[[concise-answers]] missing',
    ]);
    expect(card('commit-style').querySelector('.flag')!.textContent!.trim()).toBe('not in the index');
    // A thread for each link that names a memory.
    expect(el.querySelectorAll('gr-memory-map-page path.thread')).toHaveLength(2);

    // Pointing at a memory brings its links forward, and sets the rest back.
    card('design-tokens').dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(card('angular-conventions').classList).not.toContain('faded');
    expect(card('commit-style').classList).toContain('faded');
    expect(el.querySelectorAll('gr-memory-map-page path.thread.lit')).toHaveLength(1);
    card('design-tokens').dispatchEvent(new MouseEvent('mouseleave'));
    await fixture.whenStable();
    expect(el.querySelectorAll('gr-memory-map-page .card.faded')).toHaveLength(0);

    // Another folder with memories is one click away.
    expect(texts('gr-memory-map-page .elsewhere .gr-link')).toEqual(['~/git/breeder 3']);
    el.querySelector<HTMLButtonElement>('gr-memory-map-page .elsewhere .gr-link')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.memories').map((c) => c.request)).toEqual([
      { agent: 'claude-code' },
      { agent: 'claude-code', cwd: 'C:/Users/me/git/breeder' },
    ]);
    expect(texts('gr-memory-map-page .sub')[0]).toMatch(/^In ~\/git\/breeder\s*·/);
  });

  it('says on the Memory map when there are no memories, or memory is off', async () => {
    const { bridge, answers } = fakeBridge();
    let enabled = true;
    answers['agents.memories'] = (): AgentMemories => ({
      cwd: 'C:/Users/me',
      folder: 'C:/Users/me/.claude/projects/C--Users-me/memory',
      index: { path: 'C:/Users/me/.claude/projects/C--Users-me/memory/MEMORY.md', exists: false },
      enabled,
      memories: [],
      problems: [],
      elsewhere: [],
      at: Date.now(),
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-memory-map-page .none')).toEqual([
      'Claude Code keeps them in ~/.claude/projects/C--Users-me/memory with no index yet.',
      'No memories kept for this folder yet.',
    ]);

    enabled = false;
    [...el.querySelectorAll<HTMLButtonElement>('gr-memory-map-page .gr-link')]
      .find((b) => b.textContent!.includes('Read again'))!
      .click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(texts('gr-memory-map-page .none.alert')).toEqual([
      'Claude Code keeps no memories here: memory is turned off in its settings.',
    ]);
    expect(el.querySelector('gr-memory-map-page .map')).toBeNull();
  });

  it('opens a memory from the Memory map to change, turn to its links, or delete', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const folder = 'C:/Users/me/.claude/projects/C--Users-me/memory';
    const memory = (name: string, type: string, links: string[]): Memory => ({
      name,
      path: `${folder}/${name}.md`,
      description: `About ${name}`,
      type,
      changedAt: 100,
      links,
      indexed: true,
    });
    let memories = [
      memory('angular-conventions', 'project', []),
      memory('design-tokens', 'project', ['angular-conventions', 'gone']),
      memory('testing-strategy', 'reference', ['design-tokens']),
    ];
    const texts_: Record<string, string> = {};
    answers['agents.memories'] = (): AgentMemories => ({
      cwd: 'C:/Users/me',
      folder,
      index: { path: `${folder}/MEMORY.md`, exists: true },
      enabled: true,
      memories,
      problems: [],
      elsewhere: [],
      at: Date.now(),
    });
    answers['agents.openMemory'] = (request: CommandRequest<'agents.openMemory'>): SetupFile => ({
      path: request.path,
      text: texts_[request.path] ?? `Text of ${request.path.split('/').at(-1)}`,
      exists: true,
      changedAt: 100,
      editable: true,
    });
    answers['agents.saveMemory'] = (request: CommandRequest<'agents.saveMemory'>): SetupFile => {
      texts_[request.path] = request.text;
      return { path: request.path, text: request.text, exists: true, changedAt: 200, editable: true };
    };
    answers['agents.deleteMemory'] = (request: CommandRequest<'agents.deleteMemory'>) => {
      memories = memories.filter((one) => one.path !== request.path);
    };
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();
    const link = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-memory-map-page .gr-link')].find(
        (b) => b.textContent!.trim().startsWith(text),
      )!;
    const editor = () => el.querySelector<HTMLTextAreaElement>('gr-memory-map-page textarea');
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    const type = async (text: string) => {
      editor()!.value = text;
      editor()!.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const path = (name: string) => `${folder}/${name}.md`;

    el.querySelector<HTMLButtonElement>('gr-memory-map-page [data-memory="design-tokens"] .name button')!.click();
    await settle();
    expect(calls).toContainEqual({
      command: 'agents.openMemory',
      request: { agent: 'claude-code', cwd: 'C:/Users/me', path: path('design-tokens') },
    });
    expect(editor()!.value).toBe('Text of design-tokens.md');
    expect(el.querySelector('gr-memory-map-page .map')).toBeNull();
    expect(texts('gr-memory-map-page gr-file-editor .sub')[0]).toMatch(
      /^~\/.claude\/projects\/C--Users-me\/memory\/design-tokens.md\s*·\s*Projects\s*·\s*Back to the map$/,
    );
    expect(texts('gr-memory-map-page .links')[0]).toMatch(
      /^Links to\s*angular-conventions\s*\[\[gone\]\] missing\s*·\s*Linked from\s*testing-strategy$/,
    );

    // Saved, it's kept as saved.
    await type('Tokens only.');
    link('Save').click();
    await settle();
    expect(calls).toContainEqual({
      command: 'agents.saveMemory',
      request: {
        agent: 'claude-code',
        cwd: 'C:/Users/me',
        path: path('design-tokens'),
        text: 'Tokens only.',
        changedAt: 100,
      },
    });
    expect(texts('gr-memory-map-page .note')).toEqual(['Saved.']);

    // A link turns to that memory; not while there are changes to save.
    [...el.querySelectorAll<HTMLButtonElement>('gr-memory-map-page .links .to')].find((b) => b.textContent!.trim() === 'angular-conventions')!.click();
    await settle();
    expect(editor()!.value).toBe('Text of angular-conventions.md');
    expect(texts('gr-memory-map-page .links')[0]).toMatch(/Links to\s*none\s*·\s*Linked from\s*design-tokens$/);
    await type('Changed.');
    [...el.querySelectorAll<HTMLButtonElement>('gr-memory-map-page .links .to')].find((b) => b.textContent!.trim() === 'design-tokens')!.click();
    await settle();
    expect(editor()!.value).toBe('Changed.');
    expect(texts('gr-memory-map-page .note.alert')).toEqual(['Save your changes, or discard them, first.']);
    link('Discard changes').click();
    await fixture.whenStable();

    // Deleting asks first, and can be kept.
    link('Delete').click();
    await fixture.whenStable();
    expect(texts('gr-memory-map-page .ask')).toEqual(['Delete it? Its file goes, and its line in the index.']);
    link('Keep it').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-memory-map-page .ask')).toBeNull();
    expect(calls.some((c) => c.command === 'agents.deleteMemory')).toBe(false);

    link('Delete').click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-memory-map-page .gr-link.danger')!.click();
    await settle();
    expect(calls).toContainEqual({
      command: 'agents.deleteMemory',
      request: { agent: 'claude-code', cwd: 'C:/Users/me', path: path('angular-conventions'), changedAt: 100 },
    });
    expect(editor()).toBeNull();
    expect([...el.querySelectorAll('gr-memory-map-page .card .name')].map((n) => n.textContent!.trim())).toEqual([
      'design-tokens',
      'testing-strategy',
    ]);
  });

  it('keeps an open memory with changes from being left by turning the facing page away', async () => {
    const { bridge, answers } = fakeBridge();
    const folder = 'C:/Users/me/.claude/projects/C--Users-me/memory';
    answers['agents.memories'] = (): AgentMemories => ({
      cwd: 'C:/Users/me',
      folder,
      index: { path: `${folder}/MEMORY.md`, exists: false },
      enabled: true,
      memories: [
        {
          name: 'tone',
          path: `${folder}/tone.md`,
          type: 'feedback',
          changedAt: 100,
          links: [],
          indexed: false,
        },
      ],
      problems: [],
      elsewhere: [],
      at: Date.now(),
    });
    answers['agents.openMemory'] = (request: CommandRequest<'agents.openMemory'>): SetupFile => ({
      path: request.path,
      text: 'Short answers.',
      exists: true,
      changedAt: 100,
      editable: true,
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-memory-map-page .name button')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    const editor = el.querySelector<HTMLTextAreaElement>('gr-memory-map-page textarea')!;
    editor.value = 'Shorter answers.';
    editor.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('gr-thumb-page .row .gr-link')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-memory-map-page textarea')).not.toBeNull();
    expect(texts('gr-memory-map-page .note.alert')).toEqual(['Save your changes, or discard them, first.']);

    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-memory-map-page textarea')).not.toBeNull();
  });

  it('reads the Memory map again when the memories of its folder change, and the open one unless changed', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    const folder = 'C:/Users/me/.claude/projects/C--Users-me/memory';
    const memory = (name: string): Memory => ({
      name,
      path: `${folder}/${name}.md`,
      type: 'feedback',
      changedAt: 100,
      links: [],
      indexed: true,
    });
    let memories = [memory('tone')];
    let text = 'Short answers.';
    answers['agents.memories'] = (): AgentMemories => ({
      cwd: 'C:/Users/me',
      folder,
      index: { path: `${folder}/MEMORY.md`, exists: true },
      enabled: true,
      memories,
      problems: [],
      elsewhere: [],
      at: Date.now(),
    });
    answers['agents.openMemory'] = (request: CommandRequest<'agents.openMemory'>): SetupFile => ({
      path: request.path,
      text,
      exists: true,
      changedAt: 100,
      editable: true,
    });
    const { fixture, el } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    const names = () => [...el.querySelectorAll('gr-memory-map-page .card .name')].map((n) => n.textContent!.trim());
    const reads = () => calls.filter((c) => c.command === 'agents.memories').length;
    expect(names()).toEqual(['tone']);

    // Another folder's memories changing reads nothing.
    emit('agents.memoriesChanged', { agent: 'claude-code', cwd: 'D:/elsewhere' });
    await settle();
    expect(reads()).toBe(1);

    memories = [memory('tone'), memory('commits')];
    emit('agents.memoriesChanged', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(names()).toEqual(['tone', 'commits']);

    // The open memory is opened again as it is on disk, while you haven't changed it.
    el.querySelector<HTMLButtonElement>('gr-memory-map-page [data-memory="tone"] .name button')!.click();
    await settle();
    const editor = () => el.querySelector<HTMLTextAreaElement>('gr-memory-map-page textarea')!;
    text = 'Shorter answers.';
    emit('agents.memoriesChanged', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(editor().value).toBe('Shorter answers.');

    // Not once you have.
    editor().value = 'Mine.';
    editor().dispatchEvent(new Event('input'));
    await fixture.whenStable();
    text = 'Theirs.';
    emit('agents.memoriesChanged', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(editor().value).toBe('Mine.');
  });

  it('offers the Front matter of the other folders your chats ran in', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    answers['agents.setup'] = (request: CommandRequest<'agents.setup'>): AgentSetup => ({
      cwd: request.cwd ?? 'C:/Users/me',
      sections: empty,
      settingsFiles: [],
      at: Date.now(),
    });
    answers['agents.setupFolders'] = () => ['C:/Users/me/git/grimoire', 'C:/Users/me', 'C:/Users/me/git/breeder'];
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Front matter')!
      .click();
    await fixture.whenStable();

    // The folder shown isn't offered again.
    expect(texts('gr-front-matter-page .sub')[0]).toMatch(/^In ~\s*·/);
    expect(texts('gr-front-matter-page .elsewhere .gr-link')).toEqual(['~/git/grimoire', '~/git/breeder']);

    [...el.querySelectorAll<HTMLButtonElement>('gr-front-matter-page .elsewhere .gr-link')]
      .find((b) => b.textContent!.trim() === '~/git/breeder')!
      .click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.setup').at(-1)!.request).toEqual({
      agent: 'claude-code',
      cwd: 'C:/Users/me/git/breeder',
    });
    expect(texts('gr-front-matter-page .sub')[0]).toMatch(/^In ~\/git\/breeder\s*·/);
    // The open chapter's folder comes first, to turn back to.
    expect(texts('gr-front-matter-page .elsewhere .gr-link')).toEqual(['~', '~/git/grimoire']);
  });

  describe('a second chapter on the facing page', () => {
    const chat = (id: string, title: string): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: `C:/work/${id}` },
      status: 'idle',
      entries: [{ kind: 'user', id: `u-${id}`, text: `Hello ${title}` }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
    });
    const tab = (el: HTMLElement, label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-facing-tabs .tabs button')].find(
        (b) => b.textContent!.trim() === label,
      )!;
    const beside = (el: HTMLElement) => el.querySelector<HTMLElement>('gr-chapter-page[beside]');
    const layouts = (calls: { command: string; request: unknown }[]) =>
      calls.filter((c) => c.command === 'layout.set').map((c) => c.request as Record<string, unknown>);

    it('puts another open chapter there, to work in as on the left page', async () => {
      const { bridge, answers, calls } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1' });
      const { fixture, el, texts } = await render(bridge);

      tab(el, 'Second chapter').click();
      await fixture.whenStable();
      expect(texts('gr-second-chapter .ask')).toEqual([
        'Which chapter goes on this page, beside the one you’re on?',
      ]);
      expect(texts('gr-second-chapter .pick')).toEqual(['Fix flaky login test']);
      expect(texts('gr-second-chapter .meta')).toEqual(['Claude Code · C:/work/c2']);

      el.querySelector<HTMLButtonElement>('gr-second-chapter .pick')!.click();
      await fixture.whenStable();
      expect(layouts(calls)).toContainEqual({ beside: 'c2' });
      // Both pages are chapters: the left one stays, the other heads the facing page with its title.
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
      expect(texts('gr-facing-tabs .tabs [aria-pressed="true"]')).toEqual(['Fix flaky login test']);
      expect(beside(el)!.querySelector('.meta')!.textContent).toContain('C:/work/c2');
      expect(texts('gr-ribbon.beside b')).toEqual(['Fix flaky login test']);
      expect(texts('gr-ribbon.beside i')).toEqual(['Claude Code · idle · on the facing page']);

      // Its entry goes to its own chat.
      const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry-beside')!;
      entry.value = 'Run the tests again';
      entry.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      beside(el)!.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
      await fixture.whenStable();
      expect(calls).toContainEqual({ command: 'agents.send', request: { chatId: 'c2', text: 'Run the tests again' } });

      // Its settings open on it, without turning the left page.
      beside(el)!.querySelector<HTMLButtonElement>('.meta button')!.click();
      await fixture.whenStable();
      expect(beside(el)!.querySelector('gr-settings-card')).not.toBeNull();
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
      // Esc there closes them, and leaves the left page alone.
      beside(el)!
        .querySelector('.meta button')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await fixture.whenStable();
      expect(el.querySelector('gr-settings-card')).toBeNull();

      // Its ribbon swaps the two pages.
      el.querySelector<HTMLButtonElement>('gr-ribbon.beside .tail')!.click();
      await fixture.whenStable();
      expect(texts('gr-running-head h1')).toEqual(['Fix flaky login test']);
      expect(texts('gr-facing-tabs .tabs [aria-pressed="true"]')).toEqual(['Context meter']);
      expect(layouts(calls).slice(-2)).toEqual([{ beside: 'c1' }, { current: 'c2' }]);

      // Another chapter takes it off the page; it stays open.
      [...beside(el)!.querySelectorAll<HTMLButtonElement>('.gr-link')]
        .find((b) => b.textContent!.trim() === 'Another chapter')!
        .click();
      await fixture.whenStable();
      expect(beside(el)).toBeNull();
      expect(texts('gr-second-chapter .pick')).toEqual(['Context meter']);
      expect(layouts(calls).at(-1)).toEqual({ beside: null });
      expect(texts('gr-ribbon.chapter b')).toEqual(['Context meter', 'Fix flaky login test']);
    });

    it('opens a new chapter there, and keeps it there once it begins', async () => {
      const { bridge, answers, calls } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
      answers['layout.get'] = () => ({ current: 'c1' });
      answers['agents.start'] = () => chat('c9', '');
      const { fixture, el, texts } = await render(bridge);
      tab(el, 'Second chapter').click();
      await fixture.whenStable();
      expect(texts('gr-second-chapter .none')).toEqual(['No other chapter is open.']);

      [...el.querySelectorAll<HTMLButtonElement>('gr-second-chapter .gr-link')]
        .find((b) => b.textContent!.trim() === 'A new chapter')!
        .click();
      await fixture.whenStable();
      expect(beside(el)!.querySelector('gr-chapter-opening')).not.toBeNull();
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);

      const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry-beside')!;
      entry.value = 'Write the ribbon tests';
      entry.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      beside(el)!.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'agents.start')).toHaveLength(1);
      expect(layouts(calls)).toContainEqual({ beside: 'c9' });
      expect(beside(el)!.querySelector('gr-transcript')).not.toBeNull();
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
    });

    it('opens the book with the chapter that was beside the one you were on', async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
      const { el, texts } = await render(bridge);
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
      expect(texts('gr-facing-tabs .tabs [aria-pressed="true"]')).toEqual(['Fix flaky login test']);
      expect(beside(el)).not.toBeNull();
    });

    it('lists the agent\'s commands for its entry on the left page', async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
      answers['agents.commands'] = () => [{ name: 'compact', description: 'Free up context', kind: 'command' }];
      const { fixture, el, texts } = await render(bridge);
      const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry-beside')!;
      entry.value = '/';
      entry.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(el.querySelector('gr-page:not(.facing) gr-command-index')).not.toBeNull();
      expect(el.querySelector('gr-page.facing gr-command-index')).toBeNull();
      expect(el.querySelector('#gr-next-entry-beside')).toBe(entry);
      expect(texts('gr-command-index .entry .label')).toEqual(['/compact']);
      expect(texts('gr-composer .slash-hint')).toEqual([
        'Claude Code’s commands and skills are on the facing page ←',
      ]);
      expect(texts('gr-command-index .gr-link')[0]).toMatch(/^Back to the chapter/);

      entry.value = '';
      entry.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(el.querySelector('gr-command-index')).toBeNull();
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
    });

    it('forgets the chapter beside once it closes', async () => {
      const { bridge, answers, calls } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
      const { fixture, el, texts } = await render(bridge);
      [...beside(el)!.querySelectorAll<HTMLButtonElement>('.gr-link')]
        .find((b) => b.textContent!.trim() === 'Close')!
        .click();
      await fixture.whenStable();
      expect(beside(el)).toBeNull();
      expect(texts('gr-second-chapter .none')).toEqual(['No other chapter is open.']);
      expect(layouts(calls).at(-1)).toEqual({ beside: null });
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
    });

    describe('parallel texts', () => {
      const parallel = (el: HTMLElement) =>
        el.querySelector<HTMLButtonElement>('gr-composer button[aria-label^="Parallel texts"]');
      const write = async (el: HTMLElement, fixture: { whenStable(): Promise<unknown> }, text: string) => {
        const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
        entry.value = text;
        entry.dispatchEvent(new Event('input'));
        await fixture.whenStable();
      };
      const forking = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['fork'] }];

      it('sends the entry to a copy of the chapter on a second model, beside it', async () => {
        const { bridge, answers, calls } = fakeBridge();
        answers['agents.list'] = forking;
        answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
        answers['layout.get'] = () => ({ current: 'c1', focus: true });
        answers['agents.parallel'] = (request: CommandRequest<'agents.parallel'>): OpenChat => ({
          ...chat('c2', 'Context meter (a)'),
          settings: { cwd: 'C:/work/c1/.claude/worktrees/context-meter-a', model: request.model, worktree: true },
          status: 'thinking',
        });
        const { fixture, el, texts } = await render(bridge);
        expect(parallel(el)!.getAttribute('aria-pressed')).toBe('false');

        parallel(el)!.click();
        await fixture.whenStable();
        expect(parallel(el)!.getAttribute('aria-pressed')).toBe('true');
        // The chapter is on Opus, the default: the others are offered, the first picked.
        expect(texts('gr-composer .parallel-model')).toEqual(['Sonnet 5.5', 'Haiku 5.5']);
        expect(texts('gr-composer .parallel-model[aria-checked="true"]')).toEqual(['Sonnet 5.5']);
        expect(texts('gr-composer .parallel-where')).toEqual(['a copy of this chapter, on the facing page']);
        el.querySelectorAll<HTMLButtonElement>('gr-composer .parallel-model')[1]!.click();
        await fixture.whenStable();
        expect(texts('gr-composer .parallel-model[aria-checked="true"]')).toEqual(['Haiku 5.5']);

        await write(el, fixture, 'Colour it');
        el.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
        await fixture.whenStable();
        // The service sends it to both: the chapter, and its copy.
        expect(calls).toContainEqual({
          command: 'agents.parallel',
          request: { from: { chatId: 'c1' }, model: 'haiku', text: 'Colour it' },
        });
        expect(calls.some((c) => c.command === 'agents.send')).toBe(false);
        // Out of focus, so the copy shows on the facing page.
        expect(layouts(calls)).toContainEqual({ focus: false });
        expect(layouts(calls)).toContainEqual({ beside: 'c2' });
        expect(texts('gr-running-head h1')).toEqual(['Context meter']);
        expect(texts('gr-facing-tabs .tabs [aria-pressed="true"]')).toEqual(['Context meter (a)']);
        expect(beside(el)!.querySelector('gr-transcript')).not.toBeNull();
        // Parallel is off again, and not offered on the facing page.
        expect(el.querySelector('gr-composer .parallel')).toBeNull();
        expect(parallel(el)!.getAttribute('aria-pressed')).toBe('false');
        expect(beside(el)!.querySelector('button[aria-label^="Parallel texts"]')).toBeNull();
      });

      it('starts a blank chapter first, then the second afresh', async () => {
        const { bridge, answers, calls } = fakeBridge();
        answers['agents.parallel'] = (): OpenChat => ({ ...chat('c9', ''), status: 'thinking' });
        const { fixture, el, texts } = await render(bridge);
        parallel(el)!.click();
        await fixture.whenStable();
        expect(texts('gr-composer .parallel-where')).toEqual(['a chapter of its own, on the facing page']);

        await write(el, fixture, 'Fix the login test');
        el.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
        await fixture.whenStable();
        const started = calls.findIndex((c) => c.command === 'agents.start');
        const second = calls.findIndex((c) => c.command === 'agents.parallel');
        expect(started).toBeGreaterThan(-1);
        expect(second).toBeGreaterThan(started);
        expect(calls[second]!.request).toMatchObject({
          from: { agent: 'claude-code' },
          model: 'sonnet',
          text: 'Fix the login test',
        });
        expect(layouts(calls)).toContainEqual({ beside: 'c9' });
        expect(el.querySelectorAll('gr-ribbon.chapter')).toHaveLength(2);
        expect(el.querySelectorAll('gr-ribbon.beside')).toHaveLength(1);
        expect(beside(el)!.querySelector('gr-transcript')).not.toBeNull();
      });

      it('waits for the turn to end to copy a chapter', async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.list'] = forking;
        answers['agents.openChats'] = () => [{ ...chat('c1', 'Context meter'), status: 'thinking' }];
        answers['layout.get'] = () => ({ current: 'c1' });
        const { fixture, el } = await render(bridge);
        expect(parallel(el)!.getAttribute('aria-disabled')).toBe('true');
        parallel(el)!.click();
        await fixture.whenStable();
        expect(el.querySelector('gr-composer .parallel')).toBeNull();
      });

      it('shows on the chapter why the copy couldn\'t be made', async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.list'] = forking;
        answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
        answers['layout.get'] = () => ({ current: 'c1' });
        answers['agents.parallel'] = () =>
          Promise.reject(new Error('Claude Code can’t copy a chat to another model'));
        const { fixture, el, texts } = await render(bridge);
        parallel(el)!.click();
        await fixture.whenStable();
        await write(el, fixture, 'Colour it');
        el.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
        await fixture.whenStable();
        expect(texts('.error')).toEqual(['Claude Code can’t copy a chat to another model']);
        expect(beside(el)).toBeNull();
      });

      it('isn\'t offered when the agent can\'t copy a chapter that has begun', async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
        answers['layout.get'] = () => ({ current: 'c1' });
        const { el } = await render(bridge);
        expect(parallel(el)).toBeNull();
      });
    });
  });

  describe('loose leaves', () => {
    const chat = (id: string, title: string): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: `C:/work/${id}` },
      status: 'idle',
      entries: [{ kind: 'user', id: `u-${id}`, text: `Hello ${title}` }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
    });
    const link = (root: ParentNode, label: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('.gr-link')].find((b) => b.textContent!.trim() === label);
    const ribbons = (texts: (selector: string) => string[]) => texts('gr-ribbon.chapter b');
    /** Lets what the window's closing set off finish. */
    const settle = async (fixture: { whenStable(): Promise<unknown> }) => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };

    it('pops a chapter out into a window of its own, and takes it back when that window closes', async () => {
      const { bridge, answers, calls, closeLeaf } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1' });
      const { fixture, el, texts } = await render(bridge);

      link(el, 'Pop out')!.click();
      await fixture.whenStable();
      expect(bridge.popOut).toHaveBeenCalledWith('c1');
      // It's out of the book; the chat stays open with the agent.
      expect(ribbons(texts)).toEqual(['Fix flaky login test']);
      expect(texts('gr-running-head h1')).toEqual(['Fix flaky login test']);
      expect(calls.some((c) => c.command === 'agents.close')).toBe(false);

      closeLeaf('c1');
      await settle(fixture);
      expect(ribbons(texts)).toEqual(['Fix flaky login test', 'Context meter']);
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);

      // A leaf closed with its chapter doesn't bring it back.
      link(el, 'Pop out')!.click();
      await fixture.whenStable();
      answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
      closeLeaf('c1');
      await settle(fixture);
      expect(ribbons(texts)).toEqual(['Fix flaky login test']);
    });

    it('opens the book without the chapters popped out', async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c2', loose: [{ chatId: 'c1' }] });
      const { texts } = await render(bridge);
      expect(ribbons(texts)).toEqual(['Fix flaky login test']);
      expect(texts('gr-running-head h1')).toEqual(['Fix flaky login test']);
    });

    it('pops out the chapter on the facing page, but not a blank one', async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
      const { fixture, el, texts } = await render(bridge);
      link(el.querySelector('gr-chapter-page[beside]')!, 'Pop out')!.click();
      await fixture.whenStable();
      expect(bridge.popOut).toHaveBeenCalledWith('c2');
      expect(el.querySelector('gr-chapter-page[beside]')).toBeNull();
      expect(texts('gr-second-chapter .none')).toEqual(['No other chapter is open.']);

      [...el.querySelectorAll<HTMLButtonElement>('gr-second-chapter .gr-link')]
        .find((b) => b.textContent!.trim() === 'A new chapter')!
        .click();
      await fixture.whenStable();
      expect(link(el.querySelector('gr-chapter-page[beside]')!, 'Pop out')).toBeUndefined();
    });

    describe('in its own window', () => {
      const leaf = (id: string) => [{ provide: LEAF, useValue: id }];

      it('holds its one chapter alone on the desk, and goes back in the book', async () => {
        const { bridge, answers, calls } = fakeBridge();
        answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
        answers['layout.get'] = () => ({ current: 'c1', focus: true });
        const { fixture, el, texts } = await render(bridge, leaf('c2'));
        expect(texts('gr-running-head h1')).toEqual(['Fix flaky login test']);
        for (const part of ['gr-title-strip', 'gr-ribbons', 'gr-thumb-index', 'gr-facing-page'])
          expect(el.querySelector(part)).toBeNull();
        expect(el.querySelector('gr-window-controls')).not.toBeNull();
        expect(link(el, 'Pop out')).toBeUndefined();
        expect(link(el, 'Two pages')).toBeUndefined();
        expect(el.querySelector('gr-composer button[aria-label^="Parallel texts"]')).toBeNull();
        // It doesn't move the book's place, or listen for leaves.
        expect(calls.filter((c) => c.command === 'layout.set')).toEqual([]);
        expect(bridge.onLeafClosed).not.toHaveBeenCalled();

        link(el, 'Back in the book')!.click();
        await fixture.whenStable();
        expect(bridge.window.close).toHaveBeenCalled();
      });

      it('lists the agent\'s commands on its own page, above the entry', async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
        answers['agents.commands'] = () => [{ name: 'compact', description: 'Free up context', kind: 'command' }];
        const { fixture, el, texts } = await render(bridge, leaf('c2'));
        const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
        entry.value = '/';
        entry.dispatchEvent(new Event('input'));
        await fixture.whenStable();
        expect(texts('gr-chapter-page gr-command-index .entry .label')).toEqual(['/compact']);
        expect(el.querySelector('gr-command-index gr-running-foot')).toBeNull();
        expect(el.querySelector('gr-transcript')).toBeNull();
        expect(el.querySelector('#gr-next-entry')).toBe(entry);
        expect(texts('gr-composer .slash-hint')).toEqual(['Claude Code’s commands and skills are listed above ↑']);

        entry.value = '';
        entry.dispatchEvent(new Event('input'));
        await fixture.whenStable();
        expect(el.querySelector('gr-command-index')).toBeNull();
        expect(el.querySelector('gr-transcript')).not.toBeNull();
      });

      it('closes its window when its chapter closes, or isn\'t open', async () => {
        const { bridge, answers, calls } = fakeBridge();
        answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
        const { fixture, el } = await render(bridge, leaf('c2'));
        link(el, 'Close')!.click();
        await fixture.whenStable();
        expect(calls).toContainEqual({ command: 'agents.close', request: { chatId: 'c2' } });
        expect(bridge.window.close).toHaveBeenCalled();

        TestBed.resetTestingModule();
        const other = fakeBridge();
        other.answers['agents.openChats'] = () => [];
        await render(other.bridge, leaf('c2'));
        expect(other.bridge.window.close).toHaveBeenCalled();
      });

      it('pops a fork out as a leaf of its own', async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
        answers['agents.fork'] = () => chat('c3', 'Fix flaky login test (a)');
        const { fixture, el, texts } = await render(bridge, leaf('c2'));
        [...el.querySelectorAll<HTMLButtonElement>('.you .by button')]
          .find((b) => b.textContent!.trim() === 'Fork')!
          .click();
        await fixture.whenStable();
        expect(bridge.popOut).toHaveBeenCalledWith('c3');
        expect(texts('gr-running-head h1')).toEqual(['Fix flaky login test']);
      });
    });
  });
  describe('the Files page', () => {
    /** The VS Code editor, faked as a text box for each side it shows. */
    function fakeMonaco() {
      const made: { editors: number; diffs: number; themes: string[]; revealed: number } = {
        editors: 0,
        diffs: 0,
        themes: [],
        revealed: 0,
      };
      const modelOf = (text: string, language: string) => {
        const listeners = new Set<() => void>();
        let value = text;
        return {
          language,
          getValue: () => value,
          setValue: (next: string) => {
            value = next;
            listeners.forEach((listener) => listener());
          },
          onDidChangeContent: (listener: () => void) => {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
          },
          dispose: () => listeners.clear(),
        };
      };
      type Model = ReturnType<typeof modelOf>;
      const box = (host: HTMLElement, model: Model, side: string, commands: Map<number, () => void>) => {
        const area = document.createElement('textarea');
        area.className = `fake-editor ${side}`;
        area.dataset['language'] = model.language;
        area.value = model.getValue();
        area.addEventListener('input', () => model.setValue(area.value));
        area.addEventListener('keydown', (event) => {
          if (event.ctrlKey && event.key === 's') commands.get(2048 | 49)?.();
        });
        const shown = model.onDidChangeContent(() => (area.value = model.getValue()));
        host.append(area);
        return {
          saveViewState: () => ({}),
          restoreViewState: () => undefined,
          addCommand: (keys: number, run: () => void) => void commands.set(keys, run),
          dispose: () => {
            shown.dispose();
            area.remove();
          },
        };
      };
      const monaco = {
        Uri: { from: (parts: unknown) => parts },
        KeyMod: { CtrlCmd: 2048 },
        KeyCode: { KeyS: 49 },
        languages: {
          getLanguages: () => [
            { id: 'typescript', extensions: ['.ts'] },
            { id: 'markdown', extensions: ['.md'] },
          ],
        },
        editor: {
          defineTheme: (name: string) => void made.themes.push(name),
          createModel: (text: string, language: string) => modelOf(text, language),
          create: (host: HTMLElement, options: { model: Model }) => {
            made.editors++;
            return box(host, options.model, 'file', new Map());
          },
          createDiffEditor: (host: HTMLElement) => {
            made.diffs++;
            const commands = new Map<number, () => void>();
            let sides: ReturnType<typeof box>[] = [];
            let modified: ReturnType<typeof box> | undefined;
            return {
              setModel: (models: { original: Model; modified: Model }) => {
                const original = box(host, models.original, 'committed', new Map());
                modified = box(host, models.modified, 'file', commands);
                sides = [original, modified];
              },
              getModifiedEditor: () => modified!,
              revealFirstDiff: () => void made.revealed++,
              dispose: () => sides.forEach((side) => side.dispose()),
            };
          },
        },
      };
      return { load: async () => monaco as unknown as MonacoApi, made };
    }

    const entries = (folder: string, names: string[], ignored: string[] = []): FolderEntry[] =>
      names.map((name) => {
        const path = folder ? `${folder}/${name.replace(/\/$/, '')}` : name.replace(/\/$/, '');
        return {
          name: name.replace(/\/$/, ''),
          path,
          kind: name.endsWith('/') ? 'folder' : 'file',
          ...(ignored.includes(name) ? { ignored: true } : {}),
        };
      });

    /** A repository with a few files, one of them changed and one new. */
    function repository() {
      const fake = fakeBridge();
      const { answers } = fake;
      const disk: Record<string, OpenFile> = {
        'README.md': { path: 'README.md', text: '# Grimoire\n', changedAt: 1 },
        'ui/src/ribbon.ts': {
          path: 'ui/src/ribbon.ts',
          text: 'export const ribbon = 2;\n',
          changedAt: 1,
          committed: 'export const ribbon = 1;\n',
        },
        'ui/src/seal.ts': { path: 'ui/src/seal.ts', text: 'export const seal = 1;\n', changedAt: 1, committed: null },
        'logo.png': { path: 'logo.png', text: '', changedAt: 1, unshown: 'binary' },
      };
      answers['files.list'] = (request: CommandRequest<'files.list'>) => ({
        root: 'C:/Users/me/git/grimoire',
        entries:
          request.path === ''
            ? entries('', ['dist/', 'ui/', 'logo.png', 'README.md'], ['dist/'])
            : request.path === 'ui'
              ? entries('ui', ['src/'])
              : request.path === 'ui/src'
                ? entries('ui/src', ['ribbon.ts', 'seal.ts'])
                : [],
      });
      disk['C:/Users/me/.claude/CLAUDE.md'] = {
        path: 'C:/Users/me/.claude/CLAUDE.md',
        text: '# Mine\n',
        changedAt: 1,
      };
      // Written in full inside the folder, a file is named from it, as the service does.
      answers['files.open'] = (request: CommandRequest<'files.open'>) =>
        disk[request.path.replace(/^C:\/(Users\/me\/git|work)\/grimoire\//, '')];
      answers['git.diff'] = () => [
        { kind: 'removed', text: 'export const ribbon = 1;' },
        { kind: 'inserted', text: 'export const ribbon = 2;' },
      ];
      answers['files.save'] = (request: CommandRequest<'files.save'>) =>
        (disk[request.path] = { ...disk[request.path]!, text: request.text, changedAt: 2 });
      answers['files.find'] = (request: CommandRequest<'files.find'>) =>
        Object.keys(disk).filter((path) => path.includes(request.query));
      answers['git.status'] = (): GitStatus => ({
        root: 'C:/Users/me/git/grimoire',
        branch: 'master',
        head: 'abc1234',
        changes: [
          { path: 'ui/src/ribbon.ts', kind: 'modified', staged: false },
          { path: 'ui/src/seal.ts', kind: 'new', staged: false },
          { path: 'old.txt', kind: 'deleted', staged: false },
        ],
      });
      return { ...fake, disk };
    }

    async function openFiles(bridge: GrimoireBridge) {
      const monaco = fakeMonaco();
      const rendered = await render(bridge, [{ provide: MONACO, useValue: monaco.load }]);
      [...rendered.el.querySelectorAll<HTMLButtonElement>('.tabs button')]
        .find((tab) => tab.textContent!.trim() === 'Files')!
        .click();
      await rendered.fixture.whenStable();
      const page = () => rendered.el.querySelector('gr-files-page')!;
      const button = (selector: string, text: string) =>
        [...page().querySelectorAll<HTMLButtonElement>(selector)].find(
          (b) => b.textContent!.replace(/\s+/g, ' ').trim() === text,
        )!;
      const editor = (side = 'file') => page().querySelector<HTMLTextAreaElement>(`.fake-editor.${side}`);
      const type = async (text: string) => {
        const area = editor()!;
        area.value = text;
        area.dispatchEvent(new Event('input'));
        await rendered.fixture.whenStable();
      };
      return { ...rendered, made: monaco.made, page, button, editor, type };
    }

    it('lists what is not committed first, then the folder as a tree it reads as you unfold it', async () => {
      const { bridge, calls } = repository();
      const { fixture, texts, button } = await openFiles(bridge);
      expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
      expect(texts('gr-files-page h2')).toEqual(['~/git/grimoire']);
      expect(texts('gr-files-page h3')).toEqual(['Not committed yet', 'All its files']);
      expect(texts('gr-files-page .list .file')).toEqual([
        'ui/src/ribbon.ts modified',
        'ui/src/seal.ts new',
        'old.txt deleted',
      ]);
      expect(texts('gr-files-page .list button.file')).toHaveLength(2);
      expect(texts('gr-files-page .tree .entry')).toEqual(['dist/', 'ui/', 'logo.png', 'README.md']);
      expect(texts('gr-files-page .entry.ignored')).toEqual(['dist/']);

      button('.entry', 'ui/').click();
      await fixture.whenStable();
      button('.entry', 'src/').click();
      await fixture.whenStable();
      expect(texts('gr-files-page .tree .entry')).toEqual([
        'dist/', 'ui/', 'src/', 'ribbon.ts', 'seal.ts', 'logo.png', 'README.md',
      ]);
      expect(calls.filter((c) => c.command === 'files.list').map((c) => c.request)).toEqual([
        { cwd: 'C:/Users/me', path: '' },
        { cwd: 'C:/Users/me', path: 'ui' },
        { cwd: 'C:/Users/me', path: 'ui/src' },
      ]);

      // Folded back in, and out again without reading it twice.
      button('.entry', 'ui/').click();
      await fixture.whenStable();
      expect(texts('gr-files-page .tree .entry')).toEqual(['dist/', 'ui/', 'logo.png', 'README.md']);
      button('.entry', 'ui/').click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'files.list')).toHaveLength(3);
    });

    it('opens a file in the VS Code editor, and saves what you change with Save or Ctrl+S', async () => {
      const { bridge, calls } = repository();
      const { fixture, el, texts, made, button, editor, type } = await openFiles(bridge);
      button('.entry', 'README.md').click();
      await fixture.whenStable();
      expect(texts('gr-files-page .sub .path')).toEqual(['README.md']);
      expect(editor()!.value).toBe('# Grimoire\n');
      expect(editor()!.dataset['language']).toBe('markdown');
      expect(made).toEqual({ editors: 1, diffs: 0, themes: ['grimoire'], revealed: 0 });
      // Not changed since the last commit: nothing to show beside it.
      expect(el.querySelector('gr-files-page .show')).toBeNull();
      expect(button('.gr-link', 'Save Ctrl+S').getAttribute('aria-disabled')).toBe('true');

      await type('# Grimoire\n\nA book.\n');
      expect(button('.gr-link', 'Save Ctrl+S').getAttribute('aria-disabled')).toBeNull();
      button('.gr-link', 'Save Ctrl+S').click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'files.save').map((c) => c.request)).toEqual([
        { cwd: 'C:/Users/me', path: 'README.md', text: '# Grimoire\n\nA book.\n', changedAt: 1 },
      ]);
      expect(texts('gr-files-page .note')).toEqual(['Saved.']);
      expect(button('.gr-link', 'Save Ctrl+S').getAttribute('aria-disabled')).toBe('true');

      await type('# Grimoire\n');
      editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'files.save').map((c) => c.request)).toContainEqual({
        cwd: 'C:/Users/me',
        path: 'README.md',
        text: '# Grimoire\n',
        changedAt: 2,
      });
    });

    it('opens a changed file beside the file as last committed, and shows the file alone if you like', async () => {
      const { bridge } = repository();
      const { fixture, texts, made, button, editor } = await openFiles(bridge);
      button('.list .file', 'ui/src/ribbon.ts modified').click();
      await fixture.whenStable();
      expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual(['Its changes since the last commit']);
      expect(editor('committed')!.value).toBe('export const ribbon = 1;\n');
      expect(editor()!.value).toBe('export const ribbon = 2;\n');
      expect(editor()!.dataset['language']).toBe('typescript');

      button('.show button', 'The file').click();
      await fixture.whenStable();
      expect(editor('committed')).toBeNull();
      expect(editor()!.value).toBe('export const ribbon = 2;\n');
      expect(made).toMatchObject({ editors: 1, diffs: 1 });
    });

    it('says a new file is all new since the last commit', async () => {
      const { bridge } = repository();
      const { fixture, texts, button, editor } = await openFiles(bridge);
      button('.list .file', 'ui/src/seal.ts new').click();
      await fixture.whenStable();
      expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual(['All new since the last commit']);
      expect(editor('committed')!.value).toBe('');
    });

    it('reads a file open on the page again when it changes on disk, over changes not saved', async () => {
      const { bridge, emit, disk } = repository();
      const { fixture, texts, button, editor, type } = await openFiles(bridge);
      button('.entry', 'README.md').click();
      await fixture.whenStable();
      await type('# Mine\n');

      disk['README.md'] = { path: 'README.md', text: '# Grimoire, by the agent\n', changedAt: 3 };
      emit('files.changed', { root: 'C:/Users/me/git/grimoire', path: 'README.md' });
      await fixture.whenStable();
      expect(editor()!.value).toBe('# Grimoire, by the agent\n');
      expect(texts('gr-files-page .note')).toEqual(['It changed on disk, and was read again.']);
      expect(button('.gr-link', 'Save Ctrl+S').getAttribute('aria-disabled')).toBe('true');

      // Another folder's file of the same name isn't this one.
      emit('files.changed', { root: 'C:/Users/me/git/other', path: 'README.md' });
      await fixture.whenStable();
      expect(editor()!.value).toBe('# Grimoire, by the agent\n');
    });

    it("won't turn back to the folder with changes not saved, until they're discarded", async () => {
      const { bridge, calls } = repository();
      const { fixture, el, texts, button, type } = await openFiles(bridge);
      button('.entry', 'README.md').click();
      await fixture.whenStable();
      await type('# Mine\n');

      button('.gr-link', 'Back to the files').click();
      await fixture.whenStable();
      expect(texts('gr-files-page .note.alert')).toEqual(['Save your changes, or discard them, first.']);
      expect(el.querySelector('gr-code-editor')).not.toBeNull();

      button('.gr-link', 'Discard changes').click();
      await fixture.whenStable();
      button('.gr-link', 'Back to the files').click();
      await fixture.whenStable();
      expect(el.querySelector('gr-code-editor')).toBeNull();
      expect(texts('gr-files-page h3')).toEqual(['Not committed yet', 'All its files']);
      expect(calls).toContainEqual({ command: 'files.close', request: { cwd: 'C:/Users/me', path: 'README.md' } });
    });

    it('keeps the open file and its changes while the facing page shows another', async () => {
      const { bridge } = repository();
      const { fixture, el, button, editor, type } = await openFiles(bridge);
      button('.entry', 'README.md').click();
      await fixture.whenStable();
      await type('# Mine\n');
      const tab = (label: string) =>
        [...el.querySelectorAll<HTMLButtonElement>('.tabs button')].find((t) => t.textContent!.trim() === label)!;
      tab('Outline').click();
      await fixture.whenStable();
      expect(el.querySelector('gr-files-page')).toBeNull();
      tab('Files').click();
      await fixture.whenStable();
      expect(editor()!.value).toBe('# Mine\n');
      expect(button('.gr-link', 'Discard changes')).toBeDefined();
    });

    it('finds files by name', async () => {
      const { bridge, calls } = repository();
      const { fixture, el, texts, button, editor } = await openFiles(bridge);
      const field = el.querySelector<HTMLInputElement>('#gr-files-look-up')!;
      field.value = 'src';
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(texts('gr-files-page h3')).toEqual(['Found']);
      expect(texts('gr-files-page .list .file')).toEqual(['ui/src/ribbon.ts', 'ui/src/seal.ts']);
      expect(calls.filter((c) => c.command === 'files.find').map((c) => c.request)).toEqual([
        { cwd: 'C:/Users/me', query: 'src' },
      ]);

      field.value = 'nothing';
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(texts('gr-files-page .none')).toEqual(['No file’s path has those words in it.']);

      field.value = 'seal';
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      button('.list .file', 'ui/src/seal.ts').click();
      await fixture.whenStable();
      expect(editor()!.value).toBe('export const seal = 1;\n');
      // Opened from the search, it shows the file alone.
      expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual(['The file']);
    });

    describe('Open in Files', () => {
      const ribbonEdit = {
        kind: 'tool' as const,
        id: 't1',
        tool: 'Edit',
        input: {
          file_path: 'C:/work/grimoire/ui/src/ribbon.ts',
          old_string: 'export const ribbon = 1;',
          new_string: 'export const ribbon = 2;',
        },
        result: { text: 'Updated.', isError: false },
      };
      /** The book with the VS Code editor faked, and the corrections' link. */
      async function book(bridge: GrimoireBridge) {
        const monaco = fakeMonaco();
        const rendered = await render(bridge, [{ provide: MONACO, useValue: monaco.load }]);
        const openIn = (where = '') =>
          [...rendered.el.querySelectorAll<HTMLButtonElement>(`${where} gr-corrections .gr-link`)].find(
            (b) => b.textContent!.trim() === 'Open in Files',
          );
        const foldOut = async (name: string) => {
          rendered.el.querySelector<HTMLButtonElement>('.note.summary')?.click();
          await rendered.fixture.whenStable();
          [...rendered.el.querySelectorAll<HTMLButtonElement>('.note')]
            .find((note) => note.textContent!.includes(name) && !note.classList.contains('summary'))!
            .click();
          await rendered.fixture.whenStable();
        };
        return { ...rendered, made: monaco.made, openIn, foldOut };
      }

      it('opens a file the agent edited on its changes, from its corrections', async () => {
        const { bridge, emit, calls } = repository();
        const { fixture, el, texts, made, openIn, foldOut } = await book(bridge);
        await write(fixture, el, 'Fix the ribbon');
        emit('agents.entry', { chatId: 'chat-1', entry: { kind: 'agent', id: 'a1', blocks: [ribbonEdit] } });
        await fixture.whenStable();
        await foldOut('ribbon.ts');

        openIn()!.click();
        await fixture.whenStable();
        expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
        expect(calls.filter((c) => c.command === 'files.open').map((c) => c.request)).toEqual([
          { cwd: 'C:/work/grimoire', path: 'C:/work/grimoire/ui/src/ribbon.ts' },
        ]);
        expect(texts('gr-files-page .sub .path')).toEqual(['ui/src/ribbon.ts']);
        expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual(['Its changes since the last commit']);
        expect(el.querySelector<HTMLTextAreaElement>('gr-files-page .fake-editor.committed')!.value).toBe(
          'export const ribbon = 1;\n',
        );
        // It starts at the first change.
        expect(made.revealed).toBe(1);
      });

      it('opens a change on the Git page in Files', async () => {
        const { bridge, calls } = repository();
        const { fixture, el, texts, openIn } = await book(bridge);
        [...el.querySelectorAll<HTMLButtonElement>('.tabs button')]
          .find((tab) => tab.textContent!.trim() === 'Git')!
          .click();
        await fixture.whenStable();
        el.querySelector<HTMLButtonElement>('gr-git-page .change')!.click();
        await fixture.whenStable();

        openIn('gr-git-page')!.click();
        await fixture.whenStable();
        expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
        expect(calls.filter((c) => c.command === 'files.open').map((c) => c.request)).toEqual([
          { cwd: 'C:/Users/me', path: 'C:/Users/me/git/grimoire/ui/src/ribbon.ts' },
        ]);
        expect(texts('gr-files-page .sub .path')).toEqual(['ui/src/ribbon.ts']);
      });

      it('opens a file outside the folder from an edit only proposed, as it is now', async () => {
        const { bridge, emit } = repository();
        const { fixture, el, texts, openIn } = await book(bridge);
        await write(fixture, el, 'Remember this');
        emit('agents.approval', {
          approval: {
            id: 'ap1',
            chatId: 'chat-1',
            tool: 'Edit',
            input: { file_path: 'C:/Users/me/.claude/CLAUDE.md', old_string: '# Mine', new_string: '# Ours' },
            alwaysAllow: { scope: 'chat' },
          },
        });
        await fixture.whenStable();

        openIn('gr-approval-slip')!.click();
        await fixture.whenStable();
        expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
        expect(texts('gr-files-page .sub .path')).toEqual(['~/.claude/CLAUDE.md']);
        expect(el.querySelector<HTMLTextAreaElement>('gr-files-page .fake-editor')!.value).toBe('# Mine\n');
        // Not in a repository: nothing to show beside it.
        expect(el.querySelector('gr-files-page .show')).toBeNull();
      });

      it('keeps a file with changes not saved open, and asks to save or discard them first', async () => {
        const { bridge, emit, calls } = repository();
        const { fixture, el, texts, openIn, foldOut } = await book(bridge);
        await write(fixture, el, 'Fix the ribbon');
        [...el.querySelectorAll<HTMLButtonElement>('.tabs button')]
          .find((tab) => tab.textContent!.trim() === 'Files')!
          .click();
        await fixture.whenStable();
        [...el.querySelectorAll<HTMLButtonElement>('gr-files-page .entry')]
          .find((entry) => entry.textContent!.trim() === 'README.md')!
          .click();
        await fixture.whenStable();
        const editor = el.querySelector<HTMLTextAreaElement>('gr-files-page .fake-editor')!;
        editor.value = '# Mine\n';
        editor.dispatchEvent(new Event('input'));
        await fixture.whenStable();

        emit('agents.entry', { chatId: 'chat-1', entry: { kind: 'agent', id: 'a1', blocks: [ribbonEdit] } });
        await fixture.whenStable();
        await foldOut('ribbon.ts');
        openIn()!.click();
        await fixture.whenStable();
        expect(texts('gr-files-page .sub .path')).toEqual(['README.md']);
        expect(texts('gr-files-page .note.alert')).toEqual(['Save your changes, or discard them, first.']);
        expect(calls.filter((c) => c.command === 'files.open')).toHaveLength(1);
      });

      it('leaves Open in Files out in focus mode, where there is no facing page', async () => {
        const { bridge, emit } = repository();
        const { fixture, el, openIn, foldOut } = await book(bridge);
        await write(fixture, el, 'Fix the ribbon');
        emit('agents.entry', { chatId: 'chat-1', entry: { kind: 'agent', id: 'a1', blocks: [ribbonEdit] } });
        await fixture.whenStable();
        await foldOut('ribbon.ts');
        expect(openIn()).toBeDefined();

        [...el.querySelectorAll<HTMLButtonElement>('gr-facing-page .gr-link')]
          .find((link) => link.textContent!.includes('Single page'))!
          .click();
        await fixture.whenStable();
        expect(el.querySelector('gr-corrections')).not.toBeNull();
        expect(openIn()).toBeUndefined();
      });
    });

    it("says when a file can't be shown", async () => {
      const { bridge } = repository();
      const { fixture, el, texts, button } = await openFiles(bridge);
      button('.entry', 'logo.png').click();
      await fixture.whenStable();
      expect(texts('gr-files-page .none')).toEqual(['It isn’t text, so it can’t be shown here.']);
      expect(el.querySelector('gr-code-editor')).toBeNull();
    });
  });
});
