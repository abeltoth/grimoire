import {
  Component,
  DestroyRef,
  PendingTasks,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { AgentId, AgentInfo, Memory, SetupFile } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { type Editing, MemoryEditor } from './memory-editor';
import { type Kept, MemoryList } from './memory-list';
import { kindOf, message, related } from './memory-map';

/**
 * The Memories page: the memories an agent keeps on its own for a folder,
 * the open chat's until you pick another, as cards in columns by kind
 * with their [[links]] drawn between them; and what's wrong with them.
 */
@Component({
  selector: 'gr-memories-page',
  imports: [MemoryEditor, MemoryList],
  host: { '[class.editing]': 'editing() !== null' },
  templateUrl: './memories-page.html',
  styleUrls: ['./memory-asides.css', './memories-page.css'],
})
export class MemoriesPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  protected readonly list = inject(ChatList);
  protected readonly catalog = inject(AgentCatalog);
  private readonly pending = inject(PendingTasks);

  /** The folder you picked; the open chat's until you pick one. */
  private readonly picked = signal<string | undefined>(undefined);
  protected readonly cwd = computed(() => this.picked() ?? this.list.current()?.settings.cwd);

  /** What the agents keep; undefined until they've answered. */
  protected readonly kept = signal<Kept[] | undefined>(undefined);
  protected readonly reading = signal(false);
  protected readonly failed = signal<string | null>(null);
  private asked = 0;

  /** The memory you're pointing at on the map, still standing out when you're back from one. */
  protected readonly pointed = signal<string | null>(null);

  /** The memory open to read, change or delete; null while the map shows. */
  protected readonly editing = signal<Editing | null>(null);
  private readonly editor = viewChild(MemoryEditor);
  /** Why a memory couldn't be opened. */
  protected readonly trouble = signal<string | null>(null);
  /** Whether a memory was saved, so the map is read again on the way back to it. */
  private stale = false;

  /** The memories the open one links to, the links that name none, and those that link to it. */
  protected readonly related = computed(() => {
    const edit = this.editing();
    const all =
      this.kept()?.find((one) => one.agent.id === edit?.agent.id)?.memories.memories ?? [];
    return related(all, edit?.file.path);
  });

  constructor() {
    effect(() => {
      const cwd = this.cwd();
      if (this.catalog.agents().length) untracked(() => void this.read(cwd));
    });
    // A memory shown changed, appeared or went: read them again.
    const off = this.bridge.on('memories.changed', ({ agent, cwd }) =>
      this.memoriesChanged(agent, cwd),
    );
    inject(DestroyRef).onDestroy(off);
  }

  protected async read(cwd = this.cwd()): Promise<void> {
    const ask = ++this.asked;
    this.reading.set(true);
    const done = this.pending.add();
    this.failed.set(null);
    try {
      const agents = this.catalog.agents();
      const answers = await Promise.all(
        agents.map((agent) =>
          this.bridge.invoke('memories.list', { agent: agent.id, ...(cwd ? { cwd } : {}) }),
        ),
      );
      if (ask !== this.asked) return;
      this.kept.set(
        agents.flatMap((agent, i) => {
          const memories = answers[i];
          return memories ? [{ agent, memories }] : [];
        }),
      );
    } catch (error) {
      if (ask === this.asked) this.failed.set(message(error));
    } finally {
      if (ask === this.asked) this.reading.set(false);
      done();
    }
  }

  /** Opens a memory to read, change or delete, in place of the map. */
  protected async open(agent: AgentInfo, cwd: string, memory: Memory, kind: string): Promise<void> {
    const done = this.pending.add();
    this.trouble.set(null);
    try {
      const file = await this.bridge.invoke('memories.open', {
        agent: agent.id,
        cwd,
        path: memory.path,
      });
      this.editing.set({ agent, cwd, file, kind });
      this.editor()?.reset();
    } catch (error) {
      this.trouble.set(`It couldn’t be opened: ${message(error)}`);
    } finally {
      done();
    }
  }

  /** Turns from the open memory to one it's linked with. */
  protected turnTo(memory: Memory): void {
    const edit = this.editing();
    if (edit) void this.open(edit.agent, edit.cwd, memory, kindOf(memory.type));
  }

  /** Keeps the memory as saved, and reads the map again on the way back to it. */
  protected saved(file: SetupFile): void {
    const edit = this.editing();
    if (edit) this.editing.set({ ...edit, file });
    this.stale = true;
  }

  /** The open memory was deleted: back to the map, read again. */
  protected removed(): void {
    this.editing.set(null);
    this.stale = false;
    void this.read();
  }

  /**
   * Reads the memories again when they're those of the folder shown, so
   * the map, or the open memory's links, keep up. The open memory is
   * opened again as it is on disk, unless you've changed it.
   */
  private memoriesChanged(agent: AgentId, cwd: string): void {
    if (!this.kept()?.some((one) => one.agent.id === agent && one.memories.cwd === cwd)) return;
    void this.read();
    const edit = this.editing();
    if (edit && !this.editor()?.changed()) void this.reopen(edit);
  }

  /** Opens the memory again, as it is on disk now, while you haven't changed it. */
  private async reopen(edit: Editing): Promise<void> {
    const done = this.pending.add();
    try {
      const file = await this.bridge.invoke('memories.open', {
        agent: edit.agent.id,
        cwd: edit.cwd,
        path: edit.file.path,
      });
      if (this.editing()?.file.path !== file.path || this.editor()?.changed()) return;
      this.editing.set({ ...this.editing()!, file });
    } catch {
      // It went, or can't be read: keep it as it was opened; saving says what's wrong.
    } finally {
      done();
    }
  }

  /** Back to the map, once the editor has nothing to save; read again after a save. */
  protected close(): void {
    this.editing.set(null);
    if (this.stale) {
      this.stale = false;
      void this.read();
    }
  }

  protected async pickFolder(): Promise<void> {
    const folder = await this.bridge.chooseFolder();
    if (folder) this.picked.set(folder);
  }

  protected show(cwd: string): void {
    this.picked.set(cwd);
  }

  protected time(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}
