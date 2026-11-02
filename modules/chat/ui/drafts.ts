import { Injectable } from '@angular/core';
import type { Enclosure } from '@grimoire/contract';

/** What's written on a chapter's next page, and what goes with it, not yet sent. */
export interface Draft {
  text: string;
  enclosures: readonly Enclosure[];
}

const BLANK: Draft = { text: '', enclosures: [] };

/** Each chapter's unsent entry, kept while you turn to other chapters. */
@Injectable({ providedIn: 'root' })
export class Drafts {
  private readonly kept = new Map<string, Draft>();

  of(chapterId: string): Draft {
    return this.kept.get(chapterId) ?? BLANK;
  }

  keep(chapterId: string, draft: Draft): void {
    if (draft.text || draft.enclosures.length) this.kept.set(chapterId, draft);
    else this.kept.delete(chapterId);
  }
}
