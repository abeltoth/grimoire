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

/**
 * After a chat's title, while Jira is on and the chat has no Jira issue,
 * a faint mark saying so: a click opens a card that links the chat to
 * one of the board's Jira issues. A chat linked to one bears its issue's
 * badge instead (kanban.providers.ts). Esc or a click elsewhere closes it.
 */
@Component({
  selector: 'gr-jira-link',
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

  /** Whether the mark shows: Jira on, an Atlassian connector reached, a chat begun, and no Jira issue of its own. */
  protected readonly shown = computed(() => {
    const status = this.board.jira()?.status ?? 'none';
    const chat = this.chat();
    return (
      this.settings.all().jira &&
      status !== 'none' &&
      chat.status !== 'blank' &&
      !this.board.cardOf(chat.id)?.jira
    );
  });
  /** The board's Jira issues, to link the chat to. */
  protected readonly issues = computed(() =>
    this.board.open().filter((card) => card.kind === 'jira'),
  );

  /** Whether the card is open; never on a chat you've just turned to. */
  protected readonly open = linkedSignal({
    source: () => this.chat().id,
    computation: () => false,
  });
  /** How far left the card moves so it ends within the page header. */
  protected readonly shift = signal(0);

  constructor() {
    afterRenderEffect(() => {
      this.issues();
      const card = this.card()?.nativeElement;
      if (!card) return;
      const end = (this.host.closest('gr-page-header') ?? document.body).getBoundingClientRect();
      const start = this.host.getBoundingClientRect().left;
      this.shift.set(Math.min(0, end.right - start - card.offsetWidth));
    });
  }

  protected async link(card: Card): Promise<void> {
    if (await this.board.link(card.id, this.chat())) this.open.set(false);
  }

  protected pointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (this.open() && target && !this.host.contains(target)) this.open.set(false);
  }

  /** Esc closes the card, and isn't also the chat page's Esc, which stops the chat. */
  protected escape(event: Event): void {
    if (!this.open() || event.defaultPrevented) return;
    event.preventDefault();
    this.open.set(false);
    this.toggle()?.nativeElement.focus();
  }
}
