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
import type { AgentInfo, AgentMemories, Memory } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';

/** An agent that keeps memories, and those it keeps for the folder. */
interface Kept {
  agent: AgentInfo;
  memories: AgentMemories;
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
 * The Memory map: the memories an agent keeps on its own for a folder,
 * the open chapter's until you pick another, as cards in columns by kind
 * with their [[links]] drawn between them; and what's wrong with them.
 */
@Component({
  selector: 'gr-memory-map-page',
  templateUrl: './memory-map-page.html',
  styleUrl: './memory-map-page.css',
})
export class MemoryMapPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  protected readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  private readonly pending = inject(PendingTasks);
  private readonly injector = inject(Injector);

  /** The folder you picked; the open chapter's until you pick one. */
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
    inject(DestroyRef).onDestroy(() => observer?.disconnect());
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
          this.bridge.invoke('agents.memories', { agent: agent.id, ...(cwd ? { cwd } : {}) }),
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
      if (ask === this.asked)
        this.failed.set(error instanceof Error ? error.message : String(error));
    } finally {
      if (ask === this.asked) this.reading.set(false);
      done();
    }
  }

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
      title: KINDS[type] ?? (type ? `${type.charAt(0).toUpperCase()}${type.slice(1)}` : 'Other'),
      memories: memories.filter((memory) => memory.type === type),
    }));
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
