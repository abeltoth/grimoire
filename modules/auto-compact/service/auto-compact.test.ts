import type { ChatStatus, PromptCache } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoCompact, type Chats, LEAD_MS } from './auto-compact';

const HOUR = 60 * 60_000;

/** The faked clock, which the timers move. */
const now = () => vi.getMockedSystemTime()!.getTime();

let on: boolean;
let chat: { status: ChatStatus; capabilities: 'compact'[]; cache?: PromptCache } | undefined;
let sent: string[];
let logged: string[];
let auto: AutoCompact;
/** Why sending fails, as when the chat closed; undefined while it works. */
let failing: string | undefined;

const chats: Chats = {
  glance: () => chat,
  send: (chatId, text) => {
    if (failing) throw new Error(failing);
    sent.push(`${chatId}: ${text}`);
  },
};

/** A turn ends now, leaving `tokens` in an hour's cache, as the hub would tell both. */
function turnEnds(tokens = 100_000): PromptCache {
  const cache = { tokens, until: now() + HOUR };
  chat = { status: 'idle', capabilities: ['compact'], cache };
  auto.cached('c1', cache);
  return cache;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  on = true;
  failing = undefined;
  sent = [];
  logged = [];
  auto = new AutoCompact(
    chats,
    () => on,
    (message) => logged.push(message),
    now,
  );
});

afterEach(() => {
  auto.forget();
  vi.useRealTimers();
});

describe('AutoCompact', () => {
  it('compacts an idle chat shortly before its cache runs out', () => {
    turnEnds();

    vi.advanceTimersByTime(HOUR - LEAD_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['c1: /compact']);
    expect(logged).toEqual(['Compacting chat c1 before its prompt cache runs out']);
  });

  it('waits again for the cache each new turn leaves', () => {
    turnEnds();
    vi.advanceTimersByTime(HOUR / 2);
    turnEnds();

    vi.advanceTimersByTime(HOUR / 2);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(HOUR / 2);
    expect(sent).toEqual(['c1: /compact']);
  });

  it('leaves a small chat alone, since re-reading it costs little', () => {
    turnEnds(39_999);
    vi.advanceTimersByTime(HOUR);
    expect(sent).toEqual([]);
  });

  it('leaves a chat whose turn runs, which is closed, or whose agent cannot compact', () => {
    turnEnds();
    chat!.status = 'thinking';
    vi.advanceTimersByTime(HOUR);

    turnEnds();
    chat = undefined;
    vi.advanceTimersByTime(HOUR);

    turnEnds();
    chat!.capabilities = [];
    vi.advanceTimersByTime(HOUR);
    expect(sent).toEqual([]);
  });

  it('leaves a chat whose cache changed meanwhile, or ran out while the timer slept', () => {
    turnEnds();
    chat!.cache = { tokens: 100_000, until: HOUR * 2 };
    vi.advanceTimersByTime(HOUR);

    const cache = turnEnds();
    // Time jumps as after sleep: the clock passes the cache's end before the timer fires.
    vi.setSystemTime(cache.until);
    vi.advanceTimersByTime(HOUR);
    expect(sent).toEqual([]);
  });

  it('does nothing while the setting is off, and plans the chats again when it turns on', () => {
    on = false;
    turnEnds();
    vi.advanceTimersByTime(HOUR / 2);
    expect(sent).toEqual([]);

    on = true;
    auto.reconsider();
    vi.advanceTimersByTime(HOUR / 2);
    expect(sent).toEqual(['c1: /compact']);
  });

  it('stops a planned compaction when the setting turns off', () => {
    turnEnds();
    on = false;
    auto.reconsider();
    vi.advanceTimersByTime(HOUR);
    expect(sent).toEqual([]);
  });

  it('compacts a chat again only once you write in it', () => {
    turnEnds();
    vi.advanceTimersByTime(HOUR);
    // The compaction's own message and the cache its summary leaves don't count.
    auto.wrote('c1', '/compact');
    turnEnds(60_000);
    vi.advanceTimersByTime(HOUR);
    expect(sent).toEqual(['c1: /compact']);

    auto.wrote('c1', 'Go on');
    turnEnds();
    vi.advanceTimersByTime(HOUR);
    expect(sent).toEqual(['c1: /compact', 'c1: /compact']);
  });

  it('logs a compaction it could not send', () => {
    turnEnds();
    failing = 'This chat is not open';
    vi.advanceTimersByTime(HOUR);
    expect(logged).toEqual(["Couldn't compact chat c1: This chat is not open"]);
  });
});
