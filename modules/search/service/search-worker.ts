import { fork } from 'node:child_process';
import type { SearchHit, TokenTotals } from '@grimoire/contract';
import type { WorkerReply, WorkerRequest } from './protocol';

/** The search worker's process, as the service talks to it. */
export interface WorkerProcess {
  send(request: WorkerRequest): void;
  onReply(listener: (reply: WorkerReply) => void): void;
  /** Called once, when the process exits or couldn't start. */
  onExit(listener: () => void): void;
  kill(): void;
}

/**
 * The service's end of the search worker: it starts the worker,
 * passes searches to it, and starts it again if it stops.
 */
export class SearchWorker {
  private worker: WorkerProcess | undefined;
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    { resolve(answer: SearchHit[] | TokenTotals): void; reject(error: Error): void }
  >();

  constructor(
    private readonly start: () => WorkerProcess,
    private readonly log: (message: string) => void = () => {},
  ) {}

  /** Starts the worker, which indexes the chats in the background. */
  warm(): void {
    this.ensure();
  }

  search(query: string): Promise<SearchHit[]> {
    return this.ask((id) => ({ kind: 'search', id, query })) as Promise<SearchHit[]>;
  }

  /** Where the tokens went in the turns begun since a time. */
  tokens(since: number): Promise<TokenTotals> {
    return this.ask((id) => ({ kind: 'tokens', id, since })) as Promise<TokenTotals>;
  }

  /** A chat may have changed: the next search reads the chats again first. */
  markStale(): void {
    this.worker?.send({ kind: 'stale' });
  }

  /** Starts the worker again, as on another index; searches under way are turned away. */
  restart(): void {
    this.close();
    this.warm();
  }

  close(): void {
    const worker = this.worker;
    this.worker = undefined;
    worker?.kill();
    this.failAll('The search was stopped');
  }

  private ask(request: (id: number) => WorkerRequest): Promise<SearchHit[] | TokenTotals> {
    const worker = this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      worker.send(request(id));
    });
  }

  private ensure(): WorkerProcess {
    if (this.worker) return this.worker;
    const worker = this.start();
    this.worker = worker;
    worker.onReply((reply) => {
      if ('log' in reply) return this.log(`Search: ${reply.log}`);
      const waiting = this.waiting.get(reply.id);
      this.waiting.delete(reply.id);
      if ('error' in reply) waiting?.reject(new Error(reply.error));
      else waiting?.resolve('hits' in reply ? reply.hits : reply.totals);
    });
    worker.onExit(() => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      this.log('Search worker stopped');
      this.failAll('The search stopped; looking again starts it anew');
    });
    return worker;
  }

  private failAll(reason: string): void {
    for (const { reject } of this.waiting.values()) reject(new Error(reason));
    this.waiting.clear();
  }
}

/** Starts the worker bundled beside the service, on the same Node. */
export function forkWorker(entry: string, indexFile: string): WorkerProcess {
  const child = fork(entry, ['--index', indexFile], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  let exited = false;
  const exits: (() => void)[] = [];
  const exit = () => {
    if (exited) return;
    exited = true;
    exits.forEach((listener) => listener());
  };
  child.once('exit', exit);
  child.once('error', exit);
  return {
    send: (request) => {
      if (!exited && child.connected) child.send(request, (error) => error && exit());
    },
    onReply: (listener) => child.on('message', (reply) => listener(reply as WorkerReply)),
    onExit: (listener) => exits.push(listener),
    kill: () => child.kill(),
  };
}
