import type { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  CommandName,
  CommandRequest,
  EventName,
  EventPayload,
  GrimoireBridge,
  OpenChat,
  PingResult,
} from '@grimoire/contract';
import { App } from '../app/app';
import { appConfig } from '../app/app.config';
import { GRIMOIRE_BRIDGE } from '../app/core/bridge';

const ping: PingResult = {
  pid: 4242,
  buildId: 'b1',
  startedAt: 0,
  uptimeMs: 65_000,
  node: '24.22.1',
};

/** A bridge to a fake service: answers commands and lets tests send events. */
export function fakeBridge(overrides: Partial<GrimoireBridge> = {}) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const popoutListeners = new Set<(chatId: string) => void>();
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
      pins: [],

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
    'profiles.list': () => ({
      active: 'personal',
      profiles: [{ id: 'personal', name: 'Personal', claudeFolder: null }],
    }),
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
    onPopoutClosed: vi.fn((listener: (chatId: string) => void) => {
      popoutListeners.add(listener);
      return () => popoutListeners.delete(listener);
    }),
    openExternal: vi.fn(),
    ...overrides,
  };
  const emit = <K extends EventName>(event: K, payload: EventPayload<K>) =>
    listeners.get(event)?.forEach((listener) => listener(payload));
  /** A popout's window closed. */
  const closePopout = (chatId: string) => popoutListeners.forEach((listener) => listener(chatId));
  return { bridge, calls, emit, answers, closePopout };
}

export async function render(bridge: GrimoireBridge, providers: (Provider | EnvironmentProviders)[] = []) {
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
export function pick(el: HTMLElement, text: string) {
  const choices = [...el.querySelectorAll<HTMLButtonElement>('gr-settings-card .choice')];
  const choice = choices.find((c) => c.textContent!.replace(/\s+/g, ' ').trim().startsWith(text));
  if (!choice) throw new Error(`No choice ${text}`);
  choice.click();
}

export async function write(fixture: { whenStable(): Promise<unknown> }, el: HTMLElement, text: string) {
  const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
  field.value = text;
  field.dispatchEvent(new Event('input'));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  await fixture.whenStable();
}

/** A few bytes, as a picture file. */
export function picture(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

/** A paste or drop carrying these files. */
export function withFiles(type: 'paste' | 'drop', files: File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const holder = type === 'paste' ? 'clipboardData' : 'dataTransfer';
  Object.defineProperty(event, holder, { value: { files, types: ['Files'] } });
  return event;
}
