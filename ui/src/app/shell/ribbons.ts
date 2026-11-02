import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Icon, type IconName } from '../../design-system/icon';
import { type Chapter, Chats } from '../core/chats';
import { Facing } from './facing';
import { Ribbon, type RibbonTone } from './ribbon';
import { ShellRegistry } from './shell-registry';
import { ShortcutPipe } from './shortcut';

const STATUS_TEXT: Record<Chapter['status'], string> = {
  writing: 'writing',
  thinking: 'thinking',
  waiting: 'waiting for you',
  idle: 'idle',
  blank: 'blank page',
};

const TONE: Record<Chapter['status'], RibbonTone> = {
  writing: 'open',
  blank: 'open',
  thinking: 'thinking',
  waiting: 'waiting',
  idle: 'idle',
};

const ICON: Record<Chapter['status'], IconName> = {
  writing: 'quill',
  blank: 'page',
  thinking: 'circle',
  waiting: 'bell',
  idle: 'moon',
};

// The class that animates the icon, see ribbons.css.
const MOTION: Partial<Record<Chapter['status'], string>> = {
  writing: 'quill',
  thinking: 'spin',
  waiting: 'breathe',
};

/**
 * The open chapters as ribbons on the desk, in the order they were opened:
 * left of the spine as many as fit there, then on right of it, followed by
 * the approvals awaiting your seal and New chapter. Turning to a chapter
 * only lights its ribbon; none of them move.
 */
@Component({
  selector: 'gr-ribbons',
  imports: [Icon, Ribbon, ShortcutPipe],
  templateUrl: './ribbons.html',
  styleUrl: './ribbons.css',
  host: { role: 'navigation', 'aria-label': 'Open chapters' },
})
export class Ribbons {
  protected readonly chapters = inject(Chats);
  protected readonly facing = inject(Facing);
  private readonly registry = inject(ShellRegistry);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly leftHalf = viewChild.required<ElementRef<HTMLElement>>('leftHalf');

  /** How many ribbons fit left of the spine; all of them until measured. */
  private readonly leftRoom = signal(Number.POSITIVE_INFINITY);
  /** The width left of the spine, kept up to date as the window changes. */
  private readonly leftWidth = signal(0);

  protected readonly left = computed(() => this.chapters.all().slice(0, this.leftRoom()));
  protected readonly right = computed(() => this.chapters.all().slice(this.leftRoom()));

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const half = this.leftHalf().nativeElement;
      const observer = new ResizeObserver(() => this.leftWidth.set(half.clientWidth));
      observer.observe(half);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    // Ribbons are as wide as their titles, so what fits is measured once they're drawn.
    afterRenderEffect(() => {
      this.chapters.all();
      const width = this.leftWidth();
      if (!width) return;
      const half = this.leftHalf().nativeElement;
      const gap = parseFloat(getComputedStyle(half).columnGap) || 0;
      const ribbons = [...this.host.nativeElement.querySelectorAll<HTMLElement>('gr-ribbon.chapter')];
      let used = 0;
      let fit = 0;
      for (const ribbon of ribbons) {
        used += (fit ? gap : 0) + ribbon.getBoundingClientRect().width;
        if (used > width) break;
        fit++;
      }
      this.leftRoom.set(fit === ribbons.length ? Number.POSITIVE_INFINITY : fit);
    });
  }

  // Questions wait for answers, not for a seal.
  private readonly sealsOf = (chapter: Chapter) =>
    chapter.approvals.filter((approval) => !approval.questions).length;
  protected readonly awaitingSeal = computed(() =>
    this.chapters.all().filter((c) => this.sealsOf(c) > 0),
  );
  protected readonly sealMeta = computed(() =>
    this.awaitingSeal()
      .map((c) => this.title(c))
      .join(', '),
  );
  protected readonly seals = computed(() =>
    this.awaitingSeal().reduce((sum, c) => sum + this.sealsOf(c), 0),
  );

  protected readonly newChapter = computed(() => this.registry.commands.get('chapters.new'));

  protected title(chapter: Chapter): string {
    return chapter.title || 'Untitled chapter';
  }

  protected tone(chapter: Chapter): RibbonTone {
    return TONE[chapter.status];
  }

  protected icon(chapter: Chapter): IconName {
    return ICON[chapter.status];
  }

  protected motion(chapter: Chapter): string {
    return MOTION[chapter.status] ?? '';
  }

  protected meta(chapter: Chapter): string {
    return `${this.chapters.agentName(chapter.agent)} · ${STATUS_TEXT[chapter.status]}`;
  }

  protected sealLabel(): string {
    const count = this.seals();
    const titles = this.awaitingSeal().map((c) => this.title(c));
    const from =
      titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}` : titles[0];
    return `${count} ${count === 1 ? 'approval' : 'approvals'} awaiting your seal, from ${from}`;
  }
}
