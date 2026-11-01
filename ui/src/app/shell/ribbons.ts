import { Component, computed, inject } from '@angular/core';
import { Icon, type IconName } from '../../design-system/icon';
import { type ChapterStatus, type OpenChapter, OpenChapters } from './open-chapters';
import { Ribbon, type RibbonTone } from './ribbon';
import { ShellRegistry } from './shell-registry';
import { ShortcutPipe } from './shortcut';

const STATUS_TEXT: Record<ChapterStatus, string> = {
  writing: 'writing',
  thinking: 'thinking',
  waiting: 'waiting for you',
  idle: 'idle',
  blank: 'blank page',
};

const TONE: Record<ChapterStatus, RibbonTone> = {
  writing: 'open',
  blank: 'open',
  thinking: 'thinking',
  waiting: 'waiting',
  idle: 'idle',
};

const ICON: Record<ChapterStatus, IconName> = {
  writing: 'quill',
  blank: 'page',
  thinking: 'circle',
  waiting: 'bell',
  idle: 'moon',
};

// The class that animates the icon, see ribbons.css.
const MOTION: Partial<Record<ChapterStatus, string>> = {
  writing: 'quill',
  thinking: 'spin',
  waiting: 'breathe',
};

/**
 * The open chapters as ribbons on the desk. Left of the spine: the open
 * chapter nearest the spine, then the others that are busy. Right of it:
 * the idle ones, the approvals awaiting your seal, and New chapter.
 */
@Component({
  selector: 'gr-ribbons',
  imports: [Icon, Ribbon, ShortcutPipe],
  templateUrl: './ribbons.html',
  styleUrl: './ribbons.css',
  host: { role: 'navigation', 'aria-label': 'Open chapters' },
})
export class Ribbons {
  protected readonly chapters = inject(OpenChapters);
  private readonly registry = inject(ShellRegistry);

  protected readonly left = computed(() => {
    const current = this.chapters.currentId();
    const all = this.chapters.all();
    return [
      ...all.filter((c) => c.id === current),
      ...all.filter((c) => c.id !== current && c.status !== 'idle'),
    ];
  });

  protected readonly right = computed(() => {
    const current = this.chapters.currentId();
    return this.chapters.all().filter((c) => c.id !== current && c.status === 'idle');
  });

  protected readonly awaitingSeal = computed(() =>
    this.chapters.all().filter((c) => c.approvals > 0),
  );
  protected readonly sealMeta = computed(() =>
    this.awaitingSeal()
      .map((c) => c.title)
      .join(', '),
  );
  protected readonly seals = computed(() =>
    this.awaitingSeal().reduce((sum, c) => sum + c.approvals, 0),
  );

  protected readonly newChapter = computed(() => this.registry.commands.get('chapters.new'));

  protected tone(chapter: OpenChapter): RibbonTone {
    return TONE[chapter.status];
  }

  protected icon(chapter: OpenChapter): IconName {
    return ICON[chapter.status];
  }

  protected motion(chapter: OpenChapter): string {
    return MOTION[chapter.status] ?? '';
  }

  protected meta(chapter: OpenChapter): string {
    return `${chapter.agent} · ${STATUS_TEXT[chapter.status]}`;
  }

  protected sealLabel(): string {
    const count = this.seals();
    const titles = this.awaitingSeal().map((c) => c.title);
    const from =
      titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}` : titles[0];
    return `${count} ${count === 1 ? 'approval' : 'approvals'} awaiting your seal, from ${from}`;
  }
}
