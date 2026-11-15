import {
  Component,
  DestroyRef,
  ElementRef,
  PendingTasks,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { CommitChat, GitCommit, GitRef, GitStatus } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { Icon } from '@ui/design-system/icon';
import { GitLanes } from './git-lanes';
import { whenOf } from './git-state';
import { type GraphCommit, layOut } from './graph-layout';

/** How many commits are read at a time. */
const PAGE = 200;
/** The most commits read again at once when the repository moves. */
const MOST_AGAIN = 2000;
/** How far an arrow key moves the graph column's edge, in pixels. */
const RESIZE_STEP = 16;
/** Stands for the changes not committed yet in the layout. */
const CHANGES = 'changes';

/** A ref as its label shows: a local branch and its upstream at one commit share one. */
export interface RefLabel {
  name: string;
  kind: GitRef['kind'];
  current: boolean;
  /** It's the branch and its upstream, even with each other. */
  synced: boolean;
  title: string;
}

/** The labels for a commit's refs, a branch taking in its upstream when both are here. */
export function labelsOf(refs: readonly GitRef[] = []): RefLabel[] {
  const names = new Set(refs.map((ref) => `${ref.kind}:${ref.name}`));
  const taken = new Set(
    refs.flatMap((ref) =>
      ref.kind === 'branch' && ref.upstream && names.has(`remote:${ref.upstream}`)
        ? [ref.upstream]
        : [],
    ),
  );
  return refs
    .filter((ref) => !(ref.kind === 'remote' && taken.has(ref.name)))
    .map((ref) => {
      const synced = !!ref.upstream && taken.has(ref.upstream);
      const title = [
        ref.kind === 'head'
          ? 'Detached HEAD'
          : `${{ branch: 'Branch', remote: 'Remote branch', tag: 'Tag' }[ref.kind]} ${ref.name}`,
        ref.current && ref.kind === 'branch' ? 'checked out' : '',
        synced ? `even with ${ref.upstream}` : '',
        ref.worktree ? `in the worktree at ${ref.worktree}` : '',
      ].filter(Boolean);
      return {
        name: ref.name,
        kind: ref.kind,
        current: !!ref.current,
        synced,
        title: title.join(', '),
      };
    });
}

/**
 * The repository's history as a graph, as a git viewer draws it: every
 * branch, remote and tag in lanes, a row each, the changes not committed
 * yet on top. Older commits load as you scroll; a row opens on its own.
 */
@Component({
  selector: 'gr-git-graph',
  imports: [GitLanes, Icon],
  templateUrl: './git-graph.html',
  styleUrl: './git-graph.css',
  host: {
    '[style.--graph-lanes]': 'lanes()',
    '[style.--graph-width]': "width() === null ? null : width() + 'px'",
  },
})
export class GitGraph {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  private readonly chats = inject(ChatList);

  readonly cwd = input.required<string>();
  readonly status = input.required<GitStatus>();
  /** Asks to open a commit, by its sha. */
  readonly pick = output<string>();
  /** Asks to open the changes not committed yet. */
  readonly openChanges = output<void>();

  /** Null until the first page is read. */
  protected readonly commits = signal<GitCommit[] | null>(null);
  protected readonly more = signal(false);
  protected readonly reading = signal(false);
  private readonly head = signal<string | null>(null);
  /** The graph column's width you dragged it to; null fits it to the lanes. */
  protected readonly width = signal<number | null>(null);
  /** Scrolling near the end loads more, where the window can tell; elsewhere a button does. */
  protected readonly observes = typeof IntersectionObserver !== 'undefined';
  private readonly end = viewChild<ElementRef<HTMLElement>>('end');
  private readonly graphHead = viewChild<ElementRef<HTMLElement>>('graphHead');
  /** Which read is the latest, so an earlier one answering late is dropped. */
  private reads = 0;

  protected readonly changes = computed(() => this.status().changes.length);
  /** The rows: the changes not committed yet first, when there are some, then the commits. */
  protected readonly rows = computed(() => {
    const commits = this.commits() ?? [];
    const head = this.head();
    const graph: GraphCommit[] = this.changes()
      ? [{ sha: CHANGES, parents: head ? [head] : [] }, ...commits]
      : commits;
    const rows = layOut(graph).rows;
    const changes = this.changes() ? rows.shift() : undefined;
    return { changes, commits: commits.map((commit, i) => ({ commit, row: rows[i]! })) };
  });
  /** The most lanes any row spans. */
  protected readonly lanes = computed(() => {
    const { changes, commits } = this.rows();
    return Math.max(1, changes?.width ?? 0, ...commits.map(({ row }) => row.width));
  });
  /** What the repository is at: when it moves, the graph is read again. */
  private readonly moved = computed(() => {
    const { head, branch, upstream } = this.status();
    return [this.cwd(), head, branch, upstream?.name, upstream?.ahead, upstream?.behind].join('|');
  });

  constructor() {
    effect(() => {
      this.moved();
      untracked(() => {
        const loaded = this.commits()?.length ?? 0;
        void this.read(0, Math.min(MOST_AGAIN, Math.max(PAGE, loaded)), true);
      });
    });
    effect((onCleanup) => {
      const end = this.end()?.nativeElement;
      if (!end || !this.observes) return;
      const observer = new IntersectionObserver((seen) => {
        if (seen.some((entry) => entry.isIntersecting)) this.showOlder();
      });
      observer.observe(end);
      onCleanup(() => observer.disconnect());
    });
    inject(DestroyRef).onDestroy(() => this.reads++);
  }

  protected showOlder(): void {
    if (this.reading() || !this.more()) return;
    void this.read(this.commits()?.length ?? 0, PAGE, false);
  }

  protected readonly labelsOf = labelsOf;

  protected when(at: number): string {
    return whenOf(at, Date.now());
  }

  protected openChat(chat: CommitChat): void {
    void this.chats.openChat({ ...chat, updatedAt: 0 });
  }

  /** Dragging the graph column's edge sizes it. */
  protected startResize(event: PointerEvent): void {
    const head = this.graphHead()?.nativeElement;
    if (!head) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const from = event.clientX;
    const start = head.getBoundingClientRect().width;
    handle.setPointerCapture?.(event.pointerId);
    const move = (moved: PointerEvent) =>
      this.width.set(Math.max(RESIZE_STEP, Math.round(start + moved.clientX - from)));
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  protected resizeBy(event: KeyboardEvent): void {
    const step = { ArrowLeft: -RESIZE_STEP, ArrowRight: RESIZE_STEP }[event.key];
    const head = this.graphHead()?.nativeElement;
    if (!step || !head) return;
    event.preventDefault();
    const now = this.width() ?? head.getBoundingClientRect().width;
    this.width.set(Math.max(RESIZE_STEP, Math.round(now + step)));
  }

  /** Reads `limit` commits from `skip`; a fresh read replaces what's shown, a later page adds to it. */
  private async read(skip: number, limit: number, fresh: boolean): Promise<void> {
    const read = ++this.reads;
    const cwd = this.cwd();
    const done = this.pending.add();
    this.reading.set(true);
    try {
      const page = await this.bridge.invoke('git.log', { cwd, skip, limit }).catch(() => null);
      if (read !== this.reads) return;
      const commits = page?.commits ?? [];
      this.commits.update((before) => (fresh ? commits : [...(before ?? []), ...commits]));
      this.more.set(page?.more ?? false);
      if (fresh) this.head.set(page?.head ?? null);
    } finally {
      if (read === this.reads) this.reading.set(false);
      done();
    }
  }
}
