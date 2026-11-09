import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { Card, CardChat, CardColumn, JiraTransition } from '@grimoire/contract';
import { type Chat, Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';
import { Icon, type IconName } from '@ui/design-system/icon';
import { Board, COLUMNS } from './board';
import { CardForm } from './card-form';

/** A chat's live status as a card shows it, with the chat tabs' icon and motion; "not open" when it's closed. */
const STATUS: Record<Chat['status'], { text: string; icon?: IconName; motion?: string }> = {
  writing: { text: 'writing', icon: 'quill', motion: 'quill' },
  thinking: { text: 'thinking', icon: 'circle', motion: 'spin' },
  waiting: { text: 'waiting for you', icon: 'bell', motion: 'breathe' },
  idle: { text: 'idle', icon: 'moon' },
  blank: { text: 'blank page', icon: 'page' },
};

/** How long after a sync of your Jira issues opening the board doesn't sync them again. */
const JIRA_FRESH_MS = 60_000;

/** A chat begun from a card, as its card lists it. */
interface ListedChat {
  chat: CardChat;
  title: string;
  /** The live status, shown for the card's latest chat only. */
  status?: { text: string; icon?: IconName; motion?: string; tone: string };
}

/**
 * The Kanban board: your tasks as index cards in To do, In progress and
 * Done, each column in your order. Cards are dragged between and within
 * columns, or moved with a card's Move to. A card begins a new chat in its
 * folder, lists the chats it began with the latest one's live status, and
 * stays until you close it; one an agent added says so, and links back to
 * the chat it was added in; closed cards are kept, to open again. An empty
 * card at the foot of To do writes a new one. The board can show one
 * folder's cards only.
 *
 * Your Jira issues are cards too, after your own in each column, as Jira's
 * status categories place them: each with its key, type, priority and
 * status, an edge of its own, and a link to it in Jira. They belong to no
 * folder, so show whichever is picked, and their chats begin in it.
 * Opening the board syncs them, unless that was done a minute ago; it
 * says when they were synced, or why they couldn't be.
 *
 * A Jira card moves in Jira, dragged or with Move to, into another column
 * only: it goes there at once while Jira is asked which statuses there its
 * workflow allows. With one, it takes it; with several, you pick one; with
 * none, it goes back, saying so. Change status lists every status Jira
 * allows it, in its own column too. When Jira refuses, it goes back,
 * saying what Jira said, and offers to open it in Jira.
 */
@Component({
  selector: 'gr-kanban-page',
  imports: [CardForm, Icon],
  templateUrl: './kanban-page.html',
  styleUrl: './kanban-page.css',
})
export class KanbanPage {
  protected readonly board = inject(Board);
  protected readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  protected readonly columns = COLUMNS;

  /** The card written out to change, or 'new' for one being added. */
  protected readonly editing = signal<string | null>(null);
  /** The card whose Move to is open. */
  protected readonly moving = signal<string | null>(null);
  /**
   * The Jira card being moved in Jira: into a column, or to another status
   * with Change status; Jira is asked how, then its choices show, when
   * there's more than one to pick from.
   */
  protected readonly inJira = signal<{
    card: string;
    column?: CardColumn;
    choices?: JiraTransition[];
  } | null>(null);
  /** The card being dragged, and the column it's over. */
  protected readonly dragging = signal<string | null>(null);
  protected readonly over = signal<CardColumn | null>(null);
  /** The folder whose cards show; all when null. */
  private readonly picked = signal<string | null>(null);
  protected readonly showClosed = signal(false);
  /** The titles of chats that aren't open: as the agents list them, or as they were while open. */
  private readonly titles = signal<ReadonlyMap<string, string>>(new Map());

  /** The folders the cards on the board are in, in the order they first appear. */
  protected readonly folders = computed(() => [
    ...new Set(this.board.open().flatMap((card) => (card.cwd ? [card.cwd] : []))),
  ]);
  /** The folder whose cards show, while it has any. */
  protected readonly folder = computed(() => {
    const picked = this.picked();
    return picked && this.folders().includes(picked) ? picked : null;
  });
  private readonly shown = computed(() => {
    const folder = this.folder();
    return (this.board.all() ?? []).filter((card) => !folder || !card.cwd || card.cwd === folder);
  });
  /** Where the Jira issues stand, said once there's a connector, or issues from one. */
  protected readonly jira = computed(() => {
    const jira = this.board.jira();
    const any = (this.board.all() ?? []).some((card) => card.kind === 'jira');
    return jira && (jira.status !== 'none' || any) ? jira : undefined;
  });
  protected readonly byColumn = computed(() => {
    const open = this.shown().filter((card) => card.closedAt === undefined);
    return Object.fromEntries(
      COLUMNS.map(({ column }) => [column, open.filter((card) => card.column === column)]),
    ) as Record<CardColumn, Card[]>;
  });
  /** The closed cards, the last closed first. */
  protected readonly closed = computed(() =>
    this.shown()
      .filter((card) => card.closedAt !== undefined)
      .sort((a, b) => b.closedAt! - a.closedAt!),
  );

  constructor() {
    void this.board.load();
    void this.board.syncJira(JIRA_FRESH_MS);
    void this.loadTitles();
    // A chat closed while the board shows keeps the title it had.
    effect(() => {
      const named = this.chats.all().filter((chat) => chat.title && chat.status !== 'blank');
      if (!named.length) return;
      untracked(() =>
        this.titles.update(
          (titles) => new Map([...titles, ...named.map((c) => [c.id, c.title] as const)]),
        ),
      );
    });
  }

  protected pick(folder: string | null): void {
    this.picked.set(folder);
  }

  protected columnName(column: CardColumn): string {
    return COLUMNS.find((c) => c.column === column)!.label;
  }

  /** A chat's title: as it's open, or as the agents list it, or as it was while open. */
  protected titleOf(chatId: string): string {
    const chat = this.chats.all().find((c) => c.id === chatId);
    return chat?.title || this.titles().get(chatId) || this.wording.untitled();
  }

  /** Turns to the chat an agent added the card in, opening it again when it was closed. */
  protected openMadeIn(card: Card): void {
    if (card.madeIn) void this.board.openChat({ ...card.madeIn, at: card.createdAt });
  }

  /** The card's chats, oldest first, the latest with its live status. */
  protected chatsOf(card: Card): ListedChat[] {
    const open = this.chats.all();
    return card.chats.map((chat, i) => {
      const live = open.find((c) => c.id === chat.chatId);
      const title = this.titleOf(chat.chatId);
      if (i !== card.chats.length - 1) return { chat, title };
      const status = live ? STATUS[live.status] : { text: 'not open' };
      const text =
        live?.status === 'blank' ? this.wording.say('blank page', 'new chat') : status.text;
      return { chat, title, status: { ...status, text, tone: live?.status ?? 'closed' } };
    });
  }

  /** "In progress · ~/git/grimoire", or "In Review · GRIM-12" for a Jira card, for a closed card. */
  protected closedLine(card: Card): string {
    if (card.jira) return `${card.jira.status || this.columnName(card.column)} · ${card.jira.key}`;
    return `${this.columnName(card.column)} · ${this.chats.folderName(card.cwd)}`;
  }

  /** "synced at 10:42", or on another day "synced 3 Nov, 10:42". */
  protected synced(at: number): string {
    const when = new Date(at);
    const time = { hour: 'numeric', minute: '2-digit' } as const;
    return when.toDateString() === new Date().toDateString()
      ? `synced at ${when.toLocaleTimeString([], time)}`
      : `synced ${when.toLocaleString([], { day: 'numeric', month: 'short', ...time })}`;
  }

  /**
   * Where Move to can take a card: the other columns, and up or down its
   * own; a Jira card keeps Jira's order in its column.
   */
  protected movesOf(card: Card): { label: string; column: CardColumn; before?: string }[] {
    const column = this.byColumn()[card.column];
    const at = column.findIndex((c) => c.id === card.id);
    const moves: { label: string; column: CardColumn; before?: string }[] = COLUMNS.filter(
      (c) => c.column !== card.column,
    ).map((c) => ({ label: c.label, column: c.column }));
    if (card.kind === 'jira') return moves;
    if (at > 0) moves.push({ label: 'Up', column: card.column, before: column[at - 1]!.id });
    if (at !== -1 && at < column.length - 1) {
      moves.push({ label: 'Down', column: card.column, before: column[at + 2]?.id });
    }
    return moves;
  }

  protected openMoves(card: Card): void {
    this.moving.set(card.id);
    this.focusIn(card.id, '.moves button');
  }

  protected async move(card: Card, to: { column: CardColumn; before?: string }): Promise<void> {
    this.moving.set(null);
    if (card.kind === 'jira') return this.moveInJira(card, to.column);
    await this.board.move(card.id, to.column, to.before);
    this.focusIn(card.id, '.move');
  }

  /** Whether a Jira card is being moved in Jira: Jira's being asked, its choices show, or it's moving. */
  protected movingInJira(card: Card): boolean {
    return this.inJira()?.card === card.id || this.board.moving(card.id);
  }

  /**
   * Moves a Jira card in Jira: into a column, where it shows at once, or
   * with Change status, to any status Jira allows. Jira is asked which it
   * allows; one into the column is taken, and several are offered.
   */
  protected async moveInJira(card: Card, column?: CardColumn): Promise<void> {
    const asked = { card: card.id, ...(column ? { column } : {}) };
    this.inJira.set(asked);
    this.board.jiraNote.set(null);
    if (column) this.board.hold(card.id, column);
    const choices = await this.board.transitions(card.id, column);
    // Cancelled meanwhile.
    if (this.inJira() !== asked) return;
    if (!choices?.length) {
      this.endInJira(card);
      if (choices) {
        const from = card.jira?.status || this.columnName(card.column);
        this.board.jiraNote.set({
          card: card.id,
          text: column
            ? `Jira doesn’t allow moving from ${from} to ${this.columnName(column)}`
            : `Jira allows no change of status from ${from}`,
          openInJira: false,
        });
      }
      return;
    }
    if (column && choices.length === 1) return this.transition(card, choices[0]!);
    this.inJira.set({ ...asked, choices });
    this.focusIn(card.id, '.moves button');
  }

  /** A choice of status by its name, and its transition's too where two lead to the same one. */
  protected choiceLabel(choice: JiraTransition, choices: readonly JiraTransition[]): string {
    const twice = choices.some((other) => other !== choice && other.status === choice.status);
    return twice && choice.name !== choice.status
      ? `${choice.status} (${choice.name})`
      : choice.status;
  }

  /** Changes a Jira card's status by the transition picked, or the one Jira allows. */
  protected async transition(card: Card, transition: JiraTransition): Promise<void> {
    this.inJira.set(null);
    await this.board.transition(card.id, transition);
    this.focusIn(card.id, '.move');
  }

  /** Leaves a Jira card where Jira has it: Jira's being asked, or its choices show. */
  protected endInJira(card: Card): void {
    this.inJira.set(null);
    this.board.release(card.id);
    this.focusIn(card.id, '.move');
  }

  protected closeMoves(card: Card): void {
    this.moving.set(null);
    this.focusIn(card.id, '.move');
  }

  protected dragStart(event: DragEvent, card: Card): void {
    if (this.editing() === card.id || this.movingInJira(card)) return event.preventDefault();
    this.dragging.set(card.id);
    this.moving.set(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.title);
    }
  }

  protected dragOver(event: DragEvent, column: CardColumn): void {
    if (!this.dragging()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.over.set(column);
  }

  protected dragLeave(event: DragEvent, column: CardColumn): void {
    const into = event.relatedTarget as Node | null;
    if (!into || !(event.currentTarget as HTMLElement).contains(into)) {
      if (this.over() === column) this.over.set(null);
    }
  }

  /**
   * Drops the card dragged before the card it's over, or after it from its
   * lower half, or at the column's foot. A Jira card moves in Jira, into
   * another column only.
   */
  protected drop(event: DragEvent, column: CardColumn): void {
    const id = this.dragging();
    this.dragEnd();
    if (!id) return;
    event.preventDefault();
    const dragged = this.board.all()?.find((card) => card.id === id);
    if (dragged?.kind === 'jira') {
      if (dragged.column !== column) void this.moveInJira(dragged, column);
      return;
    }
    const target = (event.target as Element).closest<HTMLElement>('[data-card]');
    const cards = this.byColumn()[column];
    let before: string | undefined;
    if (target) {
      const at = cards.findIndex((card) => card.id === target.dataset['card']);
      const { top, height } = target.getBoundingClientRect();
      const below = height > 0 && event.clientY > top + height / 2;
      before = cards[below ? at + 1 : at]?.id;
    }
    if (before === id) return;
    void this.board.move(id, column, before);
  }

  protected dragEnd(): void {
    this.dragging.set(null);
    this.over.set(null);
  }

  /** Focuses a control on a card once the board has drawn it, such as its Move to after a move. */
  private focusIn(id: string, selector: string): void {
    afterNextRender(
      () => this.host.querySelector<HTMLElement>(`[data-card="${id}"] ${selector}`)?.focus(),
      { injector: this.injector },
    );
  }

  private async loadTitles(): Promise<void> {
    const past = await this.chats.pastChats().catch(() => []);
    this.titles.update(
      (titles) => new Map([...past.map((chat) => [chat.id, chat.title] as const), ...titles]),
    );
  }
}
