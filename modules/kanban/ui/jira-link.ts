import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import type { Card } from '@grimoire/contract';
import type { Chat } from '@ui/app/core/chat';
import { Settings } from '@ui/app/core/settings';
import { Wording } from '@ui/app/core/wording';
import { Board } from './board';
import { IssueForm } from './issue-form';

/**
 * After a chat's title, while Jira is on and the chat has no Jira issue,
 * a faint mark saying so, or that the agent proposed one: a click opens
 * a card that links the chat to one of the board's Jira issues, or
 * creates one, the proposal written in. A chat linked to one bears its
 * issue's badge instead (kanban.providers.ts). Esc or a click elsewhere
 * closes it.
 */
@Component({
  selector: 'gr-jira-link',
  imports: [IssueForm],
  templateUrl: './jira-link.html',
  styleUrl: './jira-link.css',
  host: {
    '(document:pointerdown)': 'pointerDown($event)',
    '(keydown.escape)': 'escape($event)',
  },
})
export class JiraLink {
  private readonly board = inject(Board);
  private readonly settings = inject(Settings);
  protected readonly wording = inject(Wording);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly toggle = viewChild<ElementRef<HTMLButtonElement>>('toggle');
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');

  readonly chat = input.required<Chat>();

  /** Whether the mark shows: Jira on, a chat begun, and no Jira issue of its own. */
  protected readonly shown = computed(() => {
    const chat = this.chat();
    return this.settings.all().jira && chat.status !== 'blank' && !this.board.cardOf(chat.id)?.jira;
  });
  /** Why Jira can't be reached, when the board's last sync says so. */
  protected readonly unreached = computed(() => {
    const jira = this.board.jira();
    switch (jira?.status ?? 'none') {
      case 'none':
        return 'No Atlassian connector reached yet. Connect Atlassian among your connectors on claude.ai, then sync the Kanban board.';
      case 'needs-auth':
        return 'The Atlassian connector needs connecting again on claude.ai.';
      case 'failed':
        return `Jira couldn’t be reached: ${jira?.error ?? 'it said no more'}`;
      default:
        return null;
    }
  });
  /** The Jira issue the agent proposed for the chat, if any. */
  protected readonly proposal = computed(() => this.board.proposals()[this.chat().id]);
  protected readonly label = computed(() =>
    this.proposal()
      ? `Proposed Jira issue: ${this.proposal()!.summary}`
      : this.wording.say('This chapter has no Jira issue', 'This chat has no Jira issue'),
  );
  /** The board's Jira issues, to link the chat to. */
  protected readonly issues = computed(() =>
    this.board.open().filter((card) => card.kind === 'jira'),
  );

  /** Whether the card is open; never on a chat you've just turned to. */
  protected readonly open = linkedSignal({
    source: () => this.chat().id,
    computation: () => false,
  });
  /** Whether the card shows the issue written out to create, rather than the board's to link. */
  protected readonly writing = linkedSignal({
    source: () => this.chat().id,
    computation: () => false,
  });
  /** How far left the card moves so it ends within the page header. */
  protected readonly shift = signal(0);

  constructor() {
    afterRenderEffect(() => {
      this.issues();
      this.writing();
      const card = this.card()?.nativeElement;
      if (!card) return;
      const end = (this.host.closest('gr-page-header') ?? document.body).getBoundingClientRect();
      const start = this.host.getBoundingClientRect().left;
      this.shift.set(Math.min(0, end.right - start - card.offsetWidth));
    });
  }

  /** Opens the card on the proposal, written out, when there's one; or closes it. */
  protected toggleCard(): void {
    if (this.open()) return this.open.set(false);
    this.writing.set(!!this.proposal());
    this.open.set(true);
  }

  protected async link(card: Card): Promise<void> {
    if (!(await this.board.link(card.id, this.chat()))) return;
    this.open.set(false);
    if (this.proposal()) await this.board.dismissProposal(this.chat().id);
  }

  protected async dismiss(): Promise<void> {
    await this.board.dismissProposal(this.chat().id);
    this.close();
  }

  /** Closes the card, focus back on the mark. */
  protected close(): void {
    this.open.set(false);
    this.toggle()?.nativeElement.focus();
  }

  protected pointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (this.open() && target && !this.host.contains(target)) this.open.set(false);
  }

  /** Esc closes the card, and isn't also the chat page's Esc, which stops the chat. */
  protected escape(event: Event): void {
    if (!this.open() || event.defaultPrevented) return;
    event.preventDefault();
    this.close();
  }
}
