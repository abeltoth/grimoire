import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAdapter } from './fake-adapter-testing';
import { AgentHub } from './hub';
import { type Sent, SigningAdapter, settings, settle } from './hub-testing';

let fake: FakeAdapter;
let hub: AgentHub;
let sent: Sent[];

beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeAdapter();
  sent = [];
  hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50);
  hub.addAdapter(fake);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Accounts', () => {
  describe('signing in to another account', () => {
    let signing: SigningAdapter;
    const accountEvents = () =>
      sent.filter((s) => s.event === 'agents.account').map((s) => s.payload);

    beforeEach(() => {
      signing = new SigningAdapter();
      hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50);
      hub.addAdapter(signing);
    });

    it("says who the agent is signed in as, and nothing for an agent that can't switch", async () => {
      expect(await hub.account('fake')).toEqual({
        agent: 'fake',
        account: { email: 'me@example.com', plan: 'pro', expiresAt: null },
        pending: null,
      });
      hub.addAdapter(
        Object.assign(new FakeAdapter(), {
          info: { id: 'plain', name: 'Plain', capabilities: [] },
        }),
      );
      expect(await hub.account('plain')).toEqual({ agent: 'plain', account: null, pending: null });
      await expect(hub.signIn('plain', 'mum@example.com')).rejects.toThrow(
        "Plain can't switch accounts",
      );
      await expect(hub.signIn('fake', 'mum')).rejects.toThrow('Give the email');
    });

    it('signs in in the browser, telling every window, and moves the open chats to the new account', async () => {
      const idle = await hub.start('fake', settings, 'Hello');
      signing.runOf(idle.id).events.turnEnded();
      const busy = await hub.start('fake', settings, 'Working');
      sent = [];

      const signedIn = hub.signIn('fake', ' mum@example.com ');
      await settle();
      expect(signing.signingIn?.email).toBe('mum@example.com');
      expect(accountEvents().at(-1)).toEqual({
        agent: 'fake',
        account: { email: 'me@example.com', plan: 'pro', expiresAt: null },
        pending: { email: 'mum@example.com', url: null },
      });
      signing.signingIn?.page('https://example.com/sign-in');
      await settle();
      expect(accountEvents().at(-1)?.pending).toEqual({
        email: 'mum@example.com',
        url: 'https://example.com/sign-in',
      });
      hub.signInCode('fake', 'abc#123');
      expect(signing.signingIn?.codes).toEqual(['abc#123']);

      signing.signingIn?.finish();
      const mum = {
        agent: 'fake',
        account: { email: 'mum@example.com', plan: 'pro', expiresAt: null },
        pending: null,
      };
      expect(await signedIn).toEqual(mum);
      expect(accountEvents().at(-1)).toEqual(mum);

      // The idle chat's process stopped; its next message starts another, continuing the chat.
      const before = signing.runOf(idle.id);
      expect(before.closed).toBe(true);
      hub.send(idle.id, 'Again');
      expect(signing.runOf(idle.id)).not.toBe(before);
      expect(signing.runOf(idle.id)).toMatchObject({ resume: true, sent: ['Again'] });
      // What the stopped process still reports is dropped.
      sent = [];
      before.events.closed('Stopped');
      expect(sent).toEqual([]);

      // The busy chat finishes its turn first, then moves.
      const working = signing.runOf(busy.id);
      expect(working.closed).toBe(false);
      hub.send(busy.id, 'Queued');
      working.events.turnEnded();
      expect(working.closed).toBe(true);
      expect(signing.runOf(busy.id)).toMatchObject({ resume: true, sent: ['Queued'] });
    });

    it('leaves the account and the chats as they were when the sign-in is cancelled', async () => {
      const { id } = await hub.start('fake', settings, 'Hello');
      signing.runOf(id).events.turnEnded();
      const attempt = hub.signIn('fake', 'mum@example.com');
      await settle();
      hub.cancelSignIn('fake');
      await expect(attempt).rejects.toThrow('cancelled');
      await settle();

      expect(signing.runOf(id).closed).toBe(false);
      expect(accountEvents().at(-1)).toEqual({
        agent: 'fake',
        account: { email: 'me@example.com', plan: 'pro', expiresAt: null },
        pending: null,
      });
      expect(() => hub.signInCode('fake', 'abc')).toThrow('No sign-in is under way');
    });

    it('cancels a sign-in under way when another begins', async () => {
      const first = hub.signIn('fake', 'mum@example.com');
      const firstSignIn = signing.signingIn;
      const second = hub.signIn('fake', 'dad@example.com');
      await expect(first).rejects.toThrow('cancelled');
      expect(firstSignIn?.cancelled).toBe(true);
      await settle();
      expect(accountEvents().at(-1)?.pending).toEqual({ email: 'dad@example.com', url: null });
      signing.signingIn?.finish();
      expect((await second).account?.email).toBe('dad@example.com');
    });
  });
});
