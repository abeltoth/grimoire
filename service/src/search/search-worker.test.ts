import { describe, expect, it, vi } from 'vitest';
import type { WorkerReply, WorkerRequest } from './protocol';
import { SearchWorker, type WorkerProcess } from './search-worker';

/** A worker process the test answers for. */
function fakeProcess() {
  const sent: WorkerRequest[] = [];
  let reply: (reply: WorkerReply) => void = () => {};
  let exit: () => void = () => {};
  const process: WorkerProcess = {
    send: (request) => void sent.push(request),
    onReply: (listener) => (reply = listener),
    onExit: (listener) => (exit = listener),
    kill: vi.fn(),
  };
  return { process, sent, reply: (r: WorkerReply) => reply(r), exit: () => exit() };
}

describe('SearchWorker', () => {
  it('passes searches to the worker and its answers back', async () => {
    const worker = fakeProcess();
    const log = vi.fn();
    const search = new SearchWorker(() => worker.process, log);
    const first = search.search('meter');
    const second = search.search('login');
    expect(worker.sent).toEqual([
      { kind: 'search', id: 1, query: 'meter' },
      { kind: 'search', id: 2, query: 'login' },
    ]);
    worker.reply({ id: 2, error: 'no index' });
    worker.reply({
      id: 1,
      hits: [
        { chatId: 'c1', agent: 'a', kind: 'title', excerpt: [{ text: 'Meter', match: true }] },
      ],
    });
    worker.reply({ log: 'Indexed 2 chats' });
    expect((await first).map((hit) => hit.chatId)).toEqual(['c1']);
    await expect(second).rejects.toThrow('no index');
    expect(log).toHaveBeenCalledWith('Search: Indexed 2 chats');

    search.markStale();
    expect(worker.sent.at(-1)).toEqual({ kind: 'stale' });
  });

  it('asks the worker where the tokens went', async () => {
    const worker = fakeProcess();
    const search = new SearchWorker(() => worker.process);
    const asked = search.tokens(1_000);
    expect(worker.sent).toEqual([{ kind: 'tokens', id: 1, since: 1_000 }]);
    const none = {
      input: 0,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead: 0,
      output: 0,
      weight: 0,
    };
    const totals = { since: 1_000, total: none, days: [], models: [], folders: [], chats: [] };
    worker.reply({ id: 1, totals });
    await expect(asked).resolves.toEqual(totals);
  });

  it('fails the searches waiting when the worker stops, and starts it again for the next', async () => {
    const workers = [fakeProcess(), fakeProcess()];
    const start = vi.fn(() => workers[start.mock.calls.length - 1]!.process);
    const search = new SearchWorker(start);
    search.warm();
    const waiting = search.search('meter');
    workers[0]!.exit();
    await expect(waiting).rejects.toThrow('The search stopped');

    const next = search.search('meter');
    expect(start).toHaveBeenCalledTimes(2);
    workers[1]!.reply({ id: 2, hits: [] });
    await expect(next).resolves.toEqual([]);

    search.close();
    expect(workers[1]!.process.kill).toHaveBeenCalled();
  });
});
