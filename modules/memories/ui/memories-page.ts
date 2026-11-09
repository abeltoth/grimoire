import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  PendingTasks,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { AgentId, AgentInfo, AgentMemories, Memory, SetupFile } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';
import { FileEditor } from '@ui/app/shell/file-editor';

/** An agent that keeps memories, and those it keeps for the folder. */
interface Kept {
  agent: AgentInfo;
  memories: AgentMemories;
}

/** A memory open to read, change or delete. */
interface Editing {
  agent: AgentInfo;
  /** The folder the agent keeps it for. */
  cwd: string;
  file: SetupFile;
  /** Its kind, as its column is titled. */
  kind: string;
}

/** A column of the map: the memories of one kind. */
interface Column {
  type: string;
  title: string;
  memories: Memory[];
}

/** A link drawn between two cards, in the map's own coordinates. */
interface Line {
  from: string;
  to: string;
  d: string;
  /** Where it arrives, marked with a dot. */
  x: number;
  y: number;
}

/** The kinds in the order their columns stand; any other follows, then those that don't say. */
const KINDS: Record<string, string> = {
  user: 'About you',
  feedback: 'Feedback',
  project: 'Projects',
  reference: 'References',
};

const key = (name: string) => name.trim().toLowerCase();

/** The memory a [[link]] names: by its name, or its file's. */
function resolve(memories: readonly Memory[], link: string): Memory | undefined {
  const wanted = key(link);
  return memories.find(
    (memory) =>
      key(memory.name) === wanted ||
      key(memory.path.split(/[\\/]/).at(-1)!.replace(/\.md$/i, '')) === wanted,
  );
}

/**
 * The Memories page: the memories an agent keeps on its own for a folder,
 * the open chat's until you pick another, as cards in columns by kind
 * with their [[links]] drawn between them; and what's wrong with them.
 */
@Component({
  selector: 'gr-memories-page',
  imports: [FileEditor],
  host: { '[class.editing]': 'editing() !== null' },
  templateUrl: './memories-page.html',
  styleUrl: './memories-page.css',
})
export class MemoriesPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  protected readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  private readonly pending = inject(PendingTasks);
  private readonly injector = inject(Injector);

  /** The folder you picked; the open chat's until you pick one. */
  private readonly picked = signal<string | undefined>(undefined);
  protected readonly cwd = computed(() => this.picked() ?? this.chats.current()?.settings.cwd);

  /** What the agents keep; undefined until they've answered. */
  protected readonly kept = signal<Kept[] | undefined>(undefined);
  protected readonly reading = signal(false);
  protected readonly failed = signal<string | null>(null);
  private asked = 0;

  /** The memory you're pointing at, whose links stand out. */
  protected readonly pointed = signal<string | null>(null);
  protected readonly lines = signal<Line[]>([]);
  private readonly map = viewChild<ElementRef<HTMLElement>>('map');

  /** The memory open to read, change or delete; null while the map shows. */
  protected readonly editing = signal<Editing | null>(null);
  private readonly editor = viewChild(FileEditor);
  /** Whether you're asked to make sure of deleting the open memory. */
  protected readonly deleting = signal(false);
  /** Why a memory couldn't be opened. */
  protected readonly trouble = signal<string | null>(null);
  /** Whether a memory was saved, so the map is read again on the way back to it. */
  private stale = false;

  constructor() {
    effect(() => {
      const cwd = this.cwd();
      if (this.chats.agents().length) untracked(() => void this.read(cwd));
    });

    // The links follow the cards wherever the page's width puts them.
    let observer: ResizeObserver | undefined;
    effect(() => {
      const map = this.map()?.nativeElement;
      observer?.disconnect();
      if (!map || typeof ResizeObserver === 'undefined') return;
      observer = new ResizeObserver(() => this.measure());
      observer.observe(map);
    });
    // A memory shown changed, appeared or went: read them again.
    const off = this.bridge.on('memories.changed', ({ agent, cwd }) =>
      this.memoriesChanged(agent, cwd),
    );
    inject(DestroyRef).onDestroy(() => {
      observer?.disconnect();
      off();
    });
  }

  protected async read(cwd = this.cwd()): Promise<void> {
    const ask = ++this.asked;
    this.reading.set(true);
    const done = this.pending.add();
    this.failed.set(null);
    try {
      const agents = this.chats.agents();
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
      afterNextRender(() => this.measure(), { injector: this.injector });
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
      this.deleting.set(false);
      this.editor()?.tell(null);
    } catch (error) {
      this.trouble.set(`It couldn’t be opened: ${message(error)}`);
    } finally {
      done();
    }
  }

  /** Turns from the open memory to one it's linked with, once there's nothing to save. */
  protected turnTo(memory: Memory): void {
    const edit = this.editing();
    if (!edit || !this.editor()?.mayLeave()) return;
    void this.open(edit.agent, edit.cwd, memory, this.kindOf(memory.type));
  }

  /** Writes the open memory over the file as it was opened. */
  protected readonly writeMemory = (file: SetupFile, text: string): Promise<SetupFile> => {
    const edit = this.editing()!;
    return this.bridge.invoke('memories.save', {
      agent: edit.agent.id,
      cwd: edit.cwd,
      path: file.path,
      text,
      changedAt: file.changedAt,
    });
  };

  /** Keeps the memory as saved, and reads the map again on the way back to it. */
  protected saved(file: SetupFile): void {
    const edit = this.editing();
    if (edit) this.editing.set({ ...edit, file });
    this.stale = true;
  }

  /** Deletes the open memory and its line in the index, and turns back to the map. */
  protected async remove(): Promise<void> {
    const edit = this.editing();
    if (!edit) return;
    const done = this.pending.add();
    try {
      await this.bridge.invoke('memories.delete', {
        agent: edit.agent.id,
        cwd: edit.cwd,
        path: edit.file.path,
        changedAt: edit.file.changedAt,
      });
      this.editing.set(null);
      this.stale = false;
      void this.read();
    } catch (error) {
      this.editor()?.tell({ text: `It couldn’t be deleted: ${message(error)}`, alert: true });
    } finally {
      this.deleting.set(false);
      done();
    }
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
    this.deleting.set(false);
    if (this.stale) {
      this.stale = false;
      void this.read();
    } else {
      afterNextRender(() => this.measure(), { injector: this.injector });
    }
  }

  /** The memories the open one links to, the links that name none, and those that link to it. */
  protected readonly related = computed(() => {
    const edit = this.editing();
    const all =
      this.kept()?.find((one) => one.agent.id === edit?.agent.id)?.memories.memories ?? [];
    const memory = all.find((one) => one.path === edit?.file.path);
    if (!memory) return { to: [], missing: [], from: [] };
    const to = [...new Set(memory.links.flatMap((link) => resolve(all, link) ?? []))].filter(
      (one) => one !== memory,
    );
    const from = all.filter(
      (one) => one !== memory && one.links.some((link) => resolve(all, link) === memory),
    );
    return { to, missing: this.missing(all, memory), from };
  });

  protected async pickFolder(): Promise<void> {
    const folder = await this.bridge.chooseFolder();
    if (folder) this.picked.set(folder);
  }

  protected show(cwd: string): void {
    this.picked.set(cwd);
  }

  /** The memories in columns by kind, in the kinds' order. */
  protected columns(memories: readonly Memory[]): Column[] {
    const order = Object.keys(KINDS);
    const types = [...new Set(memories.map((memory) => memory.type))].sort((a, b) => {
      const rank = (type: string) =>
        type === '' ? order.length + 1 : order.includes(type) ? order.indexOf(type) : order.length;
      return rank(a) - rank(b) || a.localeCompare(b);
    });
    return types.map((type) => ({
      type,
      title: this.kindOf(type),
      memories: memories.filter((memory) => memory.type === type),
    }));
  }

  /** A kind as its column is titled. */
  private kindOf(type: string): string {
    return KINDS[type] ?? (type ? `${type.charAt(0).toUpperCase()}${type.slice(1)}` : 'Other');
  }

  /** The links of a memory that name no memory. */
  protected missing(memories: readonly Memory[], memory: Memory): string[] {
    return memory.links.filter((link) => !resolve(memories, link));
  }

  /** The memories linked with the one you're pointing at, either way, and itself. */
  private readonly near = computed(() => {
    const pointed = this.pointed();
    if (pointed === null) return null;
    const near = new Set([pointed]);
    for (const line of this.lines()) {
      if (line.from === pointed) near.add(line.to);
      if (line.to === pointed) near.add(line.from);
    }
    return near;
  });

  /** Whether a link is one of the memory's you're pointing at. */
  protected lit(line: Line): boolean {
    const pointed = this.pointed();
    return pointed !== null && (line.from === pointed || line.to === pointed);
  }

  /** Whether a card stands back while you point at a memory it isn't linked with. */
  protected faded(name: string): boolean {
    const near = this.near();
    return near !== null && !near.has(name);
  }

  protected time(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  protected date(at: number): string {
    return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /** Draws each link from its card to the card it names, as the cards now lie. */
  private measure(): void {
    const map = this.map()?.nativeElement;
    const memories = this.kept()?.[0]?.memories.memories ?? [];
    if (!map) {
      this.lines.set([]);
      return;
    }
    const origin = map.getBoundingClientRect();
    const boxes = new Map<string, DOMRect>();
    for (const card of map.querySelectorAll<HTMLElement>('[data-memory]')) {
      boxes.set(card.dataset['memory']!, card.getBoundingClientRect());
    }
    const lines: Line[] = [];
    for (const memory of memories) {
      const a = boxes.get(memory.name);
      for (const link of memory.links) {
        const target = resolve(memories, link);
        const b = target && target !== memory ? boxes.get(target.name) : undefined;
        if (!a || !b) continue;
        lines.push({ from: memory.name, to: target!.name, ...curve(a, b, origin) });
      }
    }
    this.lines.set(lines);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A curve from one card's side to another's: across the gap between their
 * columns, or out and back along their right sides when they share one.
 */
function curve(a: DOMRect, b: DOMRect, origin: DOMRect): { d: string; x: number; y: number } {
  const ay = a.top + a.height / 2 - origin.top;
  const by = b.top + b.height / 2 - origin.top;
  const sameColumn = Math.abs(a.left - b.left) < 1;
  if (sameColumn) {
    const ax = a.right - origin.left;
    const bx = b.right - origin.left;
    const out = Math.max(ax, bx) + Math.min(40, Math.abs(by - ay) / 3 + 12);
    return { d: `M ${ax} ${ay} C ${out} ${ay}, ${out} ${by}, ${bx} ${by}`, x: bx, y: by };
  }
  const rightward = b.left > a.left;
  const ax = (rightward ? a.right : a.left) - origin.left;
  const bx = (rightward ? b.left : b.right) - origin.left;
  const mid = (ax + bx) / 2;
  return { d: `M ${ax} ${ay} C ${mid} ${ay}, ${mid} ${by}, ${bx} ${by}`, x: bx, y: by };
}
