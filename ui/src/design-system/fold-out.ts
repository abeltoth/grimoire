import { type Signal, afterRenderEffect, signal } from '@angular/core';

/**
 * How many of a fold-out's lines fit before you scroll; all of them when
 * they all fit. Call it where `inject` works, such as a field initializer.
 */
export function linesShown(body: () => HTMLElement, total: () => number): Signal<number> {
  const shown = signal(0);
  afterRenderEffect(() => {
    const count = total();
    const { clientHeight, scrollHeight } = body();
    shown.set(
      scrollHeight > clientHeight && count
        ? Math.floor(clientHeight / (scrollHeight / count))
        : count,
    );
  });
  return shown.asReadonly();
}
