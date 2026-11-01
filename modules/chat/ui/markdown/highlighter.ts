import { Injectable, signal } from '@angular/core';
import type { HighlighterCore } from 'shiki/core';

/** A run of code in one colour. */
export interface CodeToken {
  text: string;
  /** A var(--gr-code-*) colour; missing for plain text. */
  color?: string;
  italic: boolean;
}

// Shiki's FontStyle flag for italics.
const ITALIC = 1;

interface Loaded {
  core: HighlighterCore;
  theme: string;
  load: (lang: string) => Promise<boolean>;
}

/**
 * Colours code listings with Shiki. Shiki and each language load on first
 * use; until then, and for languages it doesn't know, code stays plain.
 */
@Injectable({ providedIn: 'root' })
export class Highlighter {
  private shiki?: Promise<Loaded>;
  private ready?: Loaded;
  private readonly requested = new Set<string>();
  /** Languages loaded so far; reading it makes a listing recolour once its language arrives. */
  private readonly languages = signal<ReadonlySet<string>>(new Set());

  /** The code's lines in colour, or undefined while its language loads or if it's unknown. */
  lines(code: string, lang: string): CodeToken[][] | undefined {
    const name = lang.toLowerCase();
    if (!name) return undefined;
    if (!this.languages().has(name) || !this.ready) {
      this.request(name);
      return undefined;
    }
    try {
      return this.ready.core
        .codeToTokensBase(code, { lang: name, theme: this.ready.theme })
        .map((line) =>
          line.map((token) => ({
            text: token.content,
            ...(token.color && token.color !== 'var(--gr-code-text)' ? { color: token.color } : {}),
            italic: ((token.fontStyle ?? 0) & ITALIC) !== 0,
          })),
        );
    } catch {
      return undefined;
    }
  }

  private request(name: string): void {
    if (this.requested.has(name)) return;
    this.requested.add(name);
    this.shiki ??= import('./shiki').then(async (shiki) => {
      const core = await shiki.createHighlighter();
      return (this.ready = {
        core,
        theme: shiki.THEME,
        load: (lang) => shiki.loadLanguage(core, lang),
      });
    });
    this.shiki
      .then(({ load }) => load(name))
      .then(
        (known) => {
          if (known) this.languages.update((languages) => new Set([...languages, name]));
        },
        () => {},
      );
  }
}
