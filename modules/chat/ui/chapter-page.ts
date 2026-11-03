import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  linkedSignal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { Icon } from '@ui/design-system/icon';
import { Chats, type Setting } from '@ui/app/core/chats';
import { modeName } from '@ui/app/core/modes';
import { Presets } from '@ui/app/core/presets';
import { Facing } from '@ui/app/shell/facing';
import { RunningFoot } from '@ui/app/shell/running-foot';
import { ReviewStamps } from '@ui/app/shell/review-stamps';
import { RunningHead } from '@ui/app/shell/running-head';
import { StatusIndicators } from '@ui/app/shell/status-indicators';
import { ChapterOpening } from './chapter-opening';
import { ChapterTags } from './chapter-tags';
import { Composer } from './composer';
import { DogEars } from './dog-ears';
import { SettingsCard } from './settings-card';
import { Transcript } from './transcript';

/**
 * The open chapter on the left page: its running head with the chat's
 * settings, the transcript (or a blank chapter's opening page), the next
 * page to write on, and the running foot. The settings in the running head
 * open the chapter's settings card. Esc closes the card, or else denies the
 * approval awaiting your seal, or else stops the running turn and puts the
 * queued messages back on the next page. While the facing page shows the
 * slips, Esc is theirs. The pen beside the title rewrites it in place, for
 * agents that can rename their chats.
 */
@Component({
  selector: 'gr-chapter-page',
  imports: [
    ChapterOpening,
    ChapterTags,
    Composer,
    DogEars,
    Icon,
    ReviewStamps,
    RunningFoot,
    RunningHead,
    SettingsCard,
    StatusIndicators,
    Transcript,
  ],
  templateUrl: './chapter-page.html',
  styleUrl: './chapter-page.css',
  host: {
    '(document:keydown.escape)': 'escape($event)',
    '(dragover)': 'dragOver($event)',
    '(drop)': 'composer()?.drop($event)',
  },
})
export class ChapterPage {
  protected readonly chats = inject(Chats);
  private readonly facing = inject(Facing);
  private readonly presets = inject(Presets);
  protected readonly chapter = this.chats.current;
  protected readonly composer = viewChild(Composer);
  private readonly running = computed(() =>
    ['thinking', 'writing', 'waiting'].includes(this.chapter()?.status ?? ''),
  );
  private readonly settingButtons = viewChildren('setting', { read: ElementRef });
  private readonly injector = inject(Injector);
  private readonly titleField = viewChild<ElementRef<HTMLInputElement>>('titleField');
  private readonly renameButton = viewChild<ElementRef<HTMLButtonElement>>('renameButton');

  /** Whether the title is being rewritten; never on a chapter you've just turned to. */
  protected readonly renaming = linkedSignal({
    source: () => this.chapter()?.id,
    computation: () => false,
  });
  protected readonly canRename = computed(() => this.chats.can(this.chapter()?.agent, 'rename'));

  constructor() {
    afterRenderEffect(() => {
      const field = this.titleField()?.nativeElement;
      if (!field) return;
      field.focus();
      field.select();
    });
  }

  /** Keeps the rewritten title, or not; Enter and Esc hand the focus back to the pen. */
  protected finishRenaming(field: HTMLInputElement, keep: boolean, refocus: boolean): void {
    if (!this.renaming()) return;
    this.renaming.set(false);
    const chapter = this.chapter();
    if (keep && chapter) void this.chats.rename(chapter.id, field.value);
    if (refocus)
      afterNextRender(() => this.renameButton()?.nativeElement.focus(), { injector: this.injector });
  }

  /** The chapter's settings, as the running head lists them. */
  protected readonly settings = computed(() => {
    const chapter = this.chapter();
    if (!chapter) return [];
    const { agent, settings } = chapter;
    return [
      { key: 'agent', label: this.chats.agentName(agent) },
      { key: 'model', label: this.chats.modelName(agent, settings.model) },
      { key: 'mode', label: modeName(settings.mode) },
      {
        key: 'folder',
        label:
          this.chats.folderName(settings.cwd) +
          (settings.worktree && chapter.status === 'blank' ? ', own worktree' : ''),
      },
      { key: 'preset', label: this.presets.of(chapter)?.name ?? 'No preset' },
    ] satisfies { key: Setting; label: string }[];
  });

  /** The settings card, while it's open on this chapter. */
  protected readonly card = computed(() => {
    const card = this.chats.settingsCard();
    return card && card.id === this.chapter()?.id ? card : null;
  });

  protected anchorFor(setting: Setting): HTMLElement | undefined {
    return this.settingButtons()
      .map((button) => button.nativeElement as HTMLElement)
      .find((button) => button.dataset['setting'] === setting);
  }

  protected toggle(setting: Setting): void {
    const chapter = this.chapter();
    if (!chapter) return;
    if (this.card()?.on === setting) this.chats.closeSettings();
    else this.chats.openSettings(chapter.id, setting);
  }

  /** Files can be dropped anywhere on the page; they go with the next entry. */
  protected dragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  protected escape(event: Event): void {
    if (event.defaultPrevented) return;
    const card = this.card();
    if (card) {
      event.preventDefault();
      this.chats.closeSettings();
      return this.anchorFor(card.on)?.focus();
    }
    if (!this.facing.turned()) this.stop();
  }

  protected stop(): void {
    const chapter = this.chapter();
    if (!chapter) return;
    const seal = chapter.approvals.find((approval) => !approval.questions);
    if (seal) void this.chats.decide(chapter.id, seal.id, 'deny');
    else if (this.running())
      void this.chats.interrupt(chapter.id).then((withdrawn) => {
        if (this.chapter()?.id === chapter.id)
          this.composer()?.takeBack(withdrawn);
      });
  }
}
