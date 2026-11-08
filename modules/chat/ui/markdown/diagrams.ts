import { Injectable } from '@angular/core';
import { hex } from '@ui/design-system/colour';

/** The book's look as Mermaid takes it: colours as hex, read from the --gr-diagram-* tokens. */
export interface DiagramLook {
  ink?: string;
  page?: string;
  node?: string;
  line?: string;
  accent?: string;
  font: string;
  size: string;
  /** Light ink on dark paper, which Mermaid shades its own colours for. */
  dark: boolean;
}

/** A diagram drawn as SVG, with the id its own ids start with, or why it couldn't be. */
export type Drawn = { svg: string; id: string } | { problem: string };

const CACHE_SIZE = 100;

/**
 * The look where a diagram is, from the tokens diagram.css hands on, so
 * it follows the theme and the tokens you change.
 */
export function diagramLook(where: Element): DiagramLook {
  const styles = getComputedStyle(where);
  const token = (name: string) => styles.getPropertyValue(`--${name}`).trim();
  const colour = (name: string) => hex(where, token(name));
  const page = colour('page');
  return {
    ink: colour('ink'),
    page,
    node: colour('node'),
    line: colour('line'),
    accent: colour('accent'),
    font: token('font'),
    size: token('size'),
    dark: page !== undefined && lightness(page) < 0.5,
  };
}

/** How light a #rrggbb colour is, from 0 to 1. */
function lightness(colour: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * Draws Mermaid diagrams. Mermaid loads on first use, and draws one
 * diagram at a time: its settings, the look among them, are global.
 * A diagram drawn in a look is kept, so pages that show it again don't
 * wait.
 */
@Injectable({ providedIn: 'root' })
export class Diagrams {
  private mermaid?: Promise<typeof import('./mermaid')>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly drawn = new Map<string, Promise<Drawn>>();

  draw(code: string, look: DiagramLook): Promise<Drawn> {
    const key = `${JSON.stringify(look)}\n${code}`;
    const kept = this.drawn.get(key);
    if (kept) return kept;
    this.mermaid ??= import('./mermaid');
    const drawing = this.queue.then(() =>
      this.mermaid!.then((mermaid) => mermaid.draw(code, look)).then(
        (drawn): Drawn => drawn,
        (error: unknown): Drawn => ({ problem: problemOf(error) }),
      ),
    );
    this.queue = drawing;
    this.drawn.set(key, drawing);
    if (this.drawn.size > CACHE_SIZE) this.drawn.delete(this.drawn.keys().next().value!);
    return drawing;
  }
}

/** The first line of what Mermaid said, such as "Parse error on line 2". */
function problemOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0]!.replace(/:\s*$/, '').trim() || 'Mermaid couldn’t read it';
}
