import { Component, computed, inject } from '@angular/core';
import { Icon, type IconName } from '../../design-system/icon';
import { type Chapter, Chats } from '../core/chats';
import { Wording } from '../core/wording';
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
 * The open chapters as ribbons hanging from the book's foot, in the order
 * they were opened, like pages. The book lies open at the current chapter:
 * its ribbon hangs in the spine, the chapters before it on the left, those
 * after it on the right, followed by the approvals awaiting your seal and
 * New chapter. A ribbon shows its title when you point at it.
 */
@Component({
  selector: 'gr-ribbons',
  imports: [Icon, Ribbon, ShortcutPipe],
  templateUrl: './ribbons.html',
  styleUrl: './ribbons.css',
  host: { role: 'navigation', '[attr.aria-label]': "wording.say('Open chapters', 'Open chats')" },
})
export class Ribbons {
  protected readonly chapters = inject(Chats);
  protected readonly facing = inject(Facing);
  private readonly registry = inject(ShellRegistry);

  /** Where the book lies open: the current chapter's place, or past the last one. */
  private readonly openAt = computed(() => {
    const all = this.chapters.all();
    const at = all.findIndex((c) => c.id === this.chapters.currentId());
    return at === -1 ? all.length : at;
  });

  protected readonly left = computed(() => this.chapters.all().slice(0, this.openAt()));
  protected readonly current = computed(() => this.chapters.all().at(this.openAt()));
  protected readonly right = computed(() => this.chapters.all().slice(this.openAt() + 1));

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

  protected readonly wording = inject(Wording);

  protected readonly newChapter = computed(() => this.registry.commands.get('chapters.new'));
  protected readonly newChapterLabel = computed(() => {
    const command = this.newChapter();
    return command ? this.wording.label(command) : this.wording.say('New chapter', 'New chat');
  });

  protected title(chapter: Chapter): string {
    return chapter.title || this.wording.untitled();
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
    const status =
      chapter.status === 'blank'
        ? this.wording.say('blank page', 'new chat')
        : STATUS_TEXT[chapter.status];
    return `${this.chapters.agentName(chapter.agent)} · ${status}`;
  }

  protected sealLabel(): string {
    const count = this.seals();
    const titles = this.awaitingSeal().map((c) => this.title(c));
    const from =
      titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}` : titles[0];
    const approvals = `${count} ${count === 1 ? 'approval' : 'approvals'}`;
    return this.wording.say(
      `${approvals} awaiting your seal, from ${from}`,
      `${approvals} waiting, from ${from}`,
    );
  }
}
