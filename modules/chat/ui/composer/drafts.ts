import { Injectable } from '@angular/core';
import type { Attachment } from '@grimoire/contract';

/** What's written on a chat's next page, and what goes with it, not yet sent. */
export interface Draft {
  text: string;
  attachments: readonly Attachment[];
}

const BLANK: Draft = { text: '', attachments: [] };

/** Each chat's unsent entry, kept while you turn to other chats. */
@Injectable({ providedIn: 'root' })
export class Drafts {
  private readonly kept = new Map<string, Draft>();

  of(chatId: string): Draft {
    return this.kept.get(chatId) ?? BLANK;
  }

  keep(chatId: string, draft: Draft): void {
    if (draft.text || draft.attachments.length) this.kept.set(chatId, draft);
    else this.kept.delete(chatId);
  }
}
