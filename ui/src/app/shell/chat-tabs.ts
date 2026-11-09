import { Component, computed, inject } from '@angular/core';
import { Icon, type IconName } from '../../design-system/icon';
import { type Chat, Chats } from '../core/chats';
import { Wording } from '../core/wording';
import { RightPageState } from './right-page-state';
import { ChatTab, type ChatTabTone } from './chat-tab';
import { ShellRegistry } from './shell-registry';
import { ShortcutPipe } from './shortcut';

const STATUS_TEXT: Record<Chat['status'], string> = {
  writing: 'writing',
  thinking: 'thinking',
  waiting: 'waiting for you',
  idle: 'idle',
  blank: 'blank page',
};

const TONE: Record<Chat['status'], ChatTabTone> = {
  writing: 'open',
  blank: 'open',
  thinking: 'thinking',
  waiting: 'waiting',
  idle: 'idle',
};

const ICON: Record<Chat['status'], IconName> = {
  writing: 'quill',
  blank: 'page',
  thinking: 'circle',
  waiting: 'bell',
  idle: 'moon',
};

// The class that animates the icon, see chat-tabs.css.
const MOTION: Partial<Record<Chat['status'], string>> = {
  writing: 'quill',
  thinking: 'spin',
  waiting: 'breathe',
};

/**
 * The open chats as chat tabs hanging from the book's foot, in the order
 * they were opened, like pages. The book lies open at the current chat:
 * its chat tab hangs in the spine, the chats before it on the left, those
 * after it on the right, followed by the waiting approvals and
 * New chat. A chat tab shows its title when you point at it.
 */
@Component({
  selector: 'gr-chat-tabs',
  imports: [Icon, ChatTab, ShortcutPipe],
  templateUrl: './chat-tabs.html',
  styleUrl: './chat-tabs.css',
  host: { role: 'navigation', '[attr.aria-label]': "wording.say('Open chapters', 'Open chats')" },
})
export class ChatTabs {
  protected readonly chats = inject(Chats);
  protected readonly rightPage = inject(RightPageState);
  private readonly registry = inject(ShellRegistry);

  /** Where the book lies open: the current chat's place, or past the last one. */
  private readonly openAt = computed(() => {
    const all = this.chats.all();
    const at = all.findIndex((c) => c.id === this.chats.currentId());
    return at === -1 ? all.length : at;
  });

  protected readonly left = computed(() => this.chats.all().slice(0, this.openAt()));
  protected readonly current = computed(() => this.chats.all().at(this.openAt()));
  protected readonly right = computed(() => this.chats.all().slice(this.openAt() + 1));

  // Questions wait for answers, not for an approval.
  private readonly approvalsOf = (chat: Chat) =>
    chat.approvals.filter((approval) => !approval.questions).length;
  protected readonly awaitingApproval = computed(() =>
    this.chats.all().filter((c) => this.approvalsOf(c) > 0),
  );
  protected readonly approvalMeta = computed(() =>
    this.awaitingApproval()
      .map((c) => this.title(c))
      .join(', '),
  );
  protected readonly approvals = computed(() =>
    this.awaitingApproval().reduce((sum, c) => sum + this.approvalsOf(c), 0),
  );

  protected readonly wording = inject(Wording);

  protected readonly newChat = computed(() => this.registry.commands.get('chats.new'));
  protected readonly newChatLabel = computed(() => {
    const command = this.newChat();
    return command ? this.wording.label(command) : this.wording.say('New chapter', 'New chat');
  });

  protected title(chat: Chat): string {
    return chat.title || this.wording.untitled();
  }

  protected tone(chat: Chat): ChatTabTone {
    return TONE[chat.status];
  }

  protected icon(chat: Chat): IconName {
    return ICON[chat.status];
  }

  protected motion(chat: Chat): string {
    return MOTION[chat.status] ?? '';
  }

  protected meta(chat: Chat): string {
    const status =
      chat.status === 'blank'
        ? this.wording.say('blank page', 'new chat')
        : STATUS_TEXT[chat.status];
    const beside =
      chat.id === this.chats.besideId()
        ? this.wording.say(' · on the facing page', ' · on the right page')
        : '';
    return `${this.chats.agentName(chat.agent)} · ${status}${beside}`;
  }

  protected approvalLabel(): string {
    const count = this.approvals();
    const titles = this.awaitingApproval().map((c) => this.title(c));
    const from =
      titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}` : titles[0];
    const approvals = `${count} ${count === 1 ? 'approval' : 'approvals'}`;
    return this.wording.say(
      `${approvals} awaiting your seal, from ${from}`,
      `${approvals} waiting, from ${from}`,
    );
  }
}
