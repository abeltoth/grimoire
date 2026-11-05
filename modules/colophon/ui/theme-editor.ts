import { Component, computed, inject, signal } from '@angular/core';
import { Settings } from '@ui/app/core/settings';
import { Wording } from '@ui/app/core/wording';
import {
  MAIN_TOKENS,
  TEXT_SIZE,
  TEXT_SIZES,
  type TokenGroup,
  hexOf,
  isColour,
  lookUpTokens,
  pxOf,
  tokenGroups,
} from './theme';

/**
 * The theme editor: the book's main colours and the size of its text, then
 * every token under the theme's own headings, to look up and change. The
 * book is its own preview: a change shows on every page at once, and is
 * kept for every window once you stop. Reset puts a token back as drawn.
 */
@Component({
  selector: 'gr-theme-editor',
  templateUrl: './theme-editor.html',
  styleUrl: './theme-editor.css',
})
export class ThemeEditor {
  private readonly settings = inject(Settings);
  protected readonly wording = inject(Wording);
  protected readonly isColour = isColour;
  protected readonly textSizes = TEXT_SIZES;
  protected readonly TEXT_SIZE = TEXT_SIZE;

  /** The theme's tokens under its headings, once its file is read. */
  protected readonly groups = signal<TokenGroup[] | null>(null);
  protected readonly unread = signal<string | null>(null);
  protected readonly lookUp = signal('');
  /** The headings you opened. */
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  protected readonly changes = computed(() => this.settings.all().theme ?? {});
  private readonly drawn = computed(
    () =>
      new Map(
        (this.groups() ?? []).flatMap((group) =>
          group.tokens.map((token) => [token.name, token.value] as const),
        ),
      ),
  );
  protected readonly shown = computed(() => lookUpTokens(this.groups() ?? [], this.lookUp()));
  protected readonly main = computed(() =>
    MAIN_TOKENS.map((token) => {
      const value = this.valueOf(token.name);
      return {
        ...token,
        label: this.wording.plain() && token.plainLabel ? token.plainLabel : token.label,
        value,
        hex: hexOf(value),
        changed: token.name in this.changes(),
      };
    }),
  );
  protected readonly textSize = computed(() => pxOf(this.valueOf(TEXT_SIZE)));
  protected readonly changedCount = computed(() => Object.keys(this.changes()).length);
  protected readonly count = computed(() => {
    const tokens = this.shown().reduce((sum, group) => sum + group.tokens.length, 0);
    const changed = this.changedCount();
    return `${tokens} ${tokens === 1 ? 'token' : 'tokens'}${changed ? ` · ${changed} changed` : ''}`;
  });

  constructor() {
    void import('@ui/design-system/themes/grimoire.css', { with: { loader: 'text' } }).then(
      ({ default: css }) => this.groups.set(tokenGroups(css)),
      (error: unknown) => this.unread.set(error instanceof Error ? error.message : String(error)),
    );
  }

  /** A token's value: yours, if you changed it, else as the theme draws it. */
  protected valueOf(name: string): string {
    return this.changes()[name] ?? this.drawn().get(name) ?? '';
  }

  protected isOpen(title: string): boolean {
    return !!this.lookUp().trim() || this.opened().has(title);
  }

  protected toggled(title: string, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    if (open === this.isOpen(title)) return;
    this.opened.update((opened) => {
      const next = new Set(opened);
      if (open) next.add(title);
      else next.delete(title);
      return next;
    });
  }

  /** Changes a token; writing it back as drawn, or clearing it, resets it. */
  protected change(name: string, value: string): void {
    const written = value.trim();
    if (!written || written === this.drawn().get(name)) return this.reset(name);
    if (written === this.changes()[name]) return;
    this.settings.setSoon({ theme: { ...this.changes(), [name]: written } });
  }

  protected reset(name: string): void {
    if (!(name in this.changes())) return;
    const { [name]: _, ...rest } = this.changes();
    this.settings.setSoon({ theme: rest });
  }

  protected resetAll(): void {
    void this.settings.set({ theme: {} });
  }
}
