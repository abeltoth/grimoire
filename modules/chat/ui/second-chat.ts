import { Component, computed, inject } from '@angular/core';
import { type Chat } from '@ui/app/core/chat';
import { ChatList } from '@ui/app/core/chat-list';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { Wording } from '@ui/app/core/wording';
import { RightPageTabs } from '@ui/app/shell/right-page-tabs';
import { PageFooter } from '@ui/app/shell/page-footer';
import { PageHeader } from '@ui/app/shell/page-header';
import { ChatPage, SECOND_CHAT } from './chat-page';

/**
 * The right page's Second chat: another open chat beside the one
 * you're on, as fully its own as the left page. Until you put one there,
 * it lists the open chats to pick from, and a new one.
 */
@Component({
  selector: 'gr-second-chat',
  imports: [ChatPage, RightPageTabs, PageFooter, PageHeader],
  templateUrl: './second-chat.html',
  styleUrl: './second-chat.css',
})
export class SecondChat {
  protected readonly list = inject(ChatList);
  protected readonly catalog = inject(AgentCatalog);
  protected readonly wording = inject(Wording);
  protected readonly page = SECOND_CHAT;

  /** The open chats that can go beside the one you're on. */
  protected readonly others = computed(() =>
    this.list.all().filter((chat) => chat.id !== this.list.currentId()),
  );

  protected title(chat: Chat): string {
    return chat.title || this.wording.untitled();
  }

  protected meta(chat: Chat): string {
    return `${this.catalog.agentName(chat.agent)} · ${this.catalog.folderName(chat.settings.cwd)}`;
  }
}
