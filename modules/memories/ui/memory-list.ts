import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { AgentInfo, AgentMemories, Memory } from '@grimoire/contract';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { Wording } from '@ui/app/core/wording';
import { type Line, columns, curve, missing, resolve } from './memory-map';

/** An agent that keeps memories, and those it keeps for the folder. */
export interface Kept {
  agent: AgentInfo;
  memories: AgentMemories;
}

/**
 * The memories one agent keeps for the folder, as cards in columns by kind
 * with their [[links]] drawn between them; where else it keeps some; and
 * what's wrong with them.
 */
@Component({
  selector: 'gr-memory-list',
  templateUrl: './memory-list.html',
  styleUrls: ['./memory-asides.css', './memory-list.css'],
})
export class MemoryList {
  protected readonly catalog = inject(AgentCatalog);
  protected readonly wording = inject(Wording);
  private readonly injector = inject(Injector);

  readonly kept = input.required<Kept>();
  /** The memory you're pointing at, whose links stand out; the page keeps it while a memory is open. */
  readonly pointed = model<string | null>(null);
  /** A memory to open, with its kind as its column is titled. */
  readonly opened = output<{ memory: Memory; kind: string }>();
  /** Another folder to show the memories of. */
  readonly show = output<string>();

  protected readonly lines = signal<Line[]>([]);
  private readonly map = viewChild<ElementRef<HTMLElement>>('map');

  protected readonly columns = columns;
  protected readonly missing = missing;

  constructor() {
    // Drawn once the cards lie where they will, each time the memories are read.
    effect(() => {
      this.kept();
      untracked(() => afterNextRender(() => this.measure(), { injector: this.injector }));
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

  protected date(at: number): string {
    return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /** Draws each link from its card to the card it names, as the cards now lie. */
  private measure(): void {
    const map = this.map()?.nativeElement;
    const memories = this.kept().memories.memories;
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
