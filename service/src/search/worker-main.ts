/**
 * The search worker (ADR-010): a process of its own that keeps the search
 * index and looks through it, so reading every transcript never stalls the
 * service. The service starts it and talks to it over Node's IPC channel;
 * when the service goes, so does the worker.
 *
 *   node search-worker.mjs --index <file | :memory:>
 */
import { parseArgs } from 'node:util';
import { ClaudeAdapter } from '../agents/claude/claude-adapter';
import { Indexer } from './indexer';
import type { WorkerReply, WorkerRequest } from './protocol';
import { SearchIndex } from './search-index';

/** While you search, the chats are read again at most this often, and after each turn ends. */
const FRESH_MS = 30_000;

const { values } = parseArgs({ options: { index: { type: 'string', default: ':memory:' } } });
const reply = (message: WorkerReply) => process.send?.(message);
const index = new SearchIndex(values.index);
const indexer = new Indexer(index, [new ClaudeAdapter()], (log) => reply({ log }));

async function search(id: number, query: string): Promise<void> {
  try {
    await indexer.syncIfStale(FRESH_MS);
    reply({ id, hits: index.search(query) });
  } catch (error) {
    reply({ id, error: error instanceof Error ? error.message : String(error) });
  }
}

process.on('message', (request: WorkerRequest) => {
  if (request.kind === 'stale') indexer.markStale();
  else void search(request.id, request.query);
});
process.on('disconnect', () => {
  index.close();
  process.exit(0);
});

// Index the chats now, so the first search doesn't wait for them all.
indexer.sync().catch((error: unknown) => reply({ log: `Indexing failed: ${String(error)}` }));
