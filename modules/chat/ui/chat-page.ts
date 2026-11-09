import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  computed,
  inject,
  input,
  linkedSignal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { Icon } from '@ui/design-system/icon';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats, type Setting } from '@ui/app/core/chats';
import { POPOUT } from '@ui/app/core/popout';
import { effortName } from '@ui/app/core/efforts';
import { modeName } from '@ui/app/core/modes';
import { Presets } from '@ui/app/core/presets';
import { Wording } from '@ui/app/core/wording';
import { AgentCommands } from '@ui/app/shell/agent-commands';
import { SlashCommands } from '@ui/app/shell/slash-commands';
import { RightPageState } from '@ui/app/shell/right-page-state';
import { RightPageTabs } from '@ui/app/shell/right-page-tabs';
import { Focus } from '@ui/app/shell/focus';
import { PageFooter } from '@ui/app/shell/page-footer';
import { HeaderBadges } from '@ui/app/shell/header-badges';
import { PageHeader } from '@ui/app/shell/page-header';
import { StatusIndicators } from '@ui/app/shell/status-indicators';
import { ChatIntro } from './chat-intro';
import { ChatTags } from './chat-tags';
import { Composer } from './composer';
import { Pins } from './pins';
import { FollowUps } from './follow-ups';
import { SettingsCard } from './settings-card';
import { Transcript } from './transcript';

/** The right page's own page that shows a second chat. */
export const SECOND_CHAT = 'second-chat';

/**
 * The open chat on the left page: its page header with the chat's
 * settings, the transcript (or a blank chat's opening page) with any
 * separate tasks the agent offered under its last reply, the next page to
 * write on, and the page footer. The settings in the page header
 * open the chat's settings card. While another chat edits
 * its project, the page header says it only reads, and offers to make
 * it the editing chat (ADR-011). Esc closes the card, or else denies the
 * approval waiting for you, or else stops the running turn and puts the
 * queued messages back on the next page. While the right page shows the
 * approval cards, Esc is theirs. The pen beside the title rewrites it in place, for
 * agents that can rename their chats.
 *
 * On the right page, beside the chat you're on, it shows another one:
 * the right page's tabs head it, and its settings, without the title's
 * pen, tags or pins. Esc is the page's you're working in.
 *
 * Pop out puts a chat that has begun in a window of its own, a
 * popout; there, Back in the book puts it back. A popout has no right page,
 * so the agent's commands are listed on its own page, above the entry.
 */
@Component({
  selector: 'gr-chat-page',
  imports: [
    ChatIntro,
    ChatTags,
    SlashCommands,
    Composer,
    Pins,
    RightPageTabs,
    FollowUps,
    Icon,
    HeaderBadges,
    PageFooter,
    PageHeader,
    SettingsCard,
    StatusIndicators,
    Transcript,
  ],
  templateUrl: './chat-page.html',
  styleUrl: './chat-page.css',
  host: {
    '(document:keydown.escape)': 'escape($event)',
    '(dragover)': 'dragOver($event)',
    '(drop)': 'composer()?.drop($event)',
  },
})
export class ChatPage {
  protected readonly chats = inject(Chats);
  private readonly rightPage = inject(RightPageState);
  private readonly presets = inject(Presets);
  protected readonly wording = inject(Wording);
  protected readonly focus = inject(Focus);
  private readonly commands = inject(AgentCommands);
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** In a popout's window, popped out of the book. */
  protected readonly popout = !!inject(POPOUT);

  /** The chat it shows; the one you're on when unset. */
  readonly chatId = input<string>();
  /** On the right page, beside the chat you're on. */
  readonly beside = input(false, { transform: booleanAttribute });
  protected readonly secondChat = SECOND_CHAT;
  protected readonly chat = computed(() => {
    const id = this.chatId();
    return id === undefined ? this.chats.current() : this.chats.all().find((c) => c.id === id);
  });
  protected readonly composer = viewChild(Composer);
  /** Whether a popout's page lists the agent's commands, searched from its composer. */
  protected readonly searchingCommands = computed(
    () => this.popout && this.commands.search()?.chatId === this.chat()?.id,
  );
  private readonly running = computed(() =>
    ['thinking', 'writing', 'waiting'].includes(this.chat()?.status ?? ''),
  );
  private readonly settingButtons = viewChildren('setting', { read: ElementRef });
  private readonly injector = inject(Injector);
  private readonly titleField = viewChild<ElementRef<HTMLInputElement>>('titleField');
  private readonly renameButton = viewChild<ElementRef<HTMLButtonElement>>('renameButton');

  /** Whether the title is being rewritten; never on a chat you've just turned to. */
  protected readonly renaming = linkedSignal({
    source: () => this.chat()?.id,
    computation: () => false,
  });
  protected readonly canRename = computed(() => this.chats.can(this.chat()?.agent, 'rename'));

  constructor() {
    afterRenderEffect(() => {
      const field = this.titleField()?.nativeElement;
      if (!field) return;
      field.focus();
      field.select();
    });
  }

  /** Puts a popout back in the book: its window closes, and the book turns to it. */
  protected backInMainWindow(): void {
    this.bridge.window.close();
  }

  /** Keeps the rewritten title, or not; Enter and Esc hand the focus back to the pen. */
  protected finishRenaming(field: HTMLInputElement, keep: boolean, refocus: boolean): void {
    if (!this.renaming()) return;
    this.renaming.set(false);
    const chat = this.chat();
    if (keep && chat) void this.chats.rename(chat.id, field.value);
    if (refocus)
      afterNextRender(() => this.renameButton()?.nativeElement.focus(), { injector: this.injector });
  }

  /** The chat's settings, as the page header lists them. */
  protected readonly settings = computed(() => {
    const chat = this.chat();
    if (!chat) return [];
    const { agent, settings } = chat;
    const begun = chat.status !== 'blank';
    const effort = this.chats.effortOf(agent, settings);
    // Auto picks the effort with the model, at the first entry.
    const effortShown = effort.levels.length > 0 && (begun || !settings.autoModel);
    return [
      { key: 'agent', label: this.chats.agentName(agent) },
      { key: 'model', label: this.chats.modelLabel(agent, settings, begun) },
      // Only for a model that takes effort levels.
      ...(effortShown ? [{ key: 'effort' as const, label: effortName(effort.level) }] : []),
      { key: 'mode', label: modeName(settings.mode) },
      { key: 'folder', label: this.chats.folderName(settings.cwd) },
      { key: 'preset', label: this.presets.of(chat)?.name ?? 'No preset' },
    ] satisfies { key: Setting; label: string }[];
  });

  /** What you wrote in this chat, oldest first, for Up to bring back. */
  protected readonly sent = computed(() =>
    (this.chat()?.entries ?? []).flatMap((entry) =>
      entry.kind === 'user' && entry.text.trim() ? [entry.text] : [],
    ),
  );

  /** The settings card, while it's open on this chat. */
  protected readonly card = computed(() => {
    const card = this.chats.settingsCard();
    return card && card.id === this.chat()?.id ? card : null;
  });

  protected anchorFor(setting: Setting): HTMLElement | undefined {
    return this.settingButtons()
      .map((button) => button.nativeElement as HTMLElement)
      .find((button) => button.dataset['setting'] === setting);
  }

  protected toggle(setting: Setting): void {
    const chat = this.chat();
    if (!chat) return;
    if (this.card()?.on === setting) this.chats.closeSettings();
    else this.chats.openSettings(chat.id, setting);
  }

  /** Files can be dropped anywhere on the page; they go with the next entry. */
  protected dragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  /**
   * Esc on the page you're working in: the one it was pressed in, or the
   * left page when it was pressed on neither.
   */
  protected escape(event: Event): void {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    const page = target?.closest('gr-chat-page');
    if (page ? page !== this.host : this.beside()) return;
    const card = this.card();
    if (card) {
      event.preventDefault();
      this.chats.closeSettings();
      return this.anchorFor(card.on)?.focus();
    }
    if (!this.rightPage.turned()) this.stop();
  }

  protected stop(): void {
    const chat = this.chat();
    if (!chat) return;
    const pending = chat.approvals.find((approval) => !approval.questions);
    if (pending) void this.chats.decide(chat.id, pending.id, 'deny');
    else if (this.running())
      void this.chats.interrupt(chat.id).then((withdrawn) => {
        if (this.chat()?.id === chat.id)
          this.composer()?.takeBack(withdrawn);
      });
  }
}
