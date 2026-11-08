import {
  Component,
  ElementRef,
  PendingTasks,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { DesignSettings } from '@ui/design-system/design-settings';
import { type Drawn, Diagrams, diagramLook } from './diagrams';
import { Listing } from './listing';

let copies = 0;

/**
 * A Mermaid listing drawn as its diagram, numbered with the reply's
 * listings, its source a click away. Until it's drawn, or when Mermaid
 * can't read it, it shows as the listing, the latter with why. It's drawn
 * again when the theme or a token of it changes.
 */
@Component({
  selector: 'gr-diagram',
  imports: [Listing],
  templateUrl: './diagram.html',
  styleUrl: './diagram.css',
})
export class Diagram {
  private readonly diagrams = inject(Diagrams);
  private readonly design = inject(DesignSettings);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly pending = inject(PendingTasks);

  readonly code = input.required<string>();
  readonly number = input.required<number>();

  /** Showing the source instead of the diagram. */
  protected readonly source = signal(false);
  private readonly drawn = signal<Drawn | null>(null);
  /**
   * Mermaid's SVG, already cleaned by it (securityLevel "strict"). A kept
   * drawing may show twice, so its ids are made this diagram's own: arrows
   * point at markers by id, and a hidden copy's markers draw nothing.
   */
  protected readonly svg = computed(() => {
    const drawn = this.drawn();
    if (!drawn || !('svg' in drawn)) return null;
    const own = drawn.svg.replace(new RegExp(`${drawn.id}(?!\d)`, 'g'), `${drawn.id}-${this.copy}`);
    return this.sanitizer.bypassSecurityTrustHtml(own);
  });
  private readonly copy = ++copies;
  protected readonly problem = computed(() => {
    const drawn = this.drawn();
    return drawn && 'problem' in drawn ? drawn.problem : null;
  });
  /** The latest drawing asked for; an earlier one that finishes after it is dropped. */
  private asked = 0;

  constructor() {
    // After rendering, so the theme and tokens are on the page to read.
    afterRenderEffect(() => {
      const code = this.code();
      this.design.theme();
      this.design.tokens();
      const turn = ++this.asked;
      const done = this.pending.add();
      void this.diagrams
        .draw(code, diagramLook(this.host))
        .then((drawn) => {
          if (turn === this.asked) this.drawn.set(drawn);
        })
        .finally(done);
    });
  }
}
