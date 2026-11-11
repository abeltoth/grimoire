import type { AgentEntry, EventName, EventPayload, SettingsChange } from '@grimoire/contract';
import { vi } from 'vitest';
import type { ChatEvents, LiveChat } from './adapter';
import { FakeAdapter } from './fake-adapter-testing';

/** What the hub's tests share: an event the hub sent, the agents they drive, and their settings. */
export type Sent = { [K in EventName]: { event: K; payload: EventPayload<K> } }[EventName];

export const settings = { cwd: '/work' };

export const reply = (id: string, text = ''): AgentEntry => ({
  kind: 'agent',
  id,
  blocks: [{ kind: 'text', text }],
});

/** Lets the hub's promises settle. */
export const settle = () => vi.advanceTimersByTimeAsync(0);

/** An agent that picks a new chat's ID itself, as Claude Code does on a spare process. */
export class PickingAdapter extends FakeAdapter {
  started?: {
    settings: typeof settings;
    text: string;
    id: string;
    events: ChatEvents;
    live: LiveChat & { closed: boolean; configured: SettingsChange[] };
  };
  disposed = false;
  /** When set, the agent names the chat once it settles. */
  gate?: Promise<void>;

  async start(
    chatSettings: typeof settings,
    text: string,
    id: string,
    bind: (chatId: string) => ChatEvents,
  ) {
    await (this.gate ?? Promise.resolve());
    const live = {
      closed: false,
      configured: [] as SettingsChange[],
      send() {},
      interrupt: async () => {},
      configure: async (change: SettingsChange) => void live.configured.push(change),
      close: () => void (live.closed = true),
    };
    this.started = { settings: chatSettings, text, id, events: bind('picked'), live };
    return live;
  }

  dispose() {
    this.disposed = true;
  }
}

/** An agent you can sign in to another account; the test finishes the sign-in. */
export class SigningAdapter extends FakeAdapter {
  signedInAs = 'me@example.com';
  signingIn?: {
    email: string;
    page: (url: string) => void;
    codes: string[];
    finish: () => void;
    cancelled: boolean;
  };

  async account() {
    return { email: this.signedInAs, plan: 'pro', expiresAt: null };
  }

  signIn(email: string, page: (url: string) => void) {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => {
      finish = () => {
        this.signedInAs = email;
        resolve();
      };
      fail = reject;
    });
    const signingIn = { email, page, codes: [] as string[], finish, cancelled: false };
    this.signingIn = signingIn;
    return {
      done,
      code: (code: string) => void signingIn.codes.push(code),
      cancel: () => {
        signingIn.cancelled = true;
        fail(new Error('The sign-in was cancelled'));
      },
    };
  }
}
