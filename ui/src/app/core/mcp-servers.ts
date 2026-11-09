import { Injectable, PendingTasks, inject, signal } from '@angular/core';
import type { AgentId, SetupItem } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './bridge';

/** A folder to compare by: one kind of slash, no slash at the end, in one case. */
const folderKey = (folder: string) => folder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Where a list is kept: the agent and the folder, or none for your home folder. */
const keyOf = (agent: AgentId, cwd: string | undefined) => `${agent}\n${cwd ? folderKey(cwd) : ''}`;

/**
 * The MCP servers an agent loads in a folder, as its setup lists them, to
 * turn off for one chat or for every one. Each folder's is read once
 * it's asked for, and again when its setup changes.
 */
@Injectable({ providedIn: 'root' })
export class McpServers {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  private readonly lists = signal<ReadonlyMap<string, readonly SetupItem[]>>(new Map());
  /** The folders asked for, by key, with the folder as asked. */
  private readonly asked = new Map<string, { agent: AgentId; cwd: string | undefined }>();

  constructor() {
    this.bridge.on('setup.changed', ({ agent, cwd }) => {
      const key = keyOf(agent, cwd);
      if (this.asked.has(key)) void this.read(agent, cwd);
    });
  }

  /** The folder's MCP servers, your home folder's without one; undefined until they've been read. */
  of(agent: AgentId, cwd: string | undefined): readonly SetupItem[] | undefined {
    return this.lists().get(keyOf(agent, cwd));
  }

  /** Reads the folder's MCP servers, unless they've been read already. */
  load(agent: AgentId, cwd: string | undefined): void {
    if (this.asked.has(keyOf(agent, cwd))) return;
    this.asked.set(keyOf(agent, cwd), { agent, cwd });
    void this.read(agent, cwd);
  }

  private async read(agent: AgentId, cwd: string | undefined): Promise<void> {
    const done = this.pending.add();
    try {
      const setup = await this.bridge.invoke('setup.get', { agent, ...(cwd ? { cwd } : {}) });
      const servers = setup?.sections.mcpServers ?? [];
      this.lists.update((lists) => new Map(lists).set(keyOf(agent, cwd), servers));
    } catch {
      // None to list: the ones already turned off still show.
      this.lists.update((lists) =>
        new Map(lists).set(keyOf(agent, cwd), lists.get(keyOf(agent, cwd)) ?? []),
      );
    } finally {
      done();
    }
  }
}
