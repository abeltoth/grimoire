import { Component, computed, inject } from '@angular/core';
import { Icon, type IconName } from '../../design-system/icon';
import { type Chapter, Chats } from '../core/chats';
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
  protected readonly chapters = inject(Chats);
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
