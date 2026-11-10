import { homedir } from 'node:os';
import type { ChatId, Entry } from '@grimoire/contract';
import type { AgentAdapter } from '@grimoire/service/core/adapter';
import type { Passage, SearchIndex, ToolUse, TurnUse } from './search-index';

/** What the indexer needs of an agent: its chats, and each one's transcript. */
export type IndexedAgent = Pick<AgentAdapter, 'info' | 'listChats' | 'history'>;

/** A chat's passages: its title, your messages, and the text of the agent's replies. */
export function passagesOf(title: string, entries: readonly Entry[]): Passage[] {
  const passages: Passage[] = [{ kind: 'title', text: title }];
  for (const entry of entries) {
    if (entry.kind === 'user') passages.push({ kind: 'you', text: entry.text });
    else if (entry.kind === 'agent') {
      const text = entry.blocks
        .flatMap((block) => (block.kind === 'text' ? [block.text] : []))
        .join('\n\n');
      passages.push({ kind: 'agent', text });
    }
  }
  return passages.filter((passage) => passage.text.trim());
}

/** What a chat's turns spent, by model, from your messages that began them. */
export function turnsOf(entries: readonly Entry[]): TurnUse[] {
  return entries.flatMap((entry) =>
    entry.kind === 'user' && entry.tokens
      ? entry.tokens.uses.map((use) => ({ ...use, at: entry.tokens!.at }))
      : [],
  );
}

/** A command or skill you wrote, as "/name" at the start of your message. */
const TYPED = /^\s*\/([^\s/][^\s]*)/;

/**
 * The tools the agent called in a chat, not its subagents, and the skills
 * it ran; and the commands and skills you wrote as "/name". Each at when
 * its message was written, or the turn it's in began; without either it's
 * left out.
 */
export function usesOf(entries: readonly Entry[]): ToolUse[] {
  const uses: ToolUse[] = [];
  let turnAt: number | undefined;
  for (const entry of entries) {
    if (entry.kind === 'user') {
      turnAt = entry.at ?? entry.tokens?.at;
      const typed = TYPED.exec(entry.text)?.[1];
      if (typed && turnAt !== undefined) uses.push({ at: turnAt, kind: 'skill', name: typed });
      continue;
    }
    const at = entry.at ?? turnAt;
    if (entry.kind !== 'agent' || at === undefined) continue;
    for (const block of entry.blocks) {
      if (block.kind !== 'tool' || !block.tool) continue;
      uses.push({ at, kind: 'tool', name: block.tool });
      if (block.skill) uses.push({ at, kind: 'skill', name: block.skill });
    }
  }
  return uses;
}

/**
 * Keeps the search index up with the agents' chats: a chat written in since
 * it was indexed is read again, and one that's gone is forgotten. A chat
 * that can't be read keeps what was indexed of it.
 */
export class Indexer {
  private syncing: Promise<void> | undefined;
  private syncedAt = -Infinity;
  private stale = true;

  constructor(
    private readonly index: SearchIndex,
    private readonly agents: readonly IndexedAgent[],
    private readonly log: (message: string) => void = () => {},
  ) {}

  /** A chat may have changed: the next search reads the chats again first. */
  markStale(): void {
    this.stale = true;
  }

  /** Reads the chats again when they may have changed, or when it's been `ms` since they were. */
  syncIfStale(ms: number, now = Date.now()): Promise<void> {
    return this.stale || now - this.syncedAt >= ms
      ? this.sync()
      : (this.syncing ?? Promise.resolve());
  }

  /** Indexes the chats written in since they were indexed, and forgets those gone. */
  sync(): Promise<void> {
    this.syncing ??= this.run().finally(() => (this.syncing = undefined));
    return this.syncing;
  }

  private async run(): Promise<void> {
    this.stale = false;
    const started = Date.now();
    const indexed = this.index.indexed();
    let read = 0;
    for (const agent of this.agents) {
      let chats;
      try {
        chats = await agent.listChats();
      } catch (error) {
        this.log(`Couldn't list ${agent.info.name}'s chats to index them: ${String(error)}`);
        continue;
      }
      const listed = new Set<ChatId>();
      for (const chat of chats) {
        listed.add(chat.id);
        if (indexed.get(chat.id)?.updatedAt === chat.updatedAt) continue;
        try {
          const { entries } = await agent.history(chat.id, chat.cwd ?? homedir());
          this.index.put(
            {
              id: chat.id,
              agent: agent.info.id,
              updatedAt: chat.updatedAt,
              title: chat.title,
              ...(chat.cwd ? { cwd: chat.cwd } : {}),
            },
            passagesOf(chat.title, entries),
            turnsOf(entries),
            usesOf(entries),
          );
          read++;
        } catch (error) {
          this.log(`Couldn't index chat ${chat.id}: ${String(error)}`);
        }
      }
      for (const [id, chat] of indexed) {
        if (chat.agent === agent.info.id && !listed.has(id)) this.index.remove(id);
      }
    }
    this.syncedAt = Date.now();
    if (read) this.log(`Indexed ${read} chats in ${this.syncedAt - started} ms`);
  }
}
