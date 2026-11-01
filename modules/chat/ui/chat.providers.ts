import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ChapterPage } from './chapter-page';
import { SealsPage } from './seals-page';

/**
 * The chat module (ADR-008): it fills the left page with the open chapter,
 * and the facing page with the slips awaiting your seal when it's turned there.
 */
export function provideChat(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.chapterPage.set(ChapterPage);
    shell.sealsPage.set(SealsPage);
  });
}
