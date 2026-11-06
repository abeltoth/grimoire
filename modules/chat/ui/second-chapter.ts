import { Component, computed, inject } from '@angular/core';
import { type Chapter, Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';
import { FacingTabs } from '@ui/app/shell/facing-tabs';
import { RunningFoot } from '@ui/app/shell/running-foot';
import { RunningHead } from '@ui/app/shell/running-head';
import { ChapterPage, SECOND_CHAPTER } from './chapter-page';

/**
 * The facing page's Second chapter: another open chapter beside the one
 * you're on, as fully its own as the left page. Until you put one there,
 * it lists the open chapters to pick from, and a new one.
 */
@Component({
  selector: 'gr-second-chapter',
  imports: [ChapterPage, FacingTabs, RunningFoot, RunningHead],
  templateUrl: './second-chapter.html',
  styleUrl: './second-chapter.css',
})
export class SecondChapter {
  protected readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  protected readonly page = SECOND_CHAPTER;

  /** The open chapters that can go beside the one you're on. */
  protected readonly others = computed(() =>
    this.chats.all().filter((chapter) => chapter.id !== this.chats.currentId()),
  );

  protected title(chapter: Chapter): string {
    return chapter.title || this.wording.untitled();
  }

  protected meta(chapter: Chapter): string {
    return `${this.chats.agentName(chapter.agent)} · ${this.chats.folderName(chapter.settings.cwd)}`;
  }
}
