import { Component, booleanAttribute, computed, input } from '@angular/core';

/** The drawings a theme provides, each as a --gr-drawing-<name> token. */
export type DrawingName = 'empty-page' | 'spine' | 'thought' | 'chat-intro';

/**
 * One of the theme's drawings, painted in the current text colour. The
 * place that shows it sets its size, colour and opacity with its own tokens.
 * Drawings disappear when drawings are turned off, unless `essential`.
 */
@Component({
  selector: 'gr-drawing',
  template: '',
  styleUrl: './drawing.css',
  host: {
    'aria-hidden': 'true',
    '[style.mask-image]': 'mask()',
    '[class.essential]': 'essential()',
  },
})
export class Drawing {
  readonly name = input.required<DrawingName>();
  readonly essential = input(false, { transform: booleanAttribute });

  protected readonly mask = computed(() => `var(--gr-drawing-${this.name()})`);
}
